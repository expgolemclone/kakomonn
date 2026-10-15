import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { nodeCacheDirectory } from '@expgolemclone/envx-runtime';

const readerRoot = dirname(fileURLToPath(import.meta.url));
const fingerprintPlaceholder = '__KAKOMONN_READER_BUILD_FINGERPRINT__';

export default defineConfig({
  root: readerRoot,
  cacheDir: nodeCacheDirectory('kakomonn-reader-vite'),
  logLevel: 'silent',
  plugins: [{
    name: 'reader-userscript',
    enforce: 'post',
    transform(code) {
      // Vite has already inlined assets. A userscript has no module file URL.
      if (code.includes('import.meta.url')) {
        return { code: code.replaceAll('import.meta.url', 'document.baseURI'), map: null };
      }
    },
    async generateBundle(_options, bundle) {
      const outputs = Object.values(bundle);
      if (outputs.length !== 1 || outputs[0].type !== 'chunk') {
        throw Error('Reader build must emit exactly one bundled chunk');
      }
      const metadata = (await readFile(resolve(readerRoot, 'src/userscript.meta.txt'), 'utf8'))
        .replaceAll('\r\n', '\n').trimEnd();
      if (!metadata.startsWith('// ==UserScript==\n') || !metadata.endsWith('// ==/UserScript==')) {
        throw Error('Userscript metadata header is invalid');
      }
      if ([...metadata.matchAll(/^\/\/ @version\s+(\d+\.\d+\.\d+)\s*$/gm)].length !== 1) {
        throw Error('Userscript must contain one semantic @version');
      }
      const template = `${metadata}\n\n${outputs[0].code.replaceAll('\r\n', '\n').trimEnd()}\n`;
      if (template.split(fingerprintPlaceholder).length - 1 !== 1) {
        throw Error('Build fingerprint placeholder must occur exactly once');
      }
      outputs[0].code = template.replace(fingerprintPlaceholder, createHash('sha256').update(template).digest('hex'));
    },
  }],
  build: {
    outDir: resolve(readerRoot, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: Infinity,
    minify: false,
    rollupOptions: {
      input: resolve(readerRoot, 'src/main.js'),
      output: { format: 'iife', name: 'KakomonnReader', entryFileNames: 'kakomonn-reader.user.js' },
    },
  },
});
