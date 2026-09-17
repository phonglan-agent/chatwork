#!/usr/bin/env node
// Trạng thái "tab nào đã soát" của console /translate.
//
// Vì sao là script chứ không để agent tự ghi file: màn /translate chặn Write/Edit (xem lib/translate.js)
// để nó không sửa được file repo. Script này là ĐƯỜNG GHI DUY NHẤT, phạm vi hẹp — chỉ một file JSON,
// chỉ các trường cố định. Agent gọi qua Bash.
//
// Dùng:
//   node ui-next/scripts/translate-state.mjs list [--pair portal] [--json]
//   node ui-next/scripts/translate-state.mjs add --pair portal --file Portal --sheet "Error Msg" \
//        --items 87 --diffs 2 --result "2 T4"
//   node ui-next/scripts/translate-state.mjs clear --pair portal [--sheet "Error Msg"]
//
// File trạng thái: ui-next/data/translate-scan-state.json (git-ignored).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "..", "data", "translate-scan-state.json");

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(j.scans) ? j : { scans: [] };
  } catch {
    return { scans: [] };
  }
}

function save(state) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // Ghi qua file tạm rồi rename: lượt quét dài, tránh để lại JSON cụt nếu tiến trình bị giết giữa chừng.
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) o[k] = true;
      else { o[k] = v; i++; }
    }
  }
  return o;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const [cmd, ...rest] = process.argv.slice(2);
const o = args(rest);
const state = load();

if (cmd === "list") {
  const rows = state.scans.filter((s) => !o.pair || s.pair === o.pair);
  if (o.json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  if (rows.length === 0) {
    console.log(o.pair ? `Chưa soát tab nào của cặp '${o.pair}'.` : "Chưa soát tab nào.");
    process.exit(0);
  }
  console.log(`Đã soát ${rows.length} tab${o.pair ? ` (cặp ${o.pair})` : ""}:`);
  for (const s of rows) {
    console.log(
      `- [${s.pair}] ${s.sheet} | ${s.scannedAt} | mục: ${s.items ?? "?"} | lệch: ${s.diffs ?? "?"}` +
      (s.result ? ` | ${s.result}` : "") + (s.scanCount > 1 ? ` | đã soát ${s.scanCount} lần` : "")
    );
  }
  process.exit(0);
}

if (cmd === "add") {
  if (!o.pair || !o.sheet) {
    console.error("Thiếu --pair hoặc --sheet");
    process.exit(2);
  }
  const i = state.scans.findIndex((s) => s.pair === o.pair && s.sheet === o.sheet);
  const prev = i >= 0 ? state.scans[i] : null;
  const row = {
    pair: o.pair,
    file: o.file || prev?.file || "",
    sheet: o.sheet,
    scannedAt: stamp(),
    items: o.items !== undefined ? Number(o.items) : prev?.items,
    diffs: o.diffs !== undefined ? Number(o.diffs) : prev?.diffs,
    result: o.result || prev?.result || "",
    scanCount: (prev?.scanCount || 0) + 1,
  };
  if (i >= 0) state.scans[i] = row; else state.scans.push(row);
  save(state);
  console.log(`OK: [${row.pair}] ${row.sheet} — lệch ${row.diffs ?? "?"}, lần soát thứ ${row.scanCount}`);
  process.exit(0);
}

if (cmd === "clear") {
  if (!o.pair) { console.error("Thiếu --pair (dùng --pair all để xoá hết)"); process.exit(2); }
  const before = state.scans.length;
  state.scans = state.scans.filter((s) => {
    if (o.pair !== "all" && s.pair !== o.pair) return true;
    if (o.sheet && s.sheet !== o.sheet) return true;
    return false;
  });
  save(state);
  console.log(`Đã xoá ${before - state.scans.length} dòng trạng thái.`);
  process.exit(0);
}

console.error("Lệnh không hợp lệ. Dùng: list | add | clear");
process.exit(2);
