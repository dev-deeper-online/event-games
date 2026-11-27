import config from "../../content/budget.json";
import { db } from "./db";
import type { Refusal } from "./refusal";
import { budgetTotal, validAllocations, type BudgetConfig, type BudgetRound } from "./budget-state";

if (!Number.isSafeInteger(config.amount) || config.amount <= 0 ||
    !Number.isSafeInteger(config.step) || config.step <= 0 || config.amount % config.step !== 0 ||
    !config.products.length || config.products.some((product) => !product.trim()) ||
    new Set(config.products).size !== config.products.length) {
  throw new Error("content/budget.json requires a positive budget divisible by its step and unique product names.");
}

type StoredRound = {
  id: string;
  playerName: string;
  config: BudgetConfig;
  allocations: number[];
  draftVersion: number;
} & (
  | { confirmed: true; averageShares: Record<string, number> }
  | { confirmed: false; averageShares: null }
);

export async function budgetRoundFor(sessionId: string, includeDraft: boolean): Promise<BudgetRound | null> {
  // Count rounds before expanding products so a missing product contributes a zero share.
  const { rows: [round] } = await db.query<StoredRound>(
    `with latest as (
       select id, player_name, config, allocations, draft_version, confirmed_at
       from budget_rounds where session_id = $1 order by round_number desc limit 1
     )
     select id, player_name as "playerName", config, allocations,
            draft_version::float8 as "draftVersion", confirmed_at is not null as confirmed,
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
    [sessionId],
  );
  if (!round) return null;

  const { confirmed, allocations, draftVersion, averageShares, ...details } = round;
  if (confirmed) {
    const eventAverageShares = details.config.products.map((product) => averageShares[product]);
    return { ...details, phase: "confirmed", allocations, eventAverageShares };
  }
  return { ...details, phase: "editing", draftVersion, allocations: includeDraft ? allocations : null };
}

export async function startBudgetRound(sessionId: string, playerName: string) {
  const { rowCount } = await db.query(
    `insert into budget_rounds (session_id, player_name, config, allocations)
     select $1, $2, $3, $4
     where exists (select 1 from devices where session_id = $1 and role = 'player1')
     on conflict (session_id) where confirmed_at is null do nothing`,
    [sessionId, playerName, JSON.stringify(config), JSON.stringify(config.products.map(() => 0))],
  );
  return rowCount === 1;
}

export async function saveBudgetAllocations(
  sessionId: string,
  roundId: string,
  allocations: unknown,
  draftVersion: number | null,
): Promise<Refusal | null> {
  const confirm = draftVersion === null;
  const { rows: [round] } = await db.query<{ config: BudgetConfig }>(
    "select config from budget_rounds where session_id = $1 and id = $2",
    [sessionId, roundId],
  );
  if (!round) return { status: 409, error: "This budget round is no longer available." };
  if (!validAllocations(allocations, round.config) || (confirm && budgetTotal(allocations) !== round.config.amount)) {
    return { status: 400, error: "Enter valid amounts in the configured step and spend the full budget to confirm." };
  }

  // Versions order drafts across reloads. Confirmation seals the round and can be retried with the same amounts.
  const { rowCount } = await db.query(
    `update budget_rounds
     set allocations = $3, draft_version = coalesce($4::bigint, draft_version),
         confirmed_at = case when $4::bigint is null then coalesce(confirmed_at, now()) else null end
     where session_id = $1 and id = $2
       and (
         ($4::bigint is null and (confirmed_at is null or allocations = $3))
         or (confirmed_at is null and (draft_version < $4 or (draft_version = $4 and allocations = $3)))
       )`,
    [sessionId, roundId, JSON.stringify(allocations), draftVersion],
  );
  return rowCount ? null : { status: 409, error: "This budget round or draft has already changed." };
}
