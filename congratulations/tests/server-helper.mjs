import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: projectRoot,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");

  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const expected = `Celebration server listening on http://127.0.0.1:${port}`;
  try {
    await new Promise((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error(`Server did not start.\n${stderr}`));
      }, 5_000);

      function cleanup() {
        clearTimeout(timeout);
        child.off("exit", handleExit);
        child.stdout.off("data", handleOutput);
      }

      function handleExit(code) {
        cleanup();
        rejectReady(new Error(`Server exited with code ${code}.\n${stderr}`));
      }

      function handleOutput(chunk) {
        stdout += chunk;
        if (!stdout.includes(expected)) {
          return;
        }
        cleanup();
        resolveReady();
      }

      child.once("exit", handleExit);
      child.stdout.on("data", handleOutput);
    });
  } catch (error) {
    if (child.exitCode === null) {
      child.kill();
      await once(child, "exit");
    }
    throw error;
  }

  return {
    origin: `http://127.0.0.1:${port}`,
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
