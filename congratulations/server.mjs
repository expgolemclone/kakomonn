import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const port = Number.parseInt(process.env.PORT ?? "4173", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const immutablePathPatterns = [
  /^\/assets\//,
  /^\/experiences\/conche\/_astro\//,
  /^\/experiences\/glyphica\/_next\/static\//,
  /^\/experiences\/halfstep\/assets\//,
];

function cacheControl(pathname) {
  return immutablePathPatterns.some((pattern) => pattern.test(pathname))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const decodedPath = decodeURIComponent(url.pathname);
    const relativePath = decodedPath.replace(/^[/\\]+/, "");
    const requestedPath =
      relativePath.length === 0 || decodedPath.endsWith("/")
        ? `${relativePath}index.html`
        : relativePath;
    const filePath = resolve(root, requestedPath);

    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const contentType = mimeTypes.get(extname(filePath)) ?? "application/octet-stream";
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": cacheControl(decodedPath),
    });
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Celebration server listening on http://127.0.0.1:${port}`);
});
