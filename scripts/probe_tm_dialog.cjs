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
    const rect = icon.getBoundingClientRect();
    const options = { bubbles: true, cancelable: true, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    icon.dispatchEvent(new MouseEvent("mousedown", options));
    icon.dispatchEvent(new MouseEvent("mouseup", options));
    icon.dispatchEvent(new MouseEvent("click", options));
    return `dispatched at ${JSON.stringify(rect)}`;
  });
  console.log(clicked);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const dialogs = await page.evaluate(() => {
    const found = [...document.querySelectorAll("[role='dialog'], .ui-dialog, .modal, dialog, .messagebox, [class*='dialog' i]")];
    return found.map((el) => ({
      cls: String(el.className).slice(0, 80),
      visible: el.offsetParent !== null || getComputedStyle(el).display !== "none",
      text: el.innerText.slice(0, 200),
      buttons: [...el.querySelectorAll("*")].filter((c) => /button/i.test(c.tagName) || c.getAttribute("role") === "button").map((c) => (c.innerText || c.value || "").trim().slice(0, 30)),
    }));
  });
  console.log(JSON.stringify(dialogs, null, 1));
  await page.close();
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
