// SSE evidence endpoint (EventSource → GET): chụp / gán evidence cho test case trên Google Sheet
// SQA theo spec ui-next/app/evidence/SCREEN_EVIDENCE.md (xem lib/evidence.js — spec đọc lúc chạy).
//
// Console CÓ GHI: upload ảnh lên Drive bằng rclone + ghi cột M/N của sheet. Không sửa code repo,
// không git/gh, DB 207 chỉ SELECT.
//
// Có switch account như /api/chat và /api/release: chọn account còn quota ở đầu lượt (chooseAccount),
// và nếu run chết vì lỗi thuộc về account (org tắt Claude Code / hết hạn mức) thì chạy lại NGAY
// trong lượt bằng account khác (claudeSSE({ retry }) + fallbackAccount).
//
// Multi-turn via --resume: chụp evidence đi theo từng batch, người dùng xem kết quả batch rồi mới
// cho chạy batch tiếp. Không timeout — người dùng tự dừng bằng nút ⏹.
//
// CHẠY NGẦM (2026-08-27): trước đây route để mặc định `killOnDisconnect: true`, nên chỉ cần ẩn tab
// trên điện thoại hoặc ngrok chớp một nhịp là run bị SIGTERM giữa batch — mất cả phần đang chụp dở.
// Giờ theo đúng cách /api/chat: run sống tiếp khi client rớt, đăng ký vào job-lock theo `runId` để
// nút Dừng (/api/cancel?repo=<runId>) và /api/chat/active vẫn thấy nó, client quay lại thì
// AgentConsole poll rồi nạp câu trả lời từ .jsonl (config.reconnect trong Evidence.jsx).
//
// cwd = repo ai-agent (ROOT) vì toàn bộ tool nằm ở đây: scripts/debug.mjs + spec. add-dir thêm 4
// repo rezil để agent tra selector/logic trong source app mobile khi cần.
import fs from "fs";
import { buildEvidenceArgv, planSession } from "../../../lib/evidence.js";
import { claudeSSE, cleanSessionId } from "../../../lib/claude.js";
import { maybeSlashResponse } from "../../../lib/slashCommands.js";
import { tagSession } from "../../../lib/sessions.js";
import { resolveProject, accountEnv, currentAccountKey, ROOT } from "../../../lib/config.js";
import { markAccountExhausted, markAccountBlocked } from "../../../lib/limits.js";
import { running } from "../../../lib/jobs.js";
import { chooseAccount, fallbackAccount, LIMIT_RE, isLimitBlocked, isLimitResult, isBlockedResult, isBlockedText } from "../../../lib/accountSwitch.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Console evidence chạy trên project "rezil" (add-dir 4 repo rezil) để chooseAccount tra đúng quota
// theo project. NHƯNG cwd của run là ROOT, không phải repo rezil, nên phiên .jsonl nằm ở thư mục của
// ROOT — vì vậy mọi lời gọi tra phiên phải kèm consoleKey "evidence" (xem ROOT_CWD_CONSOLES trong
// lib/sessions.js). Thiếu nó thì ensureSessionInAccount nhìn nhầm thư mục "rezil", luôn báo missing
// và đổi account xong là mất context.
const EVIDENCE_PROJECT = "rezil";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

