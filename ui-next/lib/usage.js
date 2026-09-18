// Context-window report — reads token usage straight from Claude Code transcripts
// (~/.claude/projects/**/*.jsonl). No network, no extra deps.
import fs from "fs";
import path from "path";
import { claudeHome } from "./config.js";

function listTranscripts() {
  const root = path.join(claudeHome(), "projects");
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const dir of fs.readdirSync(root)) {
    const sub = path.join(root, dir);
    let st;
    try { st = fs.statSync(sub); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of fs.readdirSync(sub)) if (f.endsWith(".jsonl")) out.push(path.join(sub, f));
  }
  return out;
}

function fmtTok(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// Find a session transcript (<session-id>.jsonl) anywhere under ~/.claude/projects. Session ids are
// unique UUIDs, so a basename match avoids guessing Claude Code's cwd→dirname encoding.
function findSessionTranscript(sessionId) {
  if (!sessionId) return null;
  for (const f of listTranscripts()) if (path.basename(f) === sessionId + ".jsonl") return f;
  return null;
}

// Context-window footprint of the LATEST assistant turn: the prompt the model saw
// = input + cache_read + cache_creation. Closest headless proxy for the TUI's /context (the colored
// per-category grid — system/memory/MCP/history — is interactive-only). output_tokens is the new
// generation, not part of the context the next turn carries.
export function buildContextReport(sessionId) {
  if (!sessionId) return "ℹ️ Chưa có phiên — gửi một tin nhắn trước rồi gõ /context.";
  let file;
  try { file = findSessionTranscript(sessionId); } catch (e) { return "⚠ Không đọc được context: " + e.message; }
  if (!file) return "ℹ️ Chưa tìm thấy transcript cho phiên này (có thể phiên vừa bắt đầu).";

  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return "⚠ Không đọc được transcript: " + e.message; }
  let last = null, turns = 0, model = "";
  for (const line of raw.split("\n")) {
    if (!line || !line.includes('"usage"')) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const u = evt && evt.message && evt.message.usage;
    if (!u || evt.type !== "assistant") continue;
    turns++;
    last = u;
    model = evt.message.model || model;
  }
  if (!last) return "ℹ️ Phiên chưa có lượt trả lời nào để đo context.";

  const input = last.input_tokens || 0;
  const cacheRead = last.cache_read_input_tokens || 0;
  const cacheWrite = last.cache_creation_input_tokens || 0;
  const ctx = input + cacheRead + cacheWrite;
  const out = last.output_tokens || 0;
  const WIN = 200000; // cửa sổ chuẩn; model context 1M (vd Opus [1m]) sẽ rộng gấp ~5×
  const pct = ((ctx / WIN) * 100).toFixed(1);

  const L = [];
  L.push("🧮 Context phiên hiện tại (đọc transcript local — không có lưới phân loại như TUI)");
  L.push("");
  L.push(`Lượt mới nhất${model ? " · " + model.replace(/^claude-/, "") : ""} · ${turns} lượt có usage:`);
  L.push(`  Context đang chiếm ≈ ${fmtTok(ctx)} tokens  (~${pct}% của 200K)`);
  L.push(`    • prompt mới (input): ${fmtTok(input)}`);
  L.push(`    • cache đọc lại:      ${fmtTok(cacheRead)}`);
  L.push(`    • cache ghi mới:      ${fmtTok(cacheWrite)}`);
  L.push(`  Sinh ra (output) lượt này: ${fmtTok(out)}`);
  L.push("");
  L.push("* Ước lượng từ usage lượt cuối; model context 1M thì % thực tế nhỏ hơn nhiều.");
  return L.join("\n");
}
