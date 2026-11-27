export type BudgetConfig = {
  amount: number;
  step: number;
  products: string[];
};

export type BudgetRound = {
  id: string;
  playerName: string;
  config: BudgetConfig;
} & (
  | { phase: "editing"; allocations: number[] | null; draftVersion: number }
  | { phase: "confirmed"; allocations: number[]; eventAverageShares: number[] }
);

export const budgetTotal = (allocations: number[]) =>
  allocations.reduce((total, amount) => total + amount, 0);

export function validAllocations(value: unknown, { amount, step, products }: BudgetConfig): value is number[] {
  return Array.isArray(value) && value.length === products.length &&
    value.every((allocation) => Number.isSafeInteger(allocation) && allocation >= 0 && allocation % step === 0) &&
    budgetTotal(value) <= amount;
}
