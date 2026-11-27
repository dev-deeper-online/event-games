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
  confirmed: boolean;
};

export async function budgetRoundFor(sessionId: string, includeDraft: boolean): Promise<BudgetRound | null> {
  const { rows: [round] } = await db.query<StoredRound>(
    `select id, player_name as "playerName", config, allocations,
            draft_version::float8 as "draftVersion", confirmed_at is not null as confirmed
     from budget_rounds where session_id = $1 order by round_number desc limit 1`,
    [sessionId],
  );
  if (!round) return null;

  const { confirmed, allocations, draftVersion, ...details } = round;
  return confirmed
    ? { ...details, phase: "confirmed", allocations }
    : { ...details, phase: "editing", draftVersion, allocations: includeDraft ? allocations : null };
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
