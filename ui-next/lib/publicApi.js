// API công khai cho BÊN THỨ BA gọi Claude (sinh nội dung: viết bài, tóm tắt, dịch…).
// Khác hẳn các console nội bộ (/chat, /auto, /report): endpoint này chạy Claude ở chế độ HỘP KÍN —
// không tool, không MCP, không settings/CLAUDE.md của máy, cwd là thư mục rỗng ngoài mọi repo. Bên
// thứ ba chỉ gửi được prompt và nhận về text; không có đường nào để họ đọc/sửa file hay chạy lệnh.
//
// Bảo vệ: API key riêng (PUBLIC_API_KEYS) — KHÔNG dùng UI_BASIC_AUTH, vì key phát cho khách phải
// thu hồi được từng cái mà không ảnh hưởng lối vào UI. Kèm hạn mức theo phút/ngày và trần số request
// chạy song song, để một khách không đốt hết quota Claude của cả máy.
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { accountEnv, currentAccountKey } from "./config.js";
import {
  chooseAccount, fallbackAccount, isLimitResult, isBlockedResult, isBlockedText, isLimitBlocked, LIMIT_RE,
} from "./accountSwitch.js";
import { markAccountExhausted, markAccountBlocked } from "./limits.js";

const CONSOLE_KEY = "publicapi";

