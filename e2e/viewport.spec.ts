import { createSession, expect, join, test } from "./station";

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
    await expect(player.getByRole("button", { name: "Join" })).toBeVisible();
    await expectNoOverflow("join");

    await join(player, code, "Player 1");
    await expect(player.getByTestId("join-code")).toBeInViewport();
    await expect(player.getByRole("status")).toBeInViewport();
    await expectNoOverflow("player");
  });
}
