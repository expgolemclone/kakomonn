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
  const info = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("tr")];
    const row = rows.find((r) => r.innerText.includes("マイルストーン"));
    if (!row) return "no milestone row";
    const html = row.outerHTML;
    const snippets = [];
    for (const keyword of ["delete", "trash", "削除"]) {
      let index = html.indexOf(keyword);
      while (index !== -1 && snippets.length < 12) {
        snippets.push(`${keyword}@${index}: ${html.slice(Math.max(0, index - 80), index + 120)}`);
        index = html.indexOf(keyword, index + 1);
      }
    }
    return { tdCount: row.querySelectorAll("td").length, snippets };
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 4000));
  await page.close();
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
