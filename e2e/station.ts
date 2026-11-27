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

/** Staff open a new session on the device that becomes its display. Returns the join code. */
export async function createSession(display: Page, game: "quiz" | "budget") {
  await display.goto("/new");
  await display.getByRole("button", { name: `New ${game} session` }).click();
  await expect(display).toHaveURL(/\/session\/[A-Z0-9]{6}\/display$/);
  await expect(display.getByRole("status")).toHaveText("Connected");
  return (await display.getByTestId("join-code").innerText()).trim();
}

export const newToken = () => randomBytes(32).toString("hex");

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** The display's token: the creator of a session is its display. */
export async function createSessionByApi(
  request: APIRequestContext,
  gameType: "quiz" | "budget" = "quiz",
): Promise<{ code: string; token: string }> {
  return (await request.post("/api/sessions", { data: { gameType } })).json();
}

export async function joinByApi(request: APIRequestContext, code: string, name = "Guest", token = newToken()) {
  const response = await request.post("/api/join", { data: { code, name, token } });
  return { token, status: response.status(), response };
}

export const readyByApi = (request: APIRequestContext, token: string) =>
  request.post("/api/ready", { headers: bearer(token) });

export async function snapshotByApi(request: APIRequestContext, token: string) {
  const response = await request.get("/api/snapshot", { headers: bearer(token) });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** A guest scanning the QR code: the join page needs only a name. */
export async function submitJoin(page: Page, code: string, name: string) {
  await page.goto(`/join/${code}`);
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Join" }).click();
}

export async function join(page: Page, code: string, name: string) {
  await submitJoin(page, code, name);
  await expect(page.getByText(`You are in as ${name}.`)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Connected");
}

export const readyButton = (page: Page) => page.getByRole("button", { name: "Ready", exact: true });

/** One row of the connected-devices list on a display. */
export function seatStatus(page: Page, seat: Seat) {
  return page.getByRole("list", { name: "Devices" }).getByRole("listitem").filter({ hasText: seat }).getByTestId("seat-status");
}
