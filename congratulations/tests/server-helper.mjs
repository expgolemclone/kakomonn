import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import kakomonnConfig from "../../scripts/kakomonn-config.cjs";

const { kakomonnFreeEnvironment } = kakomonnConfig;

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(projectRoot, "..");
const wranglerPath = resolve(
  repositoryRoot,
  "node_modules",
  "wrangler",
  "bin",
  "wrangler.js",
);

async function getAvailablePort() {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (address === null || typeof address !== "object") {
    throw new Error("An available local port was not assigned.");
  }

  await new Promise((resolveClose, rejectClose) => {
    probe.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
  return address.port;
}

export async function startStaticServer() {
  const port = await getAvailablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      wranglerPath,
      "dev",
      "--config",
      resolve(projectRoot, "wrangler.jsonc"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: repositoryRoot,
      env: kakomonnFreeEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  try {
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const deadline = Date.now() + 10_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Wrangler exited with code ${child.exitCode}.\n${stderr}`);
      }
      try {
        const response = await fetch(origin, { redirect: "manual" });
        if (response.status >= 200 && response.status < 500) {
          ready = true;
          break;
        }
      } catch {
        // Wrangler has not started listening yet.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    if (!ready) {
      throw new Error(`Wrangler did not start.\n${stderr}\n${stdout}`);
    }
  } catch (error) {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    throw error;
  }

  return {
    origin,
    getStderr: () => stderr,
    async stop() {
      if (child.exitCode !== null) {
        return;
      }
      const exited = once(child, "exit");
      child.kill();
      await exited;
    },
  };
}
