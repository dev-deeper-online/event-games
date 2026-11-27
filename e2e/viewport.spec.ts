import { createSession, expect, readyButton, submitJoin, test } from "./station";

const viewports = {
  "small phone": { width: 320, height: 568 },
  phone: { width: 390, height: 844 },
  "phone landscape": { width: 844, height: 390 },
  "tablet portrait": { width: 768, height: 1024 },
  "tablet landscape": { width: 1180, height: 820 },
};

for (const [name, viewport] of Object.entries(viewports)) {
  test(`the join and player views fit a ${name}`, async ({ newDevice }, testInfo) => {
    const code = await createSession(await newDevice(), "quiz");
    const player = await newDevice();
    await player.setViewportSize(viewport);

    const expectNoOverflow = async (view: string) => {
      const [content, available] = await player.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
      expect(content).toBeLessThanOrEqual(available);
      await testInfo.attach(`${view} - ${name}`, { body: await player.screenshot({ fullPage: true }), contentType: "image/png" });
    };

    await player.goto("/");
    await expect(player.getByRole("button", { name: "Continue" })).toBeVisible();
    await expectNoOverflow("home");

    await submitJoin(player, code, "W".repeat(30));
    await expect(player.getByText("You are in as")).toBeVisible();
    await expect(readyButton(player)).toBeInViewport();
    await expect(player.getByRole("status")).toBeInViewport();
    await expectNoOverflow("player");
  });
}

test("the idle quiz display puts the QR code and leaderboard side by side, and stacks them on a narrow screen", async ({ newDevice }, testInfo) => {
  const display = await newDevice();
  await display.setViewportSize({ width: 1920, height: 1080 });
  await createSession(display, "quiz");
  const qr = display.getByRole("img", { name: "QR code to join" });
  const leaderboard = display.getByRole("heading", { name: "Event leaderboard" });
  await expect(qr).toBeVisible();
  await expect(leaderboard).toBeVisible();

  const [qrBox, boardBox] = await Promise.all([qr.boundingBox(), leaderboard.boundingBox()]);
  expect(qrBox!.x + qrBox!.width).toBeLessThanOrEqual(boardBox!.x);
  await testInfo.attach("display idle", { body: await display.screenshot(), contentType: "image/png" });

  await display.setViewportSize({ width: 390, height: 844 });
  const [narrowQr, narrowBoard] = await Promise.all([qr.boundingBox(), leaderboard.boundingBox()]);
  expect(narrowBoard!.y).toBeGreaterThan(narrowQr!.y + narrowQr!.height);
  const [content, available] = await display.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  expect(content).toBeLessThanOrEqual(available);
});