// ─── Cấu hình (.env) ───────────────────────────────────────────────────────────────────────────
const num = (v, dflt) => {
  const n = Number.parseInt(String(v ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

export const LIMITS = {
  perMin: () => num(process.env.PUBLIC_API_RATE_PER_MIN, 10),
  perDay: () => num(process.env.PUBLIC_API_RATE_PER_DAY, 200),
  concurrent: () => num(process.env.PUBLIC_API_MAX_CONCURRENT, 2),
  maxPromptChars: () => num(process.env.PUBLIC_API_MAX_PROMPT, 8000),
  timeoutMs: () => num(process.env.PUBLIC_API_TIMEOUT_MS, 300000),
};

// Model bên thứ ba được chọn. Chỉ nhận alias, không nhận model id đầy đủ: người gọi không cần biết
// tên nội bộ, và whitelist chặn việc gọi sang model đắt hơn mức ta muốn mở.
export const MODELS = ["haiku", "sonnet", "opus"];
export const DEFAULT_MODEL = () => (MODELS.includes(process.env.PUBLIC_API_MODEL) ? process.env.PUBLIC_API_MODEL : "sonnet");
export const EFFORTS = ["low", "medium", "high"];

// PUBLIC_API_KEYS="key1:tên-khách-1,key2:tên-khách-2" (phần tên là nhãn để đọc log, có thể bỏ).
function apiKeys() {
  const raw = process.env.PUBLIC_API_KEYS || "";
  const out = new Map();
  for (const item of raw.split(",")) {
    const s = item.trim();
    if (!s) continue;
    const i = s.indexOf(":");
    const key = i < 0 ? s : s.slice(0, i).trim();
    const label = i < 0 ? "" : s.slice(i + 1).trim();
    if (key) out.set(key, label || key.slice(0, 6) + "…");
  }
  return out;
}

// So sánh key theo độ dài cố định để không lộ thông tin qua thời gian so sánh.
function sameKey(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// → { ok, client } | { error, status }
export function authApiKey(req) {
  const keys = apiKeys();
  if (!keys.size) {
    return { error: "API chưa được bật: đặt PUBLIC_API_KEYS trong ui-next/.env rồi khởi động lại app.", status: 503 };
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") || "");
  const given = (bearer ? bearer[1] : req.headers.get("x-api-key") || "").trim();
  if (!given) return { error: "Thiếu API key (header `Authorization: Bearer <key>` hoặc `x-api-key`).", status: 401 };
  for (const [key, label] of keys) if (sameKey(key, given)) return { ok: true, client: label };
  return { error: "API key không hợp lệ.", status: 403 };
}

// ─── Hạn mức (in-memory, theo tiến trình) ──────────────────────────────────────────────────────
// Chỉ có MỘT tiến trình Next phục vụ endpoint này (pm2 app ai-agent-ui-next) nên đếm trong RAM là
// đủ; app restart thì bộ đếm reset — chấp nhận được, đây là van an toàn quota chứ không phải billing.
const usage = new Map(); // client → { minute: {at, n}, day: {at, n}, active }

function bucket(client) {
  let u = usage.get(client);
  if (!u) {
    u = { minute: { at: 0, n: 0 }, day: { at: 0, n: 0 }, active: 0 };
    usage.set(client, u);
  }
  return u;
}

// Xin 1 suất chạy. → { ok, release } | { error, status, retryAfter }
export function takeSlot(client) {
  const u = bucket(client);
  const now = Date.now();
  if (now - u.minute.at >= 60_000) u.minute = { at: now, n: 0 };
  if (now - u.day.at >= 86_400_000) u.day = { at: now, n: 0 };

  if (u.active >= LIMITS.concurrent()) {
    return { error: `Đang có ${u.active} request chạy song song (trần ${LIMITS.concurrent()}) — thử lại sau.`, status: 429, retryAfter: 10 };
  }
  if (u.minute.n >= LIMITS.perMin()) {
    const wait = Math.ceil((60_000 - (now - u.minute.at)) / 1000);
    return { error: `Vượt hạn mức ${LIMITS.perMin()} request/phút.`, status: 429, retryAfter: Math.max(1, wait) };
  }
  if (u.day.n >= LIMITS.perDay()) {
    const wait = Math.ceil((86_400_000 - (now - u.day.at)) / 1000);
    return { error: `Vượt hạn mức ${LIMITS.perDay()} request/ngày.`, status: 429, retryAfter: Math.max(1, wait) };
  }

  u.minute.n++;
  u.day.n++;
  u.active++;
  let released = false;
  return {
    ok: true,
    remaining: { perMin: LIMITS.perMin() - u.minute.n, perDay: LIMITS.perDay() - u.day.n },
    release: () => {
      if (released) return;
      released = true;
      u.active = Math.max(0, u.active - 1);
    },
  };
}

// ─── Hộp kín để chạy claude ────────────────────────────────────────────────────────────────────
// cwd phải là thư mục RỖNG, nằm ngoài mọi repo: CLAUDE.md được nạp theo cwd, chạy trong repo là
// prompt của khách thừa hưởng toàn bộ context nội bộ (REZIL, quy tắc team) — vừa tốn token vừa rò
// thông tin nội bộ vào câu trả lời cho bên thứ ba.
function sandboxCwd() {
  const dir = process.env.PUBLIC_API_SANDBOX_DIR || path.join(os.tmpdir(), "ai-agent-public-api");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const SYSTEM_PROMPT = [
  "Bạn là trợ lý sinh nội dung phục vụ qua API.",
  "Trả về ĐÚNG nội dung được yêu cầu, không thêm lời dẫn ('Đây là bài viết…'), không hỏi lại,",
  "không nhắc rằng bạn là AI. Ngôn ngữ mặc định theo ngôn ngữ của yêu cầu.",
  "Bạn không có công cụ nào: không đọc/ghi file, không chạy lệnh, không truy cập mạng.",
  "Nếu yêu cầu cần dữ liệu bạn không có, hãy nói rõ phần đó thiếu thay vì bịa số liệu, tên riêng,",
  "trích dẫn hay đường link.",
].join(" ");

// Validate + chuẩn hoá body của người gọi. → { ok, input } | { error }
export function parseInput(body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return { error: "Thiếu `prompt`." };
  const cap = LIMITS.maxPromptChars();
  if (prompt.length > cap) return { error: `\`prompt\` dài ${prompt.length} ký tự, trần là ${cap}.` };

  const model = body.model == null ? DEFAULT_MODEL() : String(body.model);
  if (!MODELS.includes(model)) return { error: `\`model\` phải là một trong: ${MODELS.join(", ")}.` };

  const effort = body.effort == null ? "low" : String(body.effort);
  if (!EFFORTS.includes(effort)) return { error: `\`effort\` phải là một trong: ${EFFORTS.join(", ")}.` };

  // `system` của người gọi được CỘNG THÊM, không thay thế: các ràng buộc an toàn ở SYSTEM_PROMPT
  // (không tool, không bịa dữ liệu) phải giữ nguyên dù khách đặt persona gì.
  const system = typeof body.system === "string" ? body.system.trim().slice(0, 4000) : "";

  return { ok: true, input: { prompt, model, effort, system, stream: body.stream === true || body.stream === "1" } };
}

function buildArgv({ prompt, model, effort, system, stream }) {
  return [
    "-p", prompt,
    "--model", model,
    "--effort", effort,
    // Hộp kín: không tool nào (kể cả Read), không MCP, bỏ mọi settings user/project/local, mọi thứ
    // cần xin phép đều bị từ chối thẳng thay vì treo chờ người trả lời.
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--permission-prompts", "none",
    // Stateless: không ghi transcript cho request của bên thứ ba (không resume, không lẫn vào
    // panel "Phiên đã lưu" của console nội bộ).
    "--no-session-persistence",
    "--system-prompt", SYSTEM_PROMPT + (system ? "\n\nYêu cầu thêm từ người gọi:\n" + system : ""),
    ...(stream
      ? ["--output-format", "stream-json", "--include-partial-messages", "--verbose"]
      : ["--output-format", "json"]),
  ];
}

// Env của account sẽ chạy. Hết quota thì đổi sang account khác (không có phiên nào phải mang theo:
// endpoint này stateless, nên chỉ cần chọn account còn quota).
// Lượt chạy hỏng vì account (429 hết hạn mức / org tắt Claude Code) → trả câu mô tả để caller chạy
// lại bằng account khác, ĐỒNG THỜI đánh dấu account đó vào cache quota. Thiếu bước đánh dấu thì
// request nào cũng phải diễn lại màn "chạy hỏng rồi mới đổi", vì lần chọn account kế tiếp vẫn thấy
// account cũ bình thường.  → chuỗi lý do, hoặc null nếu lỗi không thuộc về account.
function noteAccountFailure(acct, { resultText = "", apiErrorStatus = null, stderr = "" } = {}) {
  const data = { isError: true, resultText, apiErrorStatus };
  if (isBlockedResult(data) || isBlockedText(stderr)) {
    markAccountBlocked(acct, `publicapi: ${String(resultText || stderr).slice(0, 120)}`);
    return "bị tổ chức chặn Claude Code";
  }
  if (isLimitResult(data) || LIMIT_RE.test(stderr)) {
    markAccountExhausted(acct, `publicapi: ${String(resultText || stderr).slice(0, 120)}`);
    return "hết hạn mức";
  }
  return null;
}

async function pickEnv() {
  const chosen = await chooseAccount(null, null, CONSOLE_KEY);
  const acct = chosen.acct;
  return { acct, env: acct === currentAccountKey() ? process.env : accountEnv(acct), notice: chosen.notice };
}

function spawnClaude(argv, env) {
  return spawn("claude", argv, { cwd: sandboxCwd(), env, stdio: ["ignore", "pipe", "pipe"] });
}

// Chạy 1 lượt, trả JSON gọn cho người gọi. Lượt chết vì lỗi THUỘC ACCOUNT (hết hạn mức / org chặn)
// được chạy lại 1 lần bằng account khác — bên thứ ba không nên nhận 500 chỉ vì account nội bộ cạn.
export async function generate(input) {
  const argv = buildArgv({ ...input, stream: false });
  const first = await pickEnv();
  let out = await runOnce(argv, first.env, first.acct);

  if (out.accountFailed) {
    const fb = await fallbackAccount(null, null, first.acct, out.accountFailed, CONSOLE_KEY);
    if (fb) out = await runOnce(argv, fb.env, fb.acct);
  }
  return out;
}

function runOnce(argv, env, acct) {
  return new Promise((resolve) => {
    const child = spawnClaude(argv, env);
    let stdout = "", stderr = "", done = false;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };

    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
      finish({ ok: false, status: 504, error: `Quá thời gian cho phép (${Math.round(LIMITS.timeoutMs() / 1000)}s).` });
    }, LIMITS.timeoutMs());

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (e) => finish({ ok: false, status: 500, error: "Không chạy được claude: " + e.message }));
    child.on("close", () => {
      let res = null;
      try { res = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "null"); } catch {}
      if (!res || res.type !== "result") {
        // Không có JSON kết quả nào: CLI chết trước khi chạy xong. Lỗi org-chặn-account đi qua
        // stderr mà không kèm mã 429 nào, nên chỉ nhận ra được bằng text — vẫn phải đổi account.
        finish({
          ok: false,
          status: 502,
          error: "Claude không trả về kết quả." + (stderr ? " " + stderr.trim().slice(0, 300) : ""),
          accountFailed: noteAccountFailure(acct, { stderr }),
        });
        return;
      }
      if (res.is_error) {
        finish({
          ok: false,
          status: 502,
          error: String(res.result || "Lượt chạy lỗi.").slice(0, 500),
          accountFailed: noteAccountFailure(acct, { resultText: res.result, apiErrorStatus: res.api_error_status, stderr }),
        });
        return;
      }
      finish({
        ok: true,
        text: String(res.result ?? ""),
        usage: {
          input_tokens: res.usage?.input_tokens ?? null,
          output_tokens: res.usage?.output_tokens ?? null,
          duration_ms: res.duration_ms ?? null,
        },
      });
    });
  });
}

// ─── Streaming (SSE) ───────────────────────────────────────────────────────────────────────────
// Hợp đồng SSE riêng, gọn và ổn định cho bên thứ ba: `delta` {text} → `done` {usage} hoặc
// `error` {error}. KHÔNG dùng lại tên event nội bộ của claudeSSE (tool/result/error_msg/suggest…):
// đó là chi tiết của console nội bộ, đổi lúc nào cũng được, không phải API công khai.
//
// Đổi account giữa lượt: lượt chết vì lỗi THUỘC ACCOUNT được chạy lại bằng account khác trên CÙNG
// một stream, khách không thấy gì ngoài việc đáp án tới chậm hơn. Điều kiện bắt buộc là CHƯA đẩy
// nội dung nào ra — đẩy rồi mà chạy lại thì đáp án của lượt mới nối vào đuôi lượt hỏng, và hợp đồng
// công khai không có event "xoá phần đã gửi" như `reset_text` của console nội bộ.
//
// Chỗ khó: CLI in câu báo hết hạn mức ("You've hit your usage limit · resets 3pm") NHƯ text của
// assistant, tức nó tới đúng đường delta. Gửi thẳng ra là mất luôn quyền chạy lại — lượt đáng chạy
// lại nhất lại thành lượt "đã có nội dung". Nên đoạn text đầu tiên được GIỮ trong bộ đệm probation
// cho tới khi biết lượt lành hay hỏng: hỏng thì bỏ đi cùng cả lượt, lành thì đẩy ra rồi stream bình
// thường. Cái giá là đáp án chậm thêm đúng một nhịp đệm.
const PROBATION_CHARS = 200;
// Tối đa 3 lần spawn cho 1 request (máy khai báo 3 account) — bằng MAX_SPAWNS của claudeSSE.
const MAX_SPAWNS = 3;

export async function generateStream(input, { onFinish } = {}) {
  const argv = buildArgv({ ...input, stream: true });
  const first = await pickEnv();
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event, data) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; }
      };

      let child = null;
      let acct = first.acct;
      let spawns = 0;
      let timedOut = false;
      // Đã đẩy nội dung THẬT ra cho khách chưa — tính cho CẢ request, không reset khi chạy lại.
      let flushed = false;

      // Trạng thái parse của MỘT lần spawn; chạy lại là làm mới hoàn toàn.
      let buf, streamed, gotResult, head, probation, pendingError, accountFailed, stderr;
      const resetRun = () => {
        buf = ""; streamed = false; gotResult = false;
        head = ""; probation = true;
        pendingError = null; accountFailed = null; stderr = "";
      };
      resetRun();

      const hb = setInterval(() => { try { controller.enqueue(encoder.encode(":hb\n\n")); } catch {} }, 15000);
      const timer = setTimeout(() => {
        timedOut = true;
        send("error", { error: `Quá thời gian cho phép (${Math.round(LIMITS.timeoutMs() / 1000)}s).` });
        try { child.kill("SIGTERM"); } catch {}
        setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
      }, LIMITS.timeoutMs());

      // end() chạy trên MỌI đường kết thúc (xong, lỗi, người gọi ngắt → kill → 'close'), nên đây
      // là chỗ duy nhất nhả suất hạn mức: nhả ở route thì request stream bị tính là còn chạy mãi.
      const end = () => {
        if (closed) return;
        clearInterval(hb);
        clearTimeout(timer);
        closed = true;
        try { controller.close(); } catch {}
        if (onFinish) { try { onFinish(); } catch {} }
      };

      const flushHead = () => {
        probation = false;
        if (!head) return;
        send("delta", { text: head });
        head = "";
        flushed = true;
      };

      const feed = (text) => {
        if (!text) return;
        if (probation) {
          head += text;
          if (head.length >= PROBATION_CHARS) flushHead();
          return;
        }
        send("delta", { text });
        flushed = true;
      };

      const onLine = (evt) => {
        if (evt.type === "stream_event") {
          const e = evt.event || {};
          if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
            streamed = true;
            feed(e.delta.text);
          }
        } else if (evt.type === "assistant" && !streamed) {
          // Không nhận được partial (model trả 1 phát) → vẫn phải đẩy text ra.
          for (const b of evt.message?.content || []) if (b.type === "text" && b.text) feed(b.text);
        } else if (evt.type === "rate_limit_event") {
          // Tín hiệu sớm nhất và đáng tin nhất: CLI phát ngay khi server chặn, kèm status.
          if (isLimitBlocked(evt.rate_limit_info || {})) {
            markAccountExhausted(acct, "publicapi: rate_limit_event rejected");
            accountFailed = "hết hạn mức";
          }
        } else if (evt.type === "result") {
          gotResult = true;
          if (evt.is_error) {
            // Chưa gửi `error` vội: onChildClose mới quyết định chạy lại hay báo lỗi.
            pendingError = String(evt.result || "Lượt chạy lỗi.").slice(0, 500);
            accountFailed =
              noteAccountFailure(acct, { resultText: evt.result, apiErrorStatus: evt.api_error_status, stderr }) ||
              accountFailed;
          } else {
            flushHead();
            send("done", {
              usage: {
                input_tokens: evt.usage?.input_tokens ?? null,
                output_tokens: evt.usage?.output_tokens ?? null,
                duration_ms: evt.duration_ms ?? null,
              },
            });
          }
        }
      };

      const onChildClose = async () => {
        if (closed || timedOut) { end(); return; }

        if (accountFailed && !flushed && spawns < MAX_SPAWNS) {
          const fb = await fallbackAccount(null, null, acct, accountFailed, CONSOLE_KEY);
          if (fb) {
            acct = fb.acct;
            resetRun(); // bỏ luôn bộ đệm probation: nó đang giữ câu báo lỗi của lượt hỏng
            if (launch(fb.env)) return;
            return;
          }
        }

        // Không chạy lại: bộ đệm probation của lượt hỏng là câu báo lỗi của CLI, không phải nội
        // dung khách đặt — bỏ đi thay vì gửi ra rồi mới gửi `error`.
        head = "";
        if (pendingError) send("error", { error: pendingError });
        else if (!gotResult) send("error", { error: "Lượt chạy kết thúc bất thường." + (stderr ? " " + stderr.trim().slice(0, 300) : "") });
        end();
      };

      // Spawn claude bằng env cho trước. true = spawn được, false = hỏng (đã báo lỗi + kết thúc).
      const launch = (env) => {
        spawns++;
        try {
          child = spawnClaude(argv, env);
        } catch (e) {
          send("error", { error: "Không chạy được claude: " + e.message });
          end();
          return false;
        }
        this._child = child;

        child.stdout.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line); } catch { continue; }
            onLine(evt);
          }
        });
        child.stderr.on("data", (d) => {
          const text = d.toString("utf8");
          stderr += text;
          // Lỗi org chặn account chỉ đi qua stderr, không kèm mã lỗi nào → chỉ bắt được bằng text.
          accountFailed = noteAccountFailure(acct, { stderr: text }) || accountFailed;
        });
        child.on("error", (e) => { send("error", { error: "Không chạy được claude: " + e.message }); end(); });
        child.on("close", () => { onChildClose(); });
        return true;
      };

      launch(first.env);
    },
    cancel() {
      // Người gọi ngắt kết nối → dừng luôn tiến trình: không có ai nhận kết quả, giữ lại chỉ đốt quota.
      if (this._child && this._child.exitCode === null) this._child.kill("SIGTERM");
    },
  });
}
