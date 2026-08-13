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
  const result = await page.evaluate(async () => {
    const databases = await indexedDB.databases();
    const summary = [];
    for (const dbInfo of databases) {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbInfo.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const storeName of db.objectStoreNames) {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const keys = await new Promise((resolve, reject) => {
          const request = store.getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (storeName.toLowerCase().includes("script") || keys.length < 30) {
          summary.push({ db: dbInfo.name, store: storeName, keyCount: keys.length, keys: keys.slice(0, 20) });
        } else {
          summary.push({ db: dbInfo.name, store: storeName, keyCount: keys.length });
        }
      }
      db.close();
    }
    return summary;
  });
  console.log(JSON.stringify(result, null, 1).slice(0, 5000));
  await page.close();
  browser.disconnect();
  approval.kill();
  process.exit(0);
})().catch((error) => {
  console.error("ERR", error.message);
  approval.kill();
  process.exit(1);
});
