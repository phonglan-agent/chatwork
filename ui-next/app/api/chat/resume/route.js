// GET /api/chat/resume?runId=<id>&from=<id cuối đã nhận> — NỐI LẠI stream SSE của một lượt đang chạy.
// Phát lại các event có id > from từ bộ đệm lib/runStreams.js rồi nối tiếp event mới cho tới `end`.
// Dùng khi kết nối trình duyệt ↔ ngrok đứt giữa lượt (run vẫn chạy ở server vì killOnDisconnect:false).
// Không còn bộ đệm (app vừa restart / quá hạn giữ) hoặc bộ đệm đã bỏ bớt event cần phát lại → trả
// event `gap`; client hỏi /api/chat/active trước nên hiếm khi gặp, gặp thì quay về cách cũ (poll +
// đọc .jsonl). Xem AgentConsole.resumeStream().
import { subscribeRunStream } from "../../../../lib/runStreams.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const runId = (searchParams.get("runId") || "").trim();
  const from = Math.max(0, parseInt(searchParams.get("from") || "0", 10) || 0);
  if (!runId) return Response.json({ error: "missing runId" }, { status: 400 });

  const encoder = new TextEncoder();
  let sub = null;
  let hb = null;
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const stop = () => {
        if (closed) return;
        closed = true;
        if (hb) clearInterval(hb);
        if (sub) sub.unsubscribe();
        try { controller.close(); } catch {}
      };
      const write = (s) => { if (closed) return; try { controller.enqueue(encoder.encode(s)); } catch { stop(); } };
      write(":ok\n\n");
      // `sub` chưa gán khi subscribeRunStream phát lại đồng bộ — stop() lúc đó chỉ đóng stream, phần
      // unsubscribe chạy ở dưới khi đã có sub.
      sub = subscribeRunStream(runId, from, (f) => {
        if (!f) { stop(); return; }
        write(`id: ${f.id}\nevent: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`);
      });
      if (!sub) {
        write(`event: gap\ndata: {}\n\n`);
        stop();
        return;
      }
      if (closed) { sub.unsubscribe(); return; }
      if (sub.gap) {
        // Một phần event cần phát lại đã bị bỏ khỏi bộ đệm → không ghép đúng được, để client tự lấy .jsonl.
        write(`event: gap\ndata: {}\n\n`);
        stop();
        return;
      }
      hb = setInterval(() => write(":hb\n\n"), 15000);
    },
    cancel() {
      closed = true;
      if (hb) clearInterval(hb);
      if (sub) sub.unsubscribe();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}
