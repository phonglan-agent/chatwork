// POST/GET /api/v1/generate — API cho BÊN THỨ BA gọi Claude sinh nội dung.
// Xác thực bằng API key riêng (PUBLIC_API_KEYS), KHÔNG qua Basic Auth của UI: proxy.js bỏ /api/v1
// khỏi matcher để khách không phải biết mật khẩu UI. Mọi ràng buộc hộp kín + hạn mức nằm ở
// lib/publicApi.js. Xem README §API cho bên thứ ba.
import { authApiKey, takeSlot, parseInput, generate, generateStream, LIMITS, MODELS, EFFORTS, DEFAULT_MODEL } from "../../../../lib/publicApi.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Khách gọi từ trình duyệt (fetch/EventSource) cần CORS. Mặc định mở cho mọi origin vì cửa đã có
// API key gác; đặt PUBLIC_API_CORS_ORIGIN để bó lại đúng domain của khách.
function cors() {
  return {
    "Access-Control-Allow-Origin": process.env.PUBLIC_API_CORS_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-API-Key",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function fail(error, status, extra = {}) {
  const headers = { ...cors(), ...(extra.retryAfter ? { "Retry-After": String(extra.retryAfter) } : {}) };
  return Response.json({ ok: false, error }, { status, headers });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

export async function POST(req) {
  let body = {};
  try { body = await req.json(); } catch { return fail("Body phải là JSON.", 400); }
  return handle(req, body);
}

// Bản GET để gọi nhanh bằng curl/EventSource (EventSource chỉ gửi được GET). Tham số y như body.
export async function GET(req) {
  const q = new URL(req.url).searchParams;
  // GET rỗng = bản mô tả hợp đồng, nhưng vẫn phải có key: hạn mức và cấu hình của máy này không
  // phải thông tin công khai.
  if (!q.get("prompt")) {
    const auth = authApiKey(req);
    return auth.ok ? docs() : fail(auth.error, auth.status);
  }
  return handle(req, {
    prompt: q.get("prompt"),
    system: q.get("system") || undefined,
    model: q.get("model") || undefined,
    effort: q.get("effort") || undefined,
    stream: q.get("stream") === "1",
  });
}

// GET không kèm prompt → trả bản mô tả hợp đồng, để khách tự dò được cách gọi.
function docs() {
  return Response.json(
    {
      ok: true,
      endpoint: "/api/v1/generate",
      auth: "Authorization: Bearer <API_KEY>  (hoặc header X-API-Key)",
      methods: { POST: "body JSON", GET: "query params (?prompt=…)" },
      params: {
        prompt: `bắt buộc, tối đa ${LIMITS.maxPromptChars()} ký tự`,
        system: "tuỳ chọn, chỉ dẫn thêm cho model (tối đa 4000 ký tự)",
        model: `${MODELS.join(" | ")} — mặc định ${DEFAULT_MODEL()}`,
        effort: `${EFFORTS.join(" | ")} — mặc định low`,
        stream: "true = trả SSE (event: delta {text} → done {usage} | error {error})",
      },
      response: { ok: true, text: "…", usage: { input_tokens: 0, output_tokens: 0, duration_ms: 0 } },
      limits: { per_min: LIMITS.perMin(), per_day: LIMITS.perDay(), concurrent: LIMITS.concurrent(), timeout_ms: LIMITS.timeoutMs() },
      example: `curl -X POST <base>/api/v1/generate -H 'Authorization: Bearer <API_KEY>' -H 'Content-Type: application/json' -d '{"prompt":"Viết bài viết 300 từ về con mèo"}'`,
    },
    { headers: cors() }
  );
}

async function handle(req, body) {
  const auth = authApiKey(req);
  if (!auth.ok) return fail(auth.error, auth.status);

  const parsed = parseInput(body);
  if (!parsed.ok) return fail(parsed.error, 400);

  const slot = takeSlot(auth.client);
  if (!slot.ok) return fail(slot.error, slot.status, { retryAfter: slot.retryAfter });

  const rateHeaders = {
    "X-RateLimit-Remaining-Minute": String(slot.remaining.perMin),
    "X-RateLimit-Remaining-Day": String(slot.remaining.perDay),
  };

  if (parsed.input.stream) {
    try {
      // Suất hạn mức được nhả trong chính stream (onFinish) — kể cả khi khách ngắt kết nối giữa lượt.
      const stream = await generateStream(parsed.input, { onFinish: slot.release });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          ...cors(),
          ...rateHeaders,
        },
      });
    } catch (e) {
      slot.release();
      return fail("Lỗi khi mở stream: " + e.message, 500);
    }
  }

  try {
    const out = await generate(parsed.input);
    if (!out.ok) return fail(out.error, out.status || 502);
    return Response.json({ ok: true, text: out.text, usage: out.usage }, { headers: { ...cors(), ...rateHeaders } });
  } catch (e) {
    return fail("Lỗi khi chạy: " + e.message, 500);
  } finally {
    slot.release();
  }
}
