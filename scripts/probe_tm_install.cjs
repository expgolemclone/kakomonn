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
const scriptPath = path.resolve(__dirname, "..", "kakomonn-reader", "kakomonn-reader.user.js");
const content = fs
  .readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8")
  .trim()
  .split("\n");
const endpoint = `ws://127.0.0.1:${content[0].trim()}${content.slice(1).join("").trim()}`;

const approval = spawn(
  path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", remoteDebugApprovalPowerShell],
  {
    env: remoteDebugApprovalEnvironment(userDataDir, 120_000),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  },
);
approval.stdout.on("data", (c) => process.stdout.write(`[approval] ${c}`));

(async () => {
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint });
  const page = await browser.newPage();
  await page.goto(
    "chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=utils",
    { waitUntil: "networkidle2", timeout: 30_000 },
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const input = await page.$("input[type=file]");
  if (!input) throw new Error("no file input");
  await input.uploadFile(scriptPath);
  console.log("file set");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (let i = 0; i < 10; i++) {
    const state = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button, a.button, input[type=button]")].map(
        (b) => (b.textContent || b.value || "").trim(),
      ).filter(Boolean);
      return { buttons, text: document.body.innerText.slice(0, 1500) };
    });
    console.log(`--- tick ${i} ---`);
    console.log("buttons:", JSON.stringify(state.buttons));
    console.log(state.text);
    const install = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button, a.button, input[type=button]")];
      const target = buttons.find((b) => /^(インストール|更新|Install|Update)$/.test((b.textContent || b.value || "").trim()));
      if (!target) return "";
      target.click();
      return (target.textContent || target.value || "").trim();
    }).catch(() => "");
    if (install) {
      console.log("clicked install at tick", i);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const after = await page.evaluate(() => document.body.innerText.slice(0, 2000));
  console.log("--- after click ---");
  console.log(after);
  await page.screenshot({ path: "C:\\Users\\0000250059\\AppData\\Local\\Temp\\tm-install.png" });
  await page.close();
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
