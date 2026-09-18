// SSE chat endpoint (EventSource → GET). Project-aware (rezil | free), read-only or edit.
// Handles the server-side /usage slash-command without spawning claude.
import { buildChatArgv, claudeSSE, cleanSessionId, resolveProject, normalizeProject } from "../../../lib/claude.js";
import { maybeSlashResponse } from "../../../lib/slashCommands.js";
import { running } from "../../../lib/jobs.js";
import { tagSession } from "../../../lib/sessions.js";
import { notifyTelegram } from "../../../lib/telegram.js";
import { accountEnv, currentAccountKey } from "../../../lib/config.js";
import { markAccountExhausted, markAccountBlocked } from "../../../lib/limits.js";
import { chooseAccount, fallbackAccount, LIMIT_RE, isLimitBlocked, isLimitResult, isBlockedResult, isBlockedText } from "../../../lib/accountSwitch.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const message = (searchParams.get("msg") || "").trim();
  const session = cleanSessionId(searchParams.get("session"));
  const canEdit = searchParams.get("edit") === "1";
  const project = normalizeProject(searchParams.get("project"));
  // Client-generated id for this turn. Lets the run survive a dropped connection (tab hidden) yet
  // still be cancellable (Dừng) + queryable (/api/chat/active) via the shared job-lock.
  const runId = (searchParams.get("runId") || "").trim();

  if (!message) {
    return Response.json({ error: "empty message" }, { status: 400 });
  }

  const slash = await maybeSlashResponse(message, { session });
  if (slash) return slash;

  const proj = resolveProject(project);
  const argv = buildChatArgv(project, message, session, canEdit, proj.addDirs);

  // Hết quota → chạy lượt này bằng account khác, vẫn trên cùng phiên: thư mục phiên đã dùng chung
  // qua symlink (scripts/share-projects.sh), project nào chưa symlink thì transcript được copy sang.
  const chosen = await chooseAccount(project, session, "chat");
  let runAcct = chosen.acct;
  const env = runAcct === currentAccountKey() ? undefined : accountEnv(runAcct);

  // Lỗi thuộc về ACCOUNT của lượt đang chạy (org tắt Claude Code / hết hạn mức) → chạy lại NGAY
  // trong lượt này bằng account khác (claudeSSE({ retry })). Không có nó thì lượt đầu tiên gặp lỗi
  // luôn hỏng: dấu hiệu chỉ lộ ra khi run đã chết, mà chooseAccount thì chạy trước đó.
  let acctFailed = null;
  // Số ký tự nội dung THẬT đã trả ra. Không đếm đoạn text chính là thông báo lỗi account: CLI in
  // "Your organization has disabled…" như text của assistant (kèm api_error_status 403), nên nếu
  // đếm cả nó thì guard "đã có nội dung" chặn luôn việc chạy lại — đúng lượt cần chạy lại nhất.
  let contentLen = 0;

  // Accumulate the final answer/status for the Telegram completion ping fired on `end` — cheap
  // no-op via notifyTelegram() when TELEGRAM_BOT_TOKEN/TELEGRAM_NOTIFY_CHAT_IDS aren't set.
  let answer = "";
  let gotResult = false;
  let runError = false;
  const NOTIFY_PREVIEW = 500;

  const stream = claudeSSE({
    cwd: proj.cwd,
    argv,
    env,
    notice: chosen.notice,
    onSession: true,
    // Keep the run alive if the client tab is hidden/minimized (socket drops); it finishes and is
    // saved to the session .jsonl so a reconnecting client can reload the answer. See lib/claude.js.
    killOnDisconnect: false,
    // Register in the shared job-lock under runId so the Dừng button (/api/cancel?repo=runId) and
    // the /api/chat/active status check can find this run even after a disconnect.
    onSpawn: runId ? (child) => running.set(runId, { child, label: "chat" }) : undefined,
    onClose: runId ? () => { running.delete(runId); } : undefined,
    // Chạy lại trong cùng lượt khi account vừa dùng không dùng được nữa. Điều kiện: đã có bằng
    // chứng lỗi-account VÀ lượt chưa trả ra nội dung nào (có nội dung rồi thì chạy lại sẽ nhân đôi).
    retry: async () => {
      if (!acctFailed || contentLen > 0) return null;
      const fb = await fallbackAccount(project, session, runAcct, acctFailed, "chat");
      if (!fb) return null;
      runAcct = fb.acct;
      acctFailed = null;
      runError = false;
      gotResult = false;
      answer = "";      // phần đã trả ra chỉ là dòng lỗi — đừng để nó lẫn vào ping Telegram
      return { env: fb.env, notice: fb.notice };
    },
    onEvent: (event, data) => {
      // Gắn nhãn console cho phiên → panel "Phiên đã lưu" của màn này không lẫn phiên màn khác
      // (nhiều console ghi .jsonl chung một thư mục — xem lib/sessions.js).
      if (event === "session") tagSession(data, "chat");
      if (event === "delta") {
        answer += data;
        if (!isBlockedText(data) && !LIMIT_RE.test(data)) contentLen += data.length;
      }
      // CLI báo bị chặn hạn mức ngay khi request bị từ chối (trước cả event result) → đánh dấu sớm.
      else if (event === "rate_limit") {
        if (isLimitBlocked(data)) markAccountExhausted(runAcct, `rate_limit_event status=${data.status} type=${data.rateLimitType}`);
      }
      else if (event === "result") {
        gotResult = true;
        runError = !!data.isError;
        // Org tắt Claude subscription cho Claude Code → account chết hẳn; hoặc hết hạn mức → cạn tạm
        // thời. Cả hai đánh dấu ngay để lượt sau tự đổi account. Check "bị chặn" trước vì cụ thể hơn.
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
      else if (event === "end") {
        const status = runError ? "⚠️ Lỗi" : gotResult ? "✅ Xong" : "⏹ Đã dừng";
        const trimmed = answer.trim();
        const preview = trimmed.length > NOTIFY_PREVIEW ? trimmed.slice(0, NOTIFY_PREVIEW) + "…" : trimmed;
        notifyTelegram(
          `${status} · chat/${project}\n👤 ${message}\n\n${preview || "(không có nội dung)"}`
        ).catch(() => {});
      }
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
