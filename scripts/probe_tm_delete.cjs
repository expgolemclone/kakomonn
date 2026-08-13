const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const puppeteer = require("puppeteer-core");
const {
  remoteDebugApprovalEnvironment,
  remoteDebugApprovalPowerShell,
} = require("../kakomonn-reader/tests/live_sync_e2e_test.js");

const userDataDir =
  process.env.KAKOMONN_EDGE_USER_DATA_DIR ??
  "C:\\Users\\0000250059\\AppData\\Local\\kakomonn-edge-e2e";
const content = fs
  .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8")
  .trim()
  .split("\n");
const endpoint = `ws://127.0.0.1:${content[0].trim()}${content.slice(1).join("").trim()}`;

const approval = spawn(
  path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", remoteDebugApprovalPowerShell],
  {
    env: remoteDebugApprovalEnvironment(userDataDir, 90_000),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
approval.stdout.on("data", (c) => process.stdout.write(`[approval] ${c}`));

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  const page = await browser.newPage();
  await page.goto(
    "chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=extensions",
    { waitUntil: "networkidle2", timeout: 30_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const clicked = await page.evaluate(() => {
    const icon = document.getElementById(
      "i_XzcxNzYwYzUxLTk1ZDAtNGRiYy05MjNhLTBiMTZlNDhhNDk0Mg_delete",
    );
    if (!icon) return "trash icon not found";
    icon.click();
    return "clicked trash";
  });
  console.log(clicked);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const dialog = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button, input[type='button'], .ui-button")].filter(
      (el) => el.offsetParent !== null,
    );
    return buttons.map((el) => ({
      text: (el.innerText || el.value || "").trim().slice(0, 40),
      cls: String(el.className).slice(0, 60),
    }));
  });
  console.log("visible buttons:", JSON.stringify(dialog));
  const confirmed = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll("button, input[type='button'], .ui-button")].filter(
      (el) => el.offsetParent !== null,
    );
    const target = candidates.find((el) =>
      /^(削除|はい|OK|はい、削除します|Delete|Yes)$/.test((el.innerText || el.value || "").trim()),
    );
    if (!target) return "confirm button not found";
    target.click();
    return `confirmed: ${(target.innerText || target.value || "").trim()}`;
  });
  console.log(confirmed);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const remaining = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")].filter((r) =>
      r.innerText.includes("マイルストーン"),
    );
    return rows.length;
  });
  console.log("milestone rows remaining:", remaining);
  await page.close();
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
