// Shared upload handling for the chat & report consoles. A file is saved under .ai-uploads/ inside
// the agent's cwd so it can be Read via a relative path. All accepted kinds are stored verbatim;
// the agent's Read tool parses them directly:
//   - images (png/jpg/gif/webp/bmp/svg)  → Read renders the image.
//   - Excel (.xlsx/.xls)                 → Read parses the workbook directly (no server-side convert).
// `anyType` (project "free" only): skip the kind check — PDF/Word/… too. That agent has Bash, so it
// converts whatever Read can't parse (e.g. .docx via libreoffice) on its own.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = ".ai-uploads";
const MAX_BYTES = 15 * 1024 * 1024; // 15MB / file

const IMAGE_TYPES = new Set([
  "image/png", "image/jpeg", "image/gif", "image/webp", "image/bmp", "image/svg+xml",
]);
const EXCEL_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-excel", // .xls
]);
const EXCEL_EXTS = new Set([".xlsx", ".xls", ".xlsm", ".xlsb"]);

// Keep the extension, strip odd chars → guards against path traversal & junk names.
function safeBase(original, fallback) {
  return (
    path.basename(original, path.extname(original)).replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40) ||
    fallback
  );
}
function safeExt(original) {
  return path.extname(original).slice(0, 12).replace(/[^a-zA-Z0-9.]/g, "");
}

function isExcel(file) {
  return EXCEL_TYPES.has(file.type) || EXCEL_EXTS.has(path.extname(file.name || "").toLowerCase());
}

// Validate + persist one uploaded File under `<cwd>/.ai-uploads/`. Returns the metadata the client
// appends to the next prompt; throws an Error with a `.status` for the route to surface.
export async function saveUpload(file, cwd, { anyType = false } = {}) {
  if (!(file instanceof File) || file.size === 0) {
    throw Object.assign(new Error("Thiếu tệp tải lên"), { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    throw Object.assign(new Error("Tệp quá lớn (tối đa 15MB)"), { status: 400 });
  }
  const excel = isExcel(file);
  if (!anyType && !IMAGE_TYPES.has(file.type) && !excel) {
    throw Object.assign(
      new Error("Chỉ hỗ trợ ảnh và Excel (.xlsx/.xls)"),
      { status: 400 }
    );
  }

  const dir = path.join(cwd, UPLOAD_DIR);
  await mkdir(dir, { recursive: true });
  // Self-ignore the upload dir so an edit-mode agent never commits an attachment. Idempotent.
  await writeFile(path.join(dir, ".gitignore"), "*\n!.gitignore\n").catch(() => {});

  const buf = Buffer.from(await file.arrayBuffer());
  const origName = file.name || "file";
  const uid = randomUUID().slice(0, 8);

  // Both kinds (images, Excel) stored verbatim, keeping the original extension; the agent's
  // Read tool parses them directly.
  const name = `${safeBase(origName, "file")}-${uid}${safeExt(origName)}`;
  await writeFile(path.join(dir, name), buf);
  return { path: `${UPLOAD_DIR}/${name}`, name: origName, size: file.size };
}
