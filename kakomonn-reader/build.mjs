import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "vite";

const readerRoot = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(readerRoot, "src");
const outputPath = resolve(readerRoot, "kakomonn-reader.user.js");
const fingerprintPlaceholder = "__KAKOMONN_READER_BUILD_FINGERPRINT__";
const versionPattern = /^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/gm;
async function bundleReader() {
  const result = await build({
    configFile: false,
    root: readerRoot,
    logLevel: "silent",
    plugins: [{
      name: "reader-inline-module-url",
      enforce: "post",
      transform(code) {
        // Vite has already inlined the assets. A userscript has no module file URL,
        // and an inline currentScript has an empty src, which is not a valid base.
        if (code.includes("import.meta.url")) {
          return { code: code.replaceAll("import.meta.url", "document.baseURI"), map: null };
        }
      },
    }],
    build: {
      target: "es2020",
      assetsInlineLimit: Infinity,
      minify: false,
      write: false,
      rollupOptions: {
        input: resolve(sourceDirectory, "main.js"),
        output: {
          format: "iife",
          name: "KakomonnReader",
        },
      },
    },
  });
  const outputs = Array.isArray(result) ? result.flatMap((entry) => entry.output) : result.output;
  const chunks = outputs.filter((output) => output.type === "chunk");
  if (chunks.length !== 1)
    throw new Error(`reader build must emit one chunk, found ${chunks.length}`);
  return chunks[0].code.replaceAll("\r\n", "\n").trimEnd();
}

export async function buildReader() {
  const metadata = (await readFile(resolve(sourceDirectory, "userscript.meta.txt"), "utf8"))
    .replaceAll("\r\n", "\n")
    .trimEnd();
  if (!metadata.startsWith("// ==UserScript==\n") || !metadata.endsWith("// ==/UserScript==")) {
    throw new Error("userscript metadata header is invalid");
  }
  const versions = [...metadata.matchAll(versionPattern)];
  if (versions.length !== 1) {
    throw new Error(`userscript must contain one semantic @version, found ${versions.length}`);
  }

  let source = `${metadata}\n\n${await bundleReader()}\n`;
  if (source.split(fingerprintPlaceholder).length - 1 !== 1) {
    throw new Error("build fingerprint placeholder must occur exactly once");
  }
  const fingerprint = createHash("sha256").update(source).digest("hex");
  source = source.replace(fingerprintPlaceholder, fingerprint);
  await writeFile(outputPath, source, "utf8");
  console.log(outputPath);
  return { fingerprint, outputPath, source, version: versions[0][1] };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildReader();
}
