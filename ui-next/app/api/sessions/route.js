// GET /api/sessions?project=rezil|free[&console=chat|release|evidence|…]
//   — liệt kê các phiên đã lưu của project đó.
// `console`: tách phiên theo từng màn (nhiều console ghi .jsonl chung một thư mục — xem
// lib/sessions.js). Thiếu tham số này thì trả hết như trước.
// Bảo vệ truy cập đã do proxy.js (HTTP Basic Auth) lo; ở đây chỉ đọc file .jsonl read-only.
import { listSessions } from "../../../lib/sessions.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project") || "rezil";
  const consoleKey = searchParams.get("console") || "";
  return Response.json({ sessions: listSessions(project, consoleKey || undefined) });
}
