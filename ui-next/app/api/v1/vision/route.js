// POST /api/v1/vision — API cho BÊN THỨ BA gửi ẢNH + prompt, Claude đọc nội dung ảnh rồi làm theo
// yêu cầu (OCR, tóm tắt ảnh chụp màn hình, đọc bảng/biểu đồ…). Cùng cơ chế xác thực/hạn mức với
// /api/v1/generate (PUBLIC_API_KEYS, LIMITS) — xem lib/publicApi.js. Ảnh đi thẳng vào nội dung tin
// nhắn qua stdin, KHÔNG qua tool Read (Read đọc được mọi file trên máy, không phù hợp hộp kín).
import {
  authApiKey, takeSlot, parseVisionInput, generateVision, generateVisionStream, LIMITS, MODELS, EFFORTS, DEFAULT_MODEL,
} from "../../../../lib/publicApi.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// GET không nhận ảnh được (query string không hợp để gửi binary) → luôn trả bản mô tả hợp đồng,
// vẫn cần key vì hạn mức/cấu hình máy không phải thông tin công khai.
export async function GET(req) {
  const auth = authApiKey(req);
  if (!auth.ok) return fail(auth.error, auth.status);
  return Response.json(
    {
      ok: true,
      endpoint: "/api/v1/vision",
      auth: "Authorization: Bearer <API_KEY>  (hoặc header X-API-Key)",
      method: "POST multipart/form-data",
      fields: {
        image: `bắt buộc, tệp ảnh PNG/JPEG/GIF/WEBP, tối đa ${LIMITS.maxImageMB()}MB`,
        prompt: `bắt buộc, tối đa ${LIMITS.maxPromptChars()} ký tự — yêu cầu áp dụng lên nội dung đọc được từ ảnh`,
        system: "tuỳ chọn, chỉ dẫn thêm cho model (tối đa 4000 ký tự)",
        model: `${MODELS.join(" | ")} — mặc định ${DEFAULT_MODEL()}`,
        effort: `${EFFORTS.join(" | ")} — mặc định low`,
        stream: "'1' hoặc 'true' = trả SSE (event: delta {text} → done {usage} | error {error})",
      },
      response: { ok: true, text: "…", usage: { input_tokens: 0, output_tokens: 0, duration_ms: 0 } },
      limits: { per_min: LIMITS.perMin(), per_day: LIMITS.perDay(), concurrent: LIMITS.concurrent(), timeout_ms: LIMITS.timeoutMs() },
      example: `curl -X POST <base>/api/v1/vision -H 'Authorization: Bearer <API_KEY>' -F 'image=@screenshot.png' -F 'prompt=Tóm tắt nội dung trong ảnh'`,
    },
    { headers: cors() }
  );
}

export async function POST(req) {
  let form;
  try { form = await req.formData(); } catch { return fail("Yêu cầu phải là multipart/form-data.", 400); }

  const auth = authApiKey(req);
  if (!auth.ok) return fail(auth.error, auth.status);

  const parsed = await parseVisionInput(form);
  if (!parsed.ok) return fail(parsed.error, 400);

  const slot = takeSlot(auth.client);
  if (!slot.ok) return fail(slot.error, slot.status, { retryAfter: slot.retryAfter });

  const rateHeaders = {
    "X-RateLimit-Remaining-Minute": String(slot.remaining.perMin),
    "X-RateLimit-Remaining-Day": String(slot.remaining.perDay),
  };

  if (parsed.input.stream) {
    try {
      const stream = await generateVisionStream(parsed.input, { onFinish: slot.release });
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
    const out = await generateVision(parsed.input);
    if (!out.ok) return fail(out.error, out.status || 502);
    return Response.json({ ok: true, text: out.text, usage: out.usage }, { headers: { ...cors(), ...rateHeaders } });
  } catch (e) {
    return fail("Lỗi khi chạy: " + e.message, 500);
  } finally {
    slot.release();
  }
}
