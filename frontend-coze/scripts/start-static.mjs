import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "out");
const port = Number(process.env.PORT || 3000);
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || "").trim().replace(/\/+$/, "");
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json", ".csv": "text/csv; charset=utf-8" };

if (!existsSync(outputRoot)) {
  console.error("out/ not found. Run pnpm build first.");
  process.exit(1);
}

createServer((request, response) => {
  let rawPathname;
  try {
    rawPathname = decodeURIComponent((request.url || "/").split("?")[0]);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad path");
    return;
  }
  const pathname = basePath && (rawPathname === basePath || rawPathname.startsWith(`${basePath}/`))
    ? rawPathname.slice(basePath.length) || "/"
    : rawPathname;
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  if (relative.startsWith("..")) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad path");
    return;
  }
  const requested = join(outputRoot, relative);
  const candidates = [requested, pathname.endsWith("/") ? join(requested, "index.html") : requested + ".html", join(requested, "index.html")];
  const filePath = candidates.find((candidate) => {
    try { return statSync(candidate).isFile(); } catch { return false; }
  });
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  const normalizedFile = filePath.replaceAll("\\", "/");
  const cacheControl = normalizedFile.includes("/_next/static/")
    ? "public, max-age=31536000, immutable"
    : normalizedFile.includes("/dashboard-data/")
      ? "public, max-age=300"
      : "no-cache";
  const fileStat = statSync(filePath);
  const etag = `"${fileStat.size.toString(16)}-${fileStat.mtimeMs.toString(16)}"`;
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": cacheControl });
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Content-Length": fileStat.size,
    ETag: etag,
    "Cache-Control": cacheControl,
  });
  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(filePath).pipe(response);
  }
}).listen(port, "0.0.0.0", () => {
  console.log("Static Coze demo listening on http://localhost:" + port);
});
