// scripts/publish-file.mjs — chép một file PDF/XLSX vào ui-next/.downloads/ rồi in ra ĐƯỜNG DẪN TẢI
// (đã kèm basePath, vd /api/download/report-1a2b3c4d.pdf) để agent chèn link Markdown vào chat.
// File được serve qua route động app/api/download/[name] — không cần build lại mỗi lần publish.
//
// Usage:
//   node <ui-next>/scripts/publish-file.mjs <file.pdf|file.xlsx> [--name ten-ngan]
// Stdout (dòng cuối) = đường dẫn tải, vd: /api/download/DinhLan-1a2b3c4d.xlsx

import { mkdirSync, existsSync, readFileSync, readdirSync, statSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_NEXT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(UI_NEXT, ".downloads"); // served via app/api/download/[name]
const MAX_KEEP = 60; // giữ tối đa 60 file, xoá cũ nhất khi vượt

const argv = process.argv.slice(2);
const src = argv[0];
const nameIdx = argv.indexOf("--name");
if (!src || !existsSync(src)) {
  console.error("Usage: node publish-file.mjs <file.pdf|file.xlsx> [--name ten-ngan]");
  process.exit(1);
}
const ext = path.extname(src).slice(1).toLowerCase();
if (!["pdf", "xlsx"].includes(ext)) {
  console.error("Chỉ hỗ trợ file .pdf và .xlsx");
  process.exit(1);
}

// Tên an toàn khớp regex của route: chỉ [a-zA-Z0-9._-], thêm hậu tố ngẫu nhiên để không đè file cũ.
const raw = nameIdx >= 0 ? argv[nameIdx + 1] || "" : path.basename(src, path.extname(src));
const base = raw.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D")
  .replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
const name = `${base}-${randomUUID().slice(0, 8)}.${ext}`;

mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(src, path.join(OUT_DIR, name));

// Dọn file cũ.
const files = readdirSync(OUT_DIR)
  .map((f) => ({ f, t: statSync(path.join(OUT_DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const { f } of files.slice(MAX_KEEP)) rmSync(path.join(OUT_DIR, f), { force: true });

function basePath() {
  if (process.env.NEXT_PUBLIC_BASE_PATH != null) return process.env.NEXT_PUBLIC_BASE_PATH;
  try {
    const env = readFileSync(path.join(UI_NEXT, ".env"), "utf8");
    const m = env.match(/^\s*NEXT_PUBLIC_BASE_PATH\s*=\s*(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return "";
}

console.log(`${basePath()}/api/download/${name}`);
