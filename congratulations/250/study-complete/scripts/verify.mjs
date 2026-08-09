import assert from "node:assert/strict";

import { chromium } from "playwright";
import { startStaticServer } from "../../../tests/server-helper.mjs";

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
try {
  for (const reducedMotion of ["reduce", "no-preference"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion,
    });
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(String(error)));

    await page.goto(`${server.origin}/250/study-complete/?milestone=300`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-celebration-root][data-ready="true"]').waitFor();
    assert.equal(await page.title(), "300問達成 | STUDY COMPLETE");
    assert.equal(
      (await page.locator("[data-milestone]").first().textContent())?.trim(),
      "300",
    );
    assert.equal(await page.locator(".progress-dial strong").textContent(), "100%");
    assert.equal(await page.locator(".data-card").count(), 2);
    assert.equal(await page.locator(".proof-grid > div").count(), 3);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      true,
    );

    await page.locator("[data-replay]").click();
    assert.match(await page.locator("[data-status]").textContent(), /最大出力/);
    if (reducedMotion === "no-preference") {
      assert.equal(
        await page.locator("[data-celebration-root]").evaluate((node) =>
          node.classList.contains("is-celebrating"),
        ),
        true,
      );
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log("Study Complete focused verification passed");
} finally {
  await browser.close();
  await server.stop();
  assert.equal(server.getStderr(), "");
}