// YYYY-MM-DD HH:MM giờ địa phương — inject để agent không tự sinh "hôm nay" (ngày ghi vào sheet).
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

  const proj = resolveProject(EVIDENCE_PROJECT);
  if (!fs.existsSync(ROOT)) {
    return Response.json({ error: `Root path not found: ${ROOT}` }, { status: 400 });
  }

  // Phiên dài = mỗi lượt trả tiền cho toàn bộ context đã tích (phiên 2026-08-26: 49k → 152k
  // token/lượt). Quá ngưỡng thì mở phiên mới và chèn lại dòng <<<STATE>>> của lượt trước làm bối
  // cảnh — batch tự đọc lại sheet + Drive nên không mất gì ngoài phần tường thuật. Xem planSession.
  const plan = planSession(session);
  const argv = buildEvidenceArgv(plan.carry + message, plan.session, nowStamp(), proj.addDirs);

  // Hết quota → chạy lượt này bằng account khác, vẫn trên cùng phiên (giống /api/release). An toàn
  // vì cả 3 account đều có cùng bộ MCP server (gsheets-rezil, mysql_207) và cùng đọc được spec.
  // Chỉ đổi được Ở ĐẦU LƯỢT: một batch đang chụp giữa đường mà cạn quota thì vẫn hỏng, lượt sau mới
  // nhảy — khi đó chạy lại batch, các TC đã ghi cột M sẽ bị loại ở bước đối chiếu nên không trùng.
  const chosen = await chooseAccount(EVIDENCE_PROJECT, plan.session, "evidence");
  let runAcct = chosen.acct;
  const env = runAcct === currentAccountKey() ? undefined : accountEnv(runAcct);

  // Lỗi thuộc về ACCOUNT (org tắt Claude Code / hết hạn mức) → chạy lại ngay trong lượt này bằng
  // account khác, xem claudeSSE({ retry }) và app/api/chat/route.js.
  let acctFailed = null;
  // Chỉ đếm nội dung THẬT: CLI in lỗi account như text của assistant, đếm cả nó thì không bao giờ
  // chạy lại được (xem app/api/chat/route.js).
  let contentLen = 0;

  const stream = claudeSSE({
    cwd: ROOT,
    argv,
    env,
    notice: [plan.notice, chosen.notice].filter(Boolean).join(" · "),
    onSession: true,
    killOnDisconnect: false,
    // Đệm event theo runId để client đứt kết nối nối lại được qua /api/chat/resume (lib/runStreams.js).
    replayKey: runId || undefined,
    onSpawn: runId ? (child) => running.set(runId, { child, label: "evidence" }) : undefined,
    onClose: runId ? () => { running.delete(runId); } : undefined,
    // Chạy lại trong cùng lượt khi account vừa dùng không dùng được nữa (xem app/api/chat/route.js).
    retry: async () => {
      if (!acctFailed || contentLen > 0) return null;
      const fb = await fallbackAccount(EVIDENCE_PROJECT, plan.session, runAcct, acctFailed, "evidence");
      if (!fb) return null;
      runAcct = fb.acct;
      acctFailed = null;
      return { env: fb.env, notice: fb.notice };
    },
    onEvent: (event, data) => {
      // Gắn nhãn console cho phiên → panel "Phiên đã lưu" của màn này không lẫn phiên màn khác
      // (nhiều console ghi .jsonl chung một thư mục — xem lib/sessions.js).
      if (event === "session") tagSession(data, "evidence");
      if (event === "delta" && !isBlockedText(data) && !LIMIT_RE.test(data)) contentLen += data.length;
      // CLI báo bị chặn hạn mức ngay khi request bị từ chối (trước cả event result) → đánh dấu sớm.
      if (event === "rate_limit") {
        if (isLimitBlocked(data)) markAccountExhausted(runAcct, `rate_limit_event status=${data.status} type=${data.rateLimitType}`);
      } else if (event === "result") {
        // Check "bị org chặn" trước "hết hạn mức" vì cụ thể hơn; cả hai đều để lượt sau đổi account.
        if (isBlockedResult(data)) {
          markAccountBlocked(runAcct, `result text=${String(data.resultText || "").slice(0, 120)}`);
          acctFailed = "bị tổ chức chặn Claude Code";
        } else if (isLimitResult(data)) {
          markAccountExhausted(runAcct, `result api_error_status=${data.apiErrorStatus} text=${String(data.resultText || "").slice(0, 120)}`);
          acctFailed = "hết hạn mức";
        }
      } else if (
        event === "error_msg" &&
        typeof data === "string" &&
        data !== chosen.notice // đừng soi dòng notice do CHÍNH ta vừa phát ra ở đầu lượt
      ) {
        // Lỗi org chặn account đến qua stderr, không có mã 429 nào kèm → chỉ bắt được bằng text.
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
