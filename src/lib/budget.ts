import config from "../../content/budget.json";
import type { PoolClient } from "pg";
import { contentCheck } from "./content";
import { db, lockSession, releaseSeats, transaction } from "./db";
import type { Refusal } from "./refusal";
import { budgetTotal, validAllocations, type BudgetConfig, type BudgetRound } from "./budget-state";

/** Throws when the content file would produce a broken round. */
export function checkContent({ amount, step, products }: BudgetConfig) {
  const check = contentCheck("budget.json");
  check(Number.isSafeInteger(amount) && amount > 0, "amount must be a positive whole number");
  check(Number.isSafeInteger(step) && step > 0 && amount % step === 0, "step must be a positive whole number that divides amount");
  check(
    products.length > 0 && products.every((product) => product.trim() !== "") && new Set(products).size === products.length,
    "products needs at least one name, none of them blank or repeated",
  );
}
checkContent(config);
for (const seconds of [config.countdownSeconds ?? 3, config.abandonSeconds ?? 60]) {
  contentCheck("budget.json")(seconds >= 0, "countdownSeconds and abandonSeconds must be zero or more");
}

export const countdownMs = () => (config.countdownSeconds ?? 3) * 1000;
export const abandonMs = () => (config.abandonSeconds ?? 60) * 1000;

type StoredRound = {
  id: string;
  playerName: string;
  config: BudgetConfig;
  allocations: number[];
  draftVersion: number;
  startsAt: Date | null;
} & (
  | { confirmed: true; averageShares: Record<string, number> }
  | { confirmed: false; averageShares: null }
);

/**
 * The display sees the station's latest round; a device only ever sees its own. A seated player (`includeDraft`)
 * sees only a round in progress, because an older finished one is from before it played again.
 */
export async function budgetRoundFor(
  sessionId: string,
  deviceId: string | null,
  includeDraft: boolean,
  now: number,
): Promise<BudgetRound | null> {
  // Count rounds before expanding products so a missing product contributes a zero share.
  const { rows: [round] } = await db.query<StoredRound>(
    `with latest as (
       select id, player_name, config, allocations, draft_version, confirmed_at, starts_at
       from budget_rounds
       where session_id = $1 and ($2::uuid is null or (player_device_id = $2 and (not $3 or confirmed_at is null)))
       order by round_number desc limit 1
     )
     select id, player_name as "playerName", config, allocations,
            draft_version::float8 as "draftVersion", starts_at as "startsAt", confirmed_at is not null as confirmed,
            case when confirmed_at is not null then (
              select jsonb_object_agg(product, average_share)
              from (
                select product,
                       sum((rounds.allocations->>((position - 1)::int))::numeric / (rounds.config->>'amount')::numeric)
                         / max(round_count) as average_share
                from (
                  select config, allocations, count(*) over () as round_count
                  from budget_rounds where confirmed_at is not null
                ) rounds
                cross join lateral jsonb_array_elements_text(rounds.config->'products')
                  with ordinality as products(product, position)
                group by product
              ) averages
            ) end as "averageShares"
     from latest`,
    [sessionId, deviceId, includeDraft],
  );
  if (!round) return null;

  const { confirmed, allocations, draftVersion, averageShares, startsAt, ...details } = round;
  if (confirmed) {
    const eventAverageShares = details.config.products.map((product) => averageShares[product]);
    return { ...details, phase: "confirmed", allocations, eventAverageShares };
  }
  if (startsAt && startsAt.getTime() > now) return { ...details, phase: "countdown", startsInMs: startsAt.getTime() - now };
  return { ...details, phase: "editing", draftVersion, allocations: includeDraft ? allocations : null };
}

/** Runs in the caller's transaction, which already holds the session lock. Saves stay refused until `startsAt`. */
export async function startBudgetRound(client: PoolClient, sessionId: string, deviceId: string, playerName: string, startsAt: Date) {
  await client.query(
    `insert into budget_rounds (session_id, player_name, config, allocations, starts_at, player_device_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [sessionId, playerName, JSON.stringify(config), JSON.stringify(config.products.map(() => 0)), startsAt, deviceId],
  );
}

/** A draft keeps the round open, and its version orders it among other drafts. Confirming seals the round. */
export type BudgetSave = { action: "draft"; version: number } | { action: "confirm" };

export async function saveBudgetAllocations(
  { sessionId, deviceId }: { sessionId: string; deviceId: string },
  roundId: string,
  allocations: unknown,
  save: BudgetSave,
  now: number,
): Promise<Refusal | null> {
  const confirm = save.action === "confirm";
  return transaction(async (client) => {
    await lockSession(client, sessionId);
    // Only the device the round was started for may change it, so a guest's stale draft is refused.
    const { rows: [round] } = await client.query<{ config: BudgetConfig; confirmed: boolean; startsAt: Date | null }>(
      `select config, confirmed_at is not null as confirmed, starts_at as "startsAt"
       from budget_rounds where session_id = $1 and id = $2 and player_device_id = $3`,
      [sessionId, roundId, deviceId],
    );
    if (!round) return { status: 409, error: "This budget round is no longer available." };
    if (round.startsAt && round.startsAt.getTime() > now) return { status: 409, error: "The round has not started yet." };
    if (!validAllocations(allocations, round.config) || (confirm && budgetTotal(allocations) !== round.config.amount)) {
      return { status: 400, error: "Enter valid amounts in the configured step and spend the full budget to confirm." };
    }

    // Versions order drafts across reloads. Confirmation seals the round and can be retried with the same amounts.
    // A null version is how the statement below tells a confirmation from a draft.
    const { rowCount } = await client.query(
      `update budget_rounds
       set allocations = $3, draft_version = coalesce($4::bigint, draft_version),
           confirmed_at = case when $4::bigint is null then coalesce(confirmed_at, now()) else null end
       where session_id = $1 and id = $2
         and (
           ($4::bigint is null and (confirmed_at is null or allocations = $3))
           or (confirmed_at is null and (draft_version < $4 or (draft_version = $4 and allocations = $3)))
         )`,
      [sessionId, roundId, JSON.stringify(allocations), save.action === "draft" ? save.version : null],
    );
    if (!rowCount) return { status: 409, error: "This budget round or draft has already changed." };
    // Only the confirmation that seals the round frees the slot; a retried one must not free the next player's.
    if (confirm && !round.confirmed) await releaseSeats(client, sessionId);
    return null;
  });
}
