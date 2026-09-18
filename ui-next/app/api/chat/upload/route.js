// File upload for the chat console. Saves under .ai-uploads/ inside the chatted project's cwd
// (rezil | free) so the agent — which runs with that cwd — can Read it via a relative path.
// Accepts images and Excel, stored verbatim (the agent's Read parses them). See lib/upload.js.
// Gating is handled by the proxy Basic Auth.
import { resolveProject, normalizeProject } from "../../../../lib/config.js";
import { saveUpload } from "../../../../lib/upload.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  const { searchParams } = new URL(req.url);
  const project = normalizeProject(searchParams.get("project"));

  let form;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Yêu cầu không hợp lệ" }, { status: 400 });
  }

  try {
    const proj = resolveProject(project);
    const meta = await saveUpload(form.get("file"), proj.cwd);
    return Response.json(meta);
  } catch (e) {
    return Response.json({ error: e.message || "Tải lên thất bại" }, { status: e.status || 500 });
  }
}
