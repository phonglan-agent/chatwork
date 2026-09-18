// Telegram long-polling bot: turns Telegram into a 2nd chat channel that drives the ai-agent,
// reusing the exact chat plumbing of the web UI (buildChatArgv/handleEvent/flushSuggest in
// lib/claude.js) so behaviour, prompts and tool guardrails stay identical across both channels.
//
// Started once at server boot from instrumentation.js — a no-op unless TELEGRAM_BOT_TOKEN is set,
// so it is safe to ship disabled. Config via env (see .env.example):
//   TELEGRAM_BOT_TOKEN            bot token from @BotFather (required to enable)
//   TELEGRAM_ALLOWED_CHAT_IDS     comma-separated chat ids allowed to use the bot (empty = reply
//                                 with the caller's id so they can whitelist themselves, no run)
//   TELEGRAM_PROJECT              rezil | free  (default: rezil)
//   TELEGRAM_CAN_EDIT             "1" to allow Edit/Write/Bash (default: read-only)
//   TELEGRAM_TIMEOUT_MS           hard cap per message run in ms (default: 600000 = 10 min)
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "node:url";
import {
  buildChatArgv,
  handleEvent,
  flushSuggest,
  resolveProject,
  normalizeProject,
} from "./claude.js";

const API_BASE = "https://api.telegram.org/bot";
const TG_LIMIT = 4000; // Telegram hard limit is 4096; keep margin for safety.
const POLL_TIMEOUT = 30; // long-poll seconds

function cfg() {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const project = normalizeProject(process.env.TELEGRAM_PROJECT || "rezil");
  const canEdit = process.env.TELEGRAM_CAN_EDIT === "1";
  const timeoutMs = Number(process.env.TELEGRAM_TIMEOUT_MS || 600000) || 600000;
  return { token, allowed, project, canEdit, timeoutMs };
}

// ---- tiny persistence: { offset, sessions: { [chatId]: claudeSessionId } } ----
const STATE_FILE = path.join(process.cwd(), ".telegram-state.json");
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return { offset: s.offset || 0, sessions: s.sessions || {} };
  } catch {
    return { offset: 0, sessions: {} };
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error("[telegram] cannot persist state:", e.message);
  }
}

