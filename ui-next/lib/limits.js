// Live rate-limit usage (current 5h session + weekly), same data as Claude Code's /usage panel.
// Calls GET https://api.anthropic.com/api/oauth/usage with the OAuth token from
// ~/.claude/.credentials.json. Endpoint + fields discovered from the claude CLI bundle
// (fetchUtilization). Node runtime only; never exposed to the client.
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { claudeHome, accountHome, accountEnv, listAccounts, currentAccountKey } from "./config.js";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

function readCreds(home = claudeHome()) {
  const p = path.join(home, ".credentials.json");
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const o = d.claudeAiOauth || {};
  return {
    token: o.accessToken || "",
    tier: o.rateLimitTier || "",
    expiresAt: o.expiresAt || 0,
    // Refresh token: CLI dùng nó để cấp accessToken mới. Hết hạn (hoặc bị xoá sau một lần refresh
    // hỏng) → account coi như đăng xuất, chạy claude sẽ chết với "OAuth session expired and could
    // not be refreshed" chứ không tự phục hồi được.
    refreshToken: o.refreshToken || "",
    refreshTokenExpiresAt: o.refreshTokenExpiresAt || 0,
  };
}

// Account có chắc chắn KHÔNG dùng được không (khác với "không đo được quota"): mất accessToken, hoặc
// accessToken hết hạn mà refresh token cũng mất/hết hạn. Trả về lý do (string) hoặc "" nếu vẫn dùng
// được. Chỉ dựa trên dữ liệu tại chỗ — không đoán theo lỗi mạng.
function unusableReason(c) {
  const now = Date.now();
  const refreshDead = !c.refreshToken || (c.refreshTokenExpiresAt && c.refreshTokenExpiresAt <= now);
  if (!c.token) return refreshDead ? "mất cả access token lẫn refresh token" : "mất access token";
  if (c.expiresAt && c.expiresAt <= now && refreshDead) return "token hết hạn và refresh token cũng hết hạn";
  return "";
}

// The stored accessToken expires every few hours; only the CLI refreshes it (nobody runs `claude`
// on this box for days while the UI serves /usage over ngrok), so the token goes stale and the API
// answers 401.
//
// `claude auth status` does NOT refresh it — checked with `unshare -rn` (no network at all): it
// still prints the full status, i.e. it only reads .credentials.json. The rewrite happens as a side
// effect of a REAL CLI turn, so force the cheapest one possible (haiku, 1 lượt, prompt 1 từ) and let
// the CLI keep owning the secret instead of doing the OAuth refresh dance — and rotating the refresh
// token — in here. Costs ~15s, only on the expired-token path.
const PING_ARGV = ["-p", "ok", "--model", "haiku", "--max-turns", "1", "--output-format", "text"];

// acct = KEY của account (acct1/acct2/...), không phải đường dẫn: env phải đi qua accountEnv() —
// account mặc định cần XOÁ CLAUDE_CONFIG_DIR chứ không set về ~/.claude (xem config.js).
function refreshCredsViaCli(acct = currentAccountKey()) {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    let child;
    try {
      child = spawn("claude", PING_ARGV, { env: accountEnv(acct), stdio: "ignore" });
    } catch (e) {
      console.warn("[limits] không spawn được claude để refresh token:", e.message);
      return fin();
    }
    const t = setTimeout(() => {
      console.warn("[limits] claude refresh ping quá 60s — kill");
      try {
        child.kill("SIGKILL");
      } catch {}
      fin();
    }, 60000);
    child.on("close", () => {
      clearTimeout(t);
      fin();
    });
    child.on("error", (e) => {
      clearTimeout(t);
      console.warn("[limits] claude refresh ping lỗi:", e.message);
      fin();
    });
  });
}

