import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runToolWorkspace } from '@expgolemclone/envx-runtime';

const readerRoot = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(readerRoot, 'dist/kakomonn-reader.user.js');

export async function buildReader() {
  const status = runToolWorkspace('vite', ['build', '--config', 'kakomonn-reader/vite.config.mjs'], resolve(readerRoot, '..'));
  if (status !== 0) throw Error(`Reader build failed with exit code ${status}`);
  const source = await readFile(outputPath, 'utf8');
  const version = source.match(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/m)?.[1];
  const fingerprint = source.match(/const BUILD_FINGERPRINT = "([0-9a-f]{64})";/)?.[1];
  if (!version || !fingerprint) throw Error('Generated userscript identity is invalid');
  console.log(outputPath);
  return { fingerprint, outputPath, source, version };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await buildReader();
}
