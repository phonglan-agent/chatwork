// SSE translate endpoint (EventSource → GET): đối chiếu Basic Design bản VN với bản JP trên Google
// Sheet theo spec ui-next/app/translate/TRANSLATE_SPEC.md (xem lib/translate.js — spec đọc lúc chạy).
//
// Mặc định CHỈ ĐỌC sheet. Chỉ khi người dùng yêu cầu rõ thì agent mới ghi tab kết quả riêng
// (`Translate-Check`); tab VN/JP gốc và file repo không bị sửa (Write/Edit bị chặn).
//
// Multi-turn via --resume: lượt trước đối chiếu tab này, lượt sau tab kế tiếp hoặc ghi kết quả.
//
// Chạy ngầm như /api/kloc và /api/evidence: killOnDisconnect:false + đăng ký runId vào job-lock, để
// ẩn tab / rớt ngrok giữa lúc đang đối chiếu không giết tiến trình.
//
// cwd = repo ai-agent (ROOT) vì spec nằm ở đây; add-dir các repo rezil để agent tra thêm khi cần. Vì
// cwd = ROOT nên mọi lời gọi tra phiên phải kèm consoleKey "translate" (xem ROOT_CWD_CONSOLES trong
// lib/sessions.js).
import fs from "fs";
import { buildTranslateArgv } from "../../../lib/translate.js";
import { claudeSSE, cleanSessionId } from "../../../lib/claude.js";
import { maybeSlashResponse } from "../../../lib/slashCommands.js";
import { tagSession } from "../../../lib/sessions.js";
import { resolveProject, accountEnv, currentAccountKey, ROOT } from "../../../lib/config.js";
import { markAccountExhausted, markAccountBlocked } from "../../../lib/limits.js";
import { running } from "../../../lib/jobs.js";
import { chooseAccount, fallbackAccount, LIMIT_RE, isLimitBlocked, isLimitResult, isBlockedResult, isBlockedText } from "../../../lib/accountSwitch.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSLATE_PROJECT = "rezil";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// YYYY-MM-DD HH:MM giờ địa phương — inject để agent không tự sinh "hôm nay" (cột Ngày kiểm tra).
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const message = (searchParams.get("msg") || "").trim();
  const session = cleanSessionId(searchParams.get("session"));
  // Client sinh runId cho mỗi lượt (AgentConsole) — khoá của job-lock, xem chú thích đầu file.
  const runId = (searchParams.get("runId") || "").trim();
  if (!message) return Response.json({ error: "empty message" }, { status: 400 });

  const slash = await maybeSlashResponse(message, { session });
  if (slash) return slash;

  const proj = resolveProject(TRANSLATE_PROJECT);
  if (!fs.existsSync(ROOT)) {
    return Response.json({ error: `Root path not found: ${ROOT}` }, { status: 400 });
  }

  const argv = buildTranslateArgv(message, session, nowStamp(), proj.addDirs);

  // Hết quota → chạy lượt này bằng account khác, vẫn trên cùng phiên (giống /api/kloc). An toàn vì
  // cả 3 account đều có MCP gsheets-rezil và đọc được spec. Chỉ đổi được Ở ĐẦU LƯỢT.
  const chosen = await chooseAccount(TRANSLATE_PROJECT, session, "translate");
  let runAcct = chosen.acct;
  const env = runAcct === currentAccountKey() ? undefined : accountEnv(runAcct);

  // Lỗi thuộc về ACCOUNT (org tắt Claude Code / hết hạn mức) → chạy lại ngay trong lượt này bằng
  // account khác, xem claudeSSE({ retry }) và app/api/chat/route.js.
  let acctFailed = null;
  // Chỉ đếm nội dung THẬT: CLI in lỗi account như text của assistant (xem app/api/chat/route.js).
  let contentLen = 0;

  const stream = claudeSSE({
    cwd: ROOT,
    argv,
    env,
    notice: chosen.notice,
    onSession: true,
    killOnDisconnect: false,
    onSpawn: runId ? (child) => running.set(runId, { child, label: "translate" }) : undefined,
    onClose: runId ? () => { running.delete(runId); } : undefined,
    retry: async () => {
      if (!acctFailed || contentLen > 0) return null;
      const fb = await fallbackAccount(TRANSLATE_PROJECT, session, runAcct, acctFailed, "translate");
      if (!fb) return null;
      runAcct = fb.acct;
      acctFailed = null;
      return { env: fb.env, notice: fb.notice };
    },
    onEvent: (event, data) => {
      // Gắn nhãn console cho phiên → panel "Phiên đã lưu" của màn này không lẫn phiên màn khác.
      if (event === "session") tagSession(data, "translate");
      if (event === "delta" && !isBlockedText(data) && !LIMIT_RE.test(data)) contentLen += data.length;
      if (event === "rate_limit") {
        if (isLimitBlocked(data)) markAccountExhausted(runAcct, `rate_limit_event status=${data.status} type=${data.rateLimitType}`);
      } else if (event === "result") {
        if (isBlockedResult(data)) {
          markAccountBlocked(runAcct, `result text=${String(data.resultText || "").slice(0, 120)}`);
          acctFailed = "bị tổ chức chặn Claude Code";
        } else if (isLimitResult(data)) {
          markAccountExhausted(runAcct, `result api_error_status=${data.apiErrorStatus} text=${String(data.resultText || "").slice(0, 120)}`);
          acctFailed = "hết hạn mức";
        }
      } else if (event === "error_msg" && typeof data === "string" && data !== chosen.notice) {
        if (isBlockedText(data)) {
          markAccountBlocked(runAcct, `error_msg khớp BLOCKED_RE: ${data.slice(0, 120)}`);
          acctFailed = "bị tổ chức chặn Claude Code";
        } else if (LIMIT_RE.test(data)) {
          markAccountExhausted(runAcct, `error_msg khớp LIMIT_RE: ${data.slice(0, 120)}`);
          acctFailed = "hết hạn mức";
        }
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