// Format a reset timestamp → "DD/MM HH:MM (sau Xh Ym)" in local time.
function fmtReset(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const when = `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    let ms = d.getTime() - now.getTime();
    if (ms < 0) return `${when} (đã reset)`;
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    let rel;
    if (h >= 48) rel = `sau ${Math.floor(h / 24)} ngày ${h % 24}h`;
    else if (h > 0) rel = `sau ${h}h${pad(m)}m`;
    else rel = `sau ${m} phút`;
    return `${when} (${rel})`;
  } catch {
    return String(iso);
  }
}

function fetchUsage(token) {
  return fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(15000),
  });
}

// Dịch mã HTTP của endpoint usage sang câu có nghĩa. Hai mã hay gặp và KHÁC hẳn nhau:
//   403 — account bị tổ chức tắt Claude Code (đã gặp với acct1 ngày 2026-08-24 và 2026-08-26), hoặc
//         token không đủ quyền. Không tự hết theo thời gian.
//   429 — API chặn TẦN SUẤT gọi endpoint này, không phải hết quota (quota cạn vẫn trả 200 với
//         utilization 100%). Header `retry-after` nói còn bao lâu.
function explainHttp(status, retryAfter) {
  if (status === 403) return "403 — account bị tổ chức chặn Claude Code, hoặc token không đủ quyền";
  if (status === 429) {
    const s = Number(retryAfter);
    return "429 — API chặn tần suất gọi" + (s > 0 ? `, thử lại sau ${Math.ceil(s / 60)} phút` : "");
  }
  return `HTTP ${status}`;
}

// accountUsage() trả lỗi dạng "HTTP 403" → đổi sang câu có nghĩa khi in ra cho người đọc.
const explainError = (e) => {
  const m = /^HTTP (\d+)$/.exec(String(e || ""));
  return m ? explainHttp(Number(m[1])) : String(e || "không rõ");
};

export async function buildLimitsReport() {
  const cur = currentAccountKey();
  const accts = listAccounts();
  if (!accts.length) return "🚦 Giới hạn: chưa đăng nhập Claude ở account nào (thiếu .credentials.json).";

  // allowRefresh cho MỌI account, không riêng account đang chạy: pm2 chỉ chạy `claude` dưới 1
  // account nên accessToken của các account kia luôn quá hạn sau vài giờ, và trước đây /usage in
  // "token hết hạn" cho chúng dù refresh token còn sống và quota còn nguyên. Các refresh chạy song
  // song (Promise.all) nên chỉ tốn ~15s một lần, không phải 15s × số account.
  const rows = await Promise.all(accts.map((k) => accountUsage(k, { allowRefresh: true })));

  // Bảng markdown: console render bằng react-markdown + remark-gfm. KHÔNG dùng dòng thụt lề — trong
  // markdown các dòng liền nhau bị gộp thành 1 đoạn nên 3 account dính vào nhau.
  const pct = (v) => (typeof v === "number" ? `${v}%` : "—");
  // Cột theo model chỉ hiện khi API thực sự trả về (gói hiện tại chỉ có five_hour + seven_day) —
  // để trống cả cột "—" thì bảng rộng thêm mà không nói gì.
  const showOpus = rows.some((r) => typeof r.detail?.seven_day_opus === "number");
  const showSonnet = rows.some((r) => typeof r.detail?.seven_day_sonnet === "number");
  const head = [
    "Account",
    "Phiên 5h",
    "Tuần · chung",
    ...(showOpus ? ["Tuần · Opus"] : []),
    ...(showSonnet ? ["Tuần · Sonnet"] : []),
    "Reset phiên 5h",
    "Reset tuần",
  ];
  const L = [];
  const tier = rows.find((r) => r.tier)?.tier;
  L.push(`🚦 **Giới hạn sử dụng** (live · Anthropic)${tier ? ` · gói \`${tier}\`` : ""} — số là **phần đã dùng**`);
  L.push("");
  L.push("| " + head.join(" | ") + " |");
  L.push("|" + head.map(() => "---").join("|") + "|");
  for (const r of rows) {
    const name = r.acct === cur ? `**${r.acct}** (đang chạy)` : r.acct;
    if (!r.ok) {
      const why = explainError(r.error);
      L.push(`| ${name} | ${why} | ` + Array(head.length - 2).fill("—").join(" | ") + " |");
      continue;
    }
    const d = r.detail || {};
    const cells = [
      pct(d.five_hour),
      pct(d.seven_day),
      ...(showOpus ? [pct(d.seven_day_opus)] : []),
      ...(showSonnet ? [pct(d.seven_day_sonnet)] : []),
      d.resets_five_hour ? fmtReset(d.resets_five_hour) : "—",
      d.resets_seven_day ? fmtReset(d.resets_seven_day) : "—",
    ];
    L.push(`| ${name} | ${cells.join(" | ")} |`);
  }

  const extra = rows.filter((r) => r.ok && r.detail?.extra != null);
  if (extra.length) {
    L.push(
      "",
      "Extra usage đang bật: " +
        extra.map((r) => `${r.acct}${typeof r.detail.extra === "number" ? ` (${r.detail.extra}%)` : ""}`).join(", ") +
        "."
    );
  }
  return L.join("\n");
}

// ─── Quota theo từng account (cho auto-switch khi hết quota) ────────────────────────────────────
// Chỉ 2 hạn mức được coi là "chặn cả account": phiên 5h và tuần chung. Hạn mức riêng theo model
// (seven_day_opus/sonnet) cạn KHÔNG chặn account — vẫn chạy được model còn lại.
const BINDING_ROWS = ["five_hour", "seven_day"];
const USAGE_CACHE_MS = 60000;
const usageCache = new Map(); // acct → { at, ok, headroom, tier, error }

// Account bị CHẶN ở mức tổ chức (admin tắt Claude subscription cho Claude Code): khác hết quota ở
// chỗ KHÔNG tự hết sau vài giờ, và API usage vẫn trả về quota bình thường nên không đo ra được. Vì
// vậy phải nhớ riêng, giữ suốt đời process (pm2 restart là hết) chứ không đi qua cache 60s.
const blockedAccounts = new Map(); // acct → lý do

// Một run vừa báo account bị tổ chức chặn → loại account đó khỏi mọi lựa chọn sau này.
export function markAccountBlocked(acct, reason = "") {
  if (blockedAccounts.has(acct)) return;
  console.warn(`[limits] đánh dấu ${acct} bị tổ chức chặn Claude Code${reason ? " — " + reason : ""}`);
  blockedAccounts.set(acct, "tổ chức đã tắt Claude subscription cho Claude Code");
}

// Phần trăm ĐÃ DÙNG của từng hạn mức + mốc reset, để /usage in bảng chi tiết theo account.
// headroom (dưới đây) chỉ là 1 con số gộp dùng cho việc tự đổi account, không đủ để hiển thị.
const util = (v) => (v && typeof v.utilization === "number" ? Math.round(v.utilization) : null);
function detailFrom(data) {
  const ex = data.extra_usage;
  return {
    five_hour: util(data.five_hour),
    seven_day: util(data.seven_day),
    seven_day_opus: util(data.seven_day_opus),
    seven_day_sonnet: util(data.seven_day_sonnet),
    resets_five_hour: data.five_hour?.resets_at || "",
    resets_seven_day: data.seven_day?.resets_at || "",
    extra: ex && ex.is_enabled ? (typeof ex.utilization === "number" ? Math.round(ex.utilization) : true) : null,
  };
}

function headroomFrom(data) {
  let worst = 0;
  for (const key of BINDING_ROWS) {
    const v = data[key];
    if (v && typeof v.utilization === "number") worst = Math.max(worst, v.utilization);
  }
  return Math.max(0, 100 - worst);
}

// Quota còn lại của 1 account, cache 60s. KHÔNG spawn claude để refresh token trong đường request
// (mất ~15s) trừ khi allowRefresh — token hết hạn thì coi như không biết (ok:false) và bỏ qua
// account đó, chứ không làm chậm chat.
export async function accountUsage(acct, { allowRefresh = false } = {}) {
  // Bị tổ chức chặn thì mọi run đều chết ngay, quota còn bao nhiêu cũng vô nghĩa → báo unusable để
  // caller không chọn (và đổi khỏi) account này. blocked=true để phân biệt với mất đăng nhập.
  const blocked = blockedAccounts.get(acct);
  if (blocked) return { acct, at: Date.now(), ok: false, unusable: true, blocked: true, headroom: 0, error: blocked };

  const hit = usageCache.get(acct);
  // Bản cache hỏng (token hết hạn, API lỗi) KHÔNG được dùng lại khi caller cho phép refresh — nếu
  // không, lần gọi có allowRefresh sẽ nhận luôn kết quả hỏng cũ và không bao giờ chạy refresh.
  const stale = hit && allowRefresh && !hit.ok;
  if (hit && !stale && Date.now() - hit.at < USAGE_CACHE_MS) return hit;

  const home = accountHome(acct);
  const put = (v) => {
    const rec = { acct, at: Date.now(), ...v };
    usageCache.set(acct, rec);
    return rec;
  };

  let creds;
  try {
    creds = readCreds(home);
  } catch (e) {
    return put({ ok: false, unusable: true, headroom: 0, error: "không đọc được credentials: " + e.message });
  }
  // unusable = chắc chắn hỏng đăng nhập (phải `claude auth login` lại), khác hẳn "không đo được
  // quota" — caller dùng cờ này để KHÔNG fail-open về account đang chết. Xem accountSwitch.js.
  let dead = unusableReason(creds);
  if (!creds.token) return put({ ok: false, unusable: true, headroom: 0, error: dead || "chưa đăng nhập" });
  if (creds.expiresAt && creds.expiresAt - Date.now() < 60000) {
    if (dead) return put({ ok: false, unusable: true, headroom: 0, error: dead });
    if (!allowRefresh) return put({ ok: false, headroom: 0, error: "token hết hạn (chưa refresh)" });
    await refreshCredsViaCli(acct);
    try { creds = readCreds(home); } catch { /* giữ creds cũ */ }
    dead = unusableReason(creds);
    if (dead) return put({ ok: false, unusable: true, headroom: 0, error: dead });
  }

  try {
    const res = await fetchUsage(creds.token);
    if (!res.ok) return put({ ok: false, headroom: 0, error: `HTTP ${res.status}` });
    const data = await res.json();
    return put({ ok: true, headroom: headroomFrom(data), tier: creds.tier, detail: detailFrom(data) });
  } catch (e) {
    return put({ ok: false, headroom: 0, error: e.message });
  }
}

// Một run vừa báo hết quota → ghi nhận ngay, khỏi phải chờ API xác nhận lượt sau.
// `reason` chỉ để log: dấu hiệu nào đã kích hoạt (rate_limit_event / result 429 / text lỗi). Nhận
// nhầm ở đây làm chat đổi account dù còn quota, mà log cũ không ghi gì nên không truy được nguồn.
export function markAccountExhausted(acct, reason = "") {
  console.warn(`[limits] đánh dấu ${acct} hết quota${reason ? " — " + reason : ""}`);
  usageCache.set(acct, { acct, at: Date.now(), ok: true, headroom: 0, error: "run báo hết quota" });
}

// Khảo sát các account ứng viên → { best, rows }. best là account còn dư nhiều nhất (null nếu không
// có); rows là kết quả của TỪNG ứng viên, kể cả account bị loại, để caller nói rõ lý do bỏ qua.
// allowRefresh=true thì account nào token quá hạn sẽ được refresh qua CLI (chậm ~15s/account) — chỉ
// bật khi account hiện tại đã cạn quota, lúc đó thà chờ còn hơn để cả lượt chat đứng.
export async function surveyAccounts({ exclude = [], minHeadroom = 3, allowRefresh = false } = {}) {
  const cands = listAccounts().filter((a) => !exclude.includes(a));
  const rows = await Promise.all(cands.map((a) => accountUsage(a, { allowRefresh })));
  const usable = rows.filter((r) => r.ok && r.headroom >= minHeadroom);
  usable.sort((a, b) => b.headroom - a.headroom);
  return { best: usable[0] || null, rows };
}