// ---- Telegram REST helpers ----
async function tg(token, method, body) {
  const res = await fetch(`${API_BASE}${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

function chunk(text, size) {
  const out = [];
  let s = text;
  while (s.length > size) {
    // Prefer a newline break near the limit so we don't split mid-line.
    let cut = s.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = size;
    out.push(s.slice(0, cut));
    s = s.slice(cut);
  }
  if (s) out.push(s);
  return out;
}

async function sendMessage(token, chatId, text, replyMarkup) {
  const body = (text || "").trim() || "(không có nội dung trả lời)";
  const parts = chunk(body, TG_LIMIT);
  for (let i = 0; i < parts.length; i++) {
    const payload = { chat_id: chatId, text: parts[i] };
    // Plain text (no parse_mode): claude output is GFM and would frequently break MarkdownV2.
    // Attach the inline keyboard (follow-up chips) only to the LAST chunk.
    if (replyMarkup && i === parts.length - 1) payload.reply_markup = replyMarkup;
    await tg(token, "sendMessage", payload);
  }
}

function sendTyping(token, chatId) {
  return tg(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
}

// ---- outbound notify: fire-and-forget completion pings from OTHER routes (e.g. /api/chat) once a
// console-agent run finishes. Independent of the polling bot above — only needs TELEGRAM_BOT_TOKEN +
// TELEGRAM_NOTIFY_CHAT_IDS (comma-separated; get an id via the bot's /whoami, same as the allowlist).
// No-op if either is unset, so it's safe to leave disabled.
export async function notifyTelegram(text) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const ids = (process.env.TELEGRAM_NOTIFY_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!token || !ids.length) return;
  await Promise.all(
    ids.map((chatId) =>
      sendMessage(token, chatId, text).catch((e) => console.error("[telegram] notify failed:", e.message))
    )
  );
}

// Map a raw claude tool name (as emitted by handleEvent) to a short Vietnamese progress line.
function toolLabel(raw) {
  if (!raw) return "🔧 …";
  if (raw.startsWith("↳ agent:")) return "🤖 " + raw.slice(8).trim();
  if (raw.startsWith("↳ ")) return "🤖 " + raw.slice(2).trim();
  if (raw === "phiên bắt đầu") return "⏳ Khởi tạo phiên";
  if (raw.startsWith("mcp__atlassian")) return "🔷 Jira";
  if (raw.startsWith("mcp__mysql") || raw.startsWith("mcp__postgres")) return "🗄️ Query DB";
  if (raw.startsWith("mcp__gsheets")) return "📊 Google Sheet";
  if (raw.startsWith("mcp__")) return "🔌 " + raw.replace(/^mcp__/, "");
  const M = {
    Read: "📖 Đọc file",
    Edit: "✏️ Sửa file",
    Write: "✏️ Ghi file",
    Bash: "💻 Chạy lệnh",
    Grep: "🔎 Tìm trong code",
    Glob: "🔎 Quét file",
    WebSearch: "🌐 Tìm web",
    WebFetch: "🌐 Tải trang",
    Agent: "🤖 Gọi agent",
    Task: "🤖 Gọi agent",
    TodoWrite: "📝 Ghi todo",
  };
  return M[raw] || "🔧 " + raw;
}

// A self-throttling "progress" message: appends tool steps and edits a single Telegram message
// at most once every ~1.5s. Nothing is sent for fast runs (first edit fires after the delay, so a
// quick answer calls done() before any message exists → no clutter). done() removes the message.
function makeProgress(token, chatId) {
  const steps = [];
  let msgId = null;
  let lastEdit = 0;
  let timer = null;
  let closed = false;

  const render = () => {
    const shown = steps.slice(-8);
    const more = steps.length > shown.length ? `…(+${steps.length - shown.length} bước trước)\n` : "";
    return "⏳ Agent đang chạy…\n" + more + shown.map((s) => "• " + s).join("\n");
  };
  const flush = async () => {
    timer = null;
    if (closed) return;
    lastEdit = Date.now();
    const text = render();
    if (msgId == null) {
      const r = await tg(token, "sendMessage", { chat_id: chatId, text });
      if (r && r.ok) msgId = r.result.message_id;
    } else {
      await tg(token, "editMessageText", { chat_id: chatId, message_id: msgId, text }).catch(() => {});
    }
  };
  return {
    step(label) {
      steps.push(label);
      if (closed || timer) return;
      const wait = Math.max(0, 1500 - (Date.now() - lastEdit));
      timer = setTimeout(() => { flush().catch(() => {}); }, wait);
    },
    async done() {
      closed = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (msgId != null) await tg(token, "deleteMessage", { chat_id: chatId, message_id: msgId }).catch(() => {});
    },
  };
}

// Last set of follow-up suggestions per chat, so an inline-button tap (callback_data "s:<i>") can
// recover the full suggestion text (callback_data is capped at 64 bytes — can't carry it inline).
const pendingSuggest = new Map();

// ---- run one turn through the claude CLI, collecting the final visible text ----
// onProgress(rawToolName) is called for each tool the agent invokes (for the live status message).
function runClaude({ project, canEdit, timeoutMs }, message, sessionId, onProgress) {
  return new Promise((resolve) => {
    const proj = resolveProject(project);
    const argv = buildChatArgv(project, message, sessionId, canEdit, proj.addDirs);

    let child;
    try {
      // Cùng trần Bash với agent do console spawn (xem agentEnv trong lib/claude.js).
      child = spawn("claude", argv, {
        cwd: proj.cwd,
        env: process.env.BASH_MAX_TIMEOUT_MS ? process.env : { ...process.env, BASH_MAX_TIMEOUT_MS: "1200000" },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ text: "⚠️ Không chạy được claude: " + e.message, session: sessionId, isError: true, suggest: [] });
      return;
    }

    const state = { streamed: new Set(), curMsg: null };
    let text = "";
    let session = sessionId;
    let isError = false;
    let stderr = "";
    let buf = "";
    let suggest = [];

    let settled = false;
    let sawResult = false;

    // Reuse the SSE event model: visible `delta` text, session id, tool events, and the SUGGEST list.
    // The `result` event carries the completed answer; the claude process then spends several more
    // seconds tearing down MCP servers before it exits. We finalize on `result` (not on process
    // close) so the user gets the reply ~5s sooner, and SIGTERM the child to hurry its teardown.
    const emit = (event, data) => {
      if (event === "delta") text += data;
      else if (event === "session") session = data;
      else if (event === "error_msg") stderr += String(data);
      else if (event === "tool") { if (onProgress) onProgress(data); }
      else if (event === "suggest") suggest = Array.isArray(data) ? data : [];
      else if (event === "result") { isError = !!data.isError; sawResult = true; }
    };

    const finalize = () => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      flushSuggest(state, emit); // flush held-back tail + emit the SUGGEST list as a `suggest` event
      const out = text.trim();
      resolve({
        text: out || (isError ? "⚠️ " + (stderr.trim() || "Lỗi không xác định.") : "(agent không trả về nội dung)"),
        session,
        isError,
        suggest,
      });
      // Answer already sent to the caller; let claude tear down MCP servers in the background.
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 3000);
    };

    const killTimer = setTimeout(() => {
      isError = true;
      stderr += `\n⏱️ Quá thời gian cho phép (${Math.round(timeoutMs / 60000)} phút).`;
      finalize();
    }, timeoutMs);

    child.stdout.on("data", (c) => {
      buf += c.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { continue; }
        if (evt.session_id) session = evt.session_id;
        handleEvent(evt, emit, state);
      }
      if (sawResult) finalize(); // reply as soon as the turn's result arrives
    });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => {
      if (settled) return;
      clearTimeout(killTimer);
      settled = true;
      resolve({ text: "⚠️ claude lỗi: " + e.message, session, isError: true, suggest: [] });
    });
    child.on("close", () => finalize()); // fallback: process ended without a result event
  });
}

// ---- pm2 ops commands: run the pm2 CLI DIRECTLY, never through the claude agent ----
// This is the rescue channel. It has to work when the agent is broken, out of quota, or the Next app
// is dead — so no `claude` spawn here, just pm2. Blast radius is limited to TELEGRAM_PM2_APPS so a
// hastily typed message can't touch unrelated apps on this machine.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESTART_SH = path.join(HERE, "..", "scripts", "pm2-restart.sh");

function pm2Apps() {
  return (process.env.TELEGRAM_PM2_APPS || "ai-agent-ui-next,ai-agent-telegram")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// Small exec helper: never rejects — returns {code, out} with stdout+stderr merged.
function run(cmd, args, timeoutMs = 25000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      resolve({ code: -1, out: e.message });
      return;
    }
    let out = "";
    const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, timeoutMs);
    child.stdout.on("data", (d) => { out += d.toString("utf8"); });
    child.stderr.on("data", (d) => { out += d.toString("utf8"); });
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, out: out + e.message }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

async function pm2List() {
  const { code, out } = await run("pm2", ["jlist"]);
  if (code !== 0) return null;
  const i = out.indexOf("[");
  if (i < 0) return null;
  try {
    return JSON.parse(out.slice(i));
  } catch {
    return null;
  }
}

function fmtUptime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.round(s / 60) + "m";
  if (s < 86400) return Math.round(s / 3600) + "h";
  return Math.round(s / 86400) + "d";
}

async function cmdStatus(conf, chatId) {
  const list = await pm2List();
  if (!list) {
    await sendMessage(
      conf.token,
      chatId,
      "⚠️ Không đọc được pm2 (daemon có thể đã chết). Thử /restart <app> — script sẽ dựng lại từ ecosystem."
    );
    return;
  }
  const lines = pm2Apps().map((name) => {
    const p = list.find((x) => x.name === name);
    if (!p) return `⚪ ${name} · pm2 không thấy app này (dùng /restart ${name} để dựng lại)`;
    const st = p.pm2_env?.status || "?";
    const icon = st === "online" ? "🟢" : st === "stopped" ? "🔴" : "🟡";
    const up = p.pm2_env?.pm_uptime && st === "online" ? " · up " + fmtUptime(Date.now() - p.pm2_env.pm_uptime) : "";
    const mem = p.monit?.memory ? " · " + Math.round(p.monit.memory / 1048576) + "mb" : "";
    return `${icon} ${name} · ${st}${up} · ↺${p.pm2_env?.restart_time ?? 0}${mem}`;
  });
  await sendMessage(conf.token, chatId, "📊 Trạng thái pm2\n\n" + lines.join("\n"));
}

async function cmdRestart(conf, chatId, arg) {
  const apps = pm2Apps();
  // `--fresh` = delete + start lại từ ecosystem, cần khi vừa sửa ui-next/.env (pm2 restart không nạp
  // lại file đó — xem scripts/pm2-restart.sh). Cờ đặt ở vị trí nào cũng được: "/restart --fresh".
  const words = (arg || "").split(/\s+/).filter(Boolean);
  const fresh = words.includes("--fresh");
  const target = (words.find((w) => !w.startsWith("-")) || apps[0]).trim();
  if (!apps.includes(target)) {
    await sendMessage(conf.token, chatId, `⛔ Chỉ khởi động lại được: ${apps.join(", ")}`);
    return;
  }
  await sendMessage(
    conf.token,
    chatId,
    `♻️ Đang khởi động lại '${target}'${fresh ? " (--fresh: delete + start, nạp lại .env)" : ""}… Kết quả sẽ báo lại sau ~10-45s.`
  );
  // Detached on purpose: the target may be THIS process. scripts/pm2-restart.sh setsid's itself,
  // runs the restart → verify → delete+start escalation, and reports the outcome back to this chat
  // (NOTIFY_CHAT_ID) — so the answer arrives even if the bot itself was the thing being restarted.
  try {
    const child = spawn("bash", fresh ? [RESTART_SH, target, "--fresh"] : [RESTART_SH, target], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, NOTIFY_CHAT_ID: String(chatId) },
    });
    child.unref();
  } catch (e) {
    await sendMessage(conf.token, chatId, "⚠️ Không chạy được script restart: " + e.message);
  }
}

async function cmdLogs(conf, chatId, arg) {
  const apps = pm2Apps();
  const [name, count] = arg.split(/\s+/).filter(Boolean);
  const target = (name || apps[0]).trim();
  if (!apps.includes(target)) {
    await sendMessage(conf.token, chatId, `⛔ Chỉ xem log được: ${apps.join(", ")}`);
    return;
  }
  const lines = Math.min(Math.max(Number(count) || 40, 1), 200);
  const { out } = await run("pm2", ["logs", target, "--lines", String(lines), "--nostream"]);
  const body = (out || "").trim() || "(không có log)";
  await sendMessage(conf.token, chatId, `📜 ${target} · ${lines} dòng cuối\n\n` + body.slice(-3500));
}

const HELP =
  "🤖 AI Agent bot\n\n" +
  "Gõ tin nhắn bất kỳ để giao việc cho agent (giữ ngữ cảnh nhiều lượt).\n\n" +
  "Lệnh:\n" +
  "/new — bắt đầu phiên mới (quên ngữ cảnh cũ)\n" +
  "/whoami — xem chat id của bạn\n" +
  "/help — trợ giúp\n\n" +
  "Vận hành (chạy thẳng pm2, không qua agent — dùng được cả khi agent hỏng):\n" +
  "/status — trạng thái các app pm2\n" +
  "/restart [app] [--fresh] — khởi động lại (mặc định ai-agent-ui-next; --fresh = delete + start, nạp lại .env)\n" +
  "/logs [app] [số dòng] — log gần nhất (mặc định 40 dòng)";

async function handleMessage(conf, state, msg) {
  const chatId = msg.chat?.id;
  const text = (msg.text || "").trim();
  if (!chatId || !text) return;
  const chatKey = String(chatId);

  // Auth gate. Empty allowlist → help the operator whitelist themselves (never runs the agent).
  if (conf.allowed.length && !conf.allowed.includes(chatKey)) {
    await sendMessage(conf.token, chatId, `⛔ Chat id ${chatKey} chưa được cấp quyền.`);
    return;
  }
  if (!conf.allowed.length) {
    await sendMessage(
      conf.token,
      chatId,
      `Chat id của bạn: ${chatKey}\nThêm vào TELEGRAM_ALLOWED_CHAT_IDS trong .env rồi khởi động lại để dùng.`
    );
    return;
  }

  // Commands.
  if (text === "/start" || text === "/help") {
    await sendMessage(conf.token, chatId, HELP);
    return;
  }
  if (text === "/whoami") {
    await sendMessage(conf.token, chatId, `Chat id: ${chatKey}`);
    return;
  }
  if (text === "/new" || text === "/reset") {
    delete state.sessions[chatKey];
    saveState(state);
    await sendMessage(conf.token, chatId, "🆕 Đã bắt đầu phiên mới.");
    return;
  }

  // Ops commands — handled here, NOT by the agent: they must still work when the agent can't run.
  if (text === "/status") {
    await cmdStatus(conf, chatId);
    return;
  }
  if (text === "/restart" || text.startsWith("/restart ")) {
    await cmdRestart(conf, chatId, text.slice("/restart".length).trim());
    return;
  }
  if (text === "/logs" || text.startsWith("/logs ")) {
    await cmdLogs(conf, chatId, text.slice("/logs".length).trim());
    return;
  }

  await runTurn(conf, state, chatId, text);
}

// Run one agent turn: typing indicator + live tool-progress message, then the answer with
// follow-up suggestion buttons. Shared by plain messages and suggestion-button taps.
async function runTurn(conf, state, chatId, text) {
  const chatKey = String(chatId);
  await sendTyping(conf.token, chatId);
  const typing = setInterval(() => sendTyping(conf.token, chatId), 4000);
  const progress = makeProgress(conf.token, chatId);
  progress.step("🚀 Đang khởi động agent…"); // instant feedback; claude cold-start is ~8s
  try {
    const prev = state.sessions[chatKey] || "";
    const { text: answer, session, suggest } = await runClaude(conf, text, prev, (raw) => progress.step(toolLabel(raw)));
    if (session) {
      state.sessions[chatKey] = session;
      saveState(state);
    }
    clearInterval(typing);
    await progress.done();

    const items = (suggest || []).slice(0, 4).filter((s) => typeof s === "string" && s.trim());
    let replyMarkup;
    if (items.length) {
      pendingSuggest.set(chatKey, items);
      replyMarkup = {
        inline_keyboard: items.map((s, i) => [
          { text: s.length > 60 ? s.slice(0, 57) + "…" : s, callback_data: "s:" + i },
        ]),
      };
    } else {
      pendingSuggest.delete(chatKey);
    }
    await sendMessage(conf.token, chatId, answer, replyMarkup);
  } catch (e) {
    clearInterval(typing);
    await progress.done();
    await sendMessage(conf.token, chatId, "⚠️ Lỗi xử lý: " + e.message);
  }
}

// A tapped follow-up chip: ack it, recover the suggestion text, echo it, then run it as a turn.
async function handleCallback(conf, state, cq) {
  const chatId = cq.message?.chat?.id;
  if (!chatId) return;
  const chatKey = String(chatId);
  await tg(conf.token, "answerCallbackQuery", { callback_query_id: cq.id }).catch(() => {});
  if (conf.allowed.length && !conf.allowed.includes(chatKey)) return;

  const m = /^s:(\d+)$/.exec(cq.data || "");
  if (!m) return;
  const text = (pendingSuggest.get(chatKey) || [])[Number(m[1])];
  // Drop the keyboard from the old message so a chip can't be tapped twice.
  await tg(conf.token, "editMessageReplyMarkup", { chat_id: chatId, message_id: cq.message.message_id }).catch(() => {});
  if (!text) {
    await sendMessage(conf.token, chatId, "Gợi ý đã hết hạn, sếp gõ lại giúp em nhé.");
    return;
  }
  await sendMessage(conf.token, chatId, "▶️ " + text);
  await runTurn(conf, state, chatId, text);
}

// Per-chat serial queue so two messages from the same chat don't run claude on the same session
// concurrently; different chats still run in parallel.
function makeQueue() {
  const chains = new Map();
  return (key, fn) => {
    const prev = chains.get(key) || Promise.resolve();
    const next = prev.then(fn).catch((e) => console.error("[telegram] handler error:", e));
    chains.set(key, next.finally(() => { if (chains.get(key) === next) chains.delete(key); }));
    return next;
  };
}

async function pollLoop(conf, state) {
  const enqueue = makeQueue();
  console.log(
    `[telegram] bot started · project=${conf.project} edit=${conf.canEdit ? "on" : "off"} ` +
      `allowlist=${conf.allowed.length || "OPEN"}`
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let data;
    try {
      const res = await fetch(
        `${API_BASE}${conf.token}/getUpdates?timeout=${POLL_TIMEOUT}&offset=${state.offset}` +
          `&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`
      );
      data = await res.json();
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!data || !data.ok) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const upd of data.result || []) {
      state.offset = upd.update_id + 1;
      saveState(state);
      if (upd.message)
        enqueue(String(upd.message.chat?.id), () => handleMessage(conf, state, upd.message));
      else if (upd.callback_query)
        enqueue(String(upd.callback_query.message?.chat?.id), () => handleCallback(conf, state, upd.callback_query));
    }
  }
}

let started = false;
export function startTelegramBot() {
  if (started) return;
  const conf = cfg();
  if (!conf.token) return; // disabled: no token configured
  started = true;
  const state = loadState();
  pollLoop(conf, state).catch((e) => {
    started = false;
    console.error("[telegram] poll loop crashed:", e);
  });
}
