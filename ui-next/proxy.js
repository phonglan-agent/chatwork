// HTTP Basic Auth gate (Next "proxy" convention, formerly middleware.js). Set UI_BASIC_AUTH="user:pass" in ui-next/.env
// to require login (recommended when exposed via ngrok). Empty = no auth (loopback dev only).
// Browsers cache Basic credentials and resend them on same-origin EventSource/fetch, so SSE works.
import { NextResponse } from "next/server";

export const config = {
  // Protect everything except Next's static assets and the third-party API (own API-key auth).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/v1).*)"],
};

// API cho bên thứ ba: KHÔNG gác bằng Basic Auth của UI. Khách cầm API key riêng (thu hồi được từng
// cái, xem lib/publicApi.js), không được biết mật khẩu UI. Kiểm cả trong hàm chứ không chỉ dựa vào
// matcher ở trên: khi app chạy dưới basePath (/ai) thì đường dẫn tới middleware có thể còn tiền tố.
function isPublicApi(pathname) {
  return pathname === "/api/v1" || pathname.startsWith("/api/v1/") || pathname.includes("/api/v1/");
}

export function proxy(req) {
  if (isPublicApi(req.nextUrl.pathname)) return NextResponse.next();

  const expected = process.env.UI_BASIC_AUTH || "";
  if (!expected) return NextResponse.next();

  const m = /^Basic (.+)$/.exec(req.headers.get("authorization") || "");
  if (m) {
    let got = "";
    try { got = atob(m[1]); } catch {}
    if (got === expected) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ai-agent-ui", charset="UTF-8"' },
  });
}
