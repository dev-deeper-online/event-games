import { randomBytes } from "node:crypto";
import { test as base, expect, type APIRequestContext, type Page } from "@playwright/test";

type Seat = "Display" | "Player 1" | "Player 2";

type Fixtures = {
  /** A fresh browser, standing in for one physical device. */
  newDevice: () => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  newDevice: async ({ browser }, provide) => {
    const pages: Page[] = [];
    await provide(async () => {
      const context = await browser.newContext();
      const page = await context.newPage();
      pages.push(page);
      return page;
    });
    await Promise.all(pages.map((page) => page.context().close()));
  },
});

export { expect };

export async function createSession(operator: Page, game: "quiz" | "budget") {
  await operator.goto("/operator");
  await operator.getByRole("button", { name: `New ${game} session` }).click();
  await expect(operator).toHaveURL(/\/session\/[A-Z0-9]{6}\/operator$/);
  return (await operator.getByTestId("join-code").innerText()).trim();
}

export const newToken = () => randomBytes(32).toString("hex");

export async function createSessionByApi(request: APIRequestContext): Promise<{ code: string; token: string }> {
  return (await request.post("/api/sessions", { data: { gameType: "quiz" } })).json();
}

export async function submitJoin(page: Page, code: string, seat: Seat) {
  await page.goto("/");
  await page.getByLabel("Join code").fill(code);
  await page.getByRole("radio", { name: seat }).check();
  await page.getByRole("button", { name: "Join" }).click();
}

export async function join(page: Page, code: string, seat: Seat) {
  await submitJoin(page, code, seat);
  await expect(page.getByRole("heading", { name: seat })).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Connected");
}

/** One row of the connected-devices list. */
export function seatStatus(page: Page, seat: Seat | "Operator") {
  return page.getByRole("list", { name: "Devices" }).getByRole("listitem").filter({ hasText: seat }).getByTestId("seat-status");
}
