// Serves PDF/XLSX files published at runtime by scripts/publish-file.mjs into ui-next/.downloads/,
// so the chat agent can post a Markdown link the user clicks to download.
// Same reasoning as app/api/snapshot/[name]: `next start` does not serve files added to public/
// after build, a route handler reads the file per-request. Auth: goes through proxy.js Basic Auth.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.join(process.cwd(), ".downloads");

const TYPES = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(_req, { params }) {
  const { name } = await params;
  // Only bare filenames with an allowed extension — blocks path traversal / directory escapes.
  const m = /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(pdf|xlsx)$/.exec(name || "");
  if (!m) return new Response("bad name", { status: 400 });
  try {
    const buf = await readFile(path.join(DIR, name));
    return new Response(buf, {
      headers: {
        "Content-Type": TYPES[m[1]],
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
