// scripts/debug.mjs — debug một trang web đang chạy qua CDP: thu console log, network, chạy JS,
// đi qua flow (click/type/wait) và chụp màn. In BÁO CÁO gọn ra stdout để paste vào chat.
//
// Không cần npm dep: điều khiển google-chrome của hệ thống (CDP qua WebSocket có sẵn trong Node ≥ 21).
// Ảnh lưu vào ui-next/.snapshots/ và in ra đường dẫn /api/snapshot/... như snapshot.mjs.
//
// Usage:
//   node <ui-next>/scripts/debug.mjs <url|/path> [options]
//
// <url> có thể là đường dẫn tương đối bắt đầu bằng "/" (vd "/chat") — script tự ghép
// host mặc định (--host, mặc định lấy PORT trong ui-next/.env) + NEXT_PUBLIC_BASE_PATH.
//
// Options:
//   --label <ten>          nhãn cho ảnh + file báo cáo JSON            (default: debug)
//   --wait <ms>            chờ sau khi load xong, trước khi chạy step  (default: 4000)
//   --settle <ms>          chờ cuối cùng trước khi tổng kết            (default: 1500)
//   --width/--height <px>  kích thước viewport                         (default: 1280x800)
//   --geo "<lat>,<lon>"    cấp quyền vị trí + ghi đè toạ độ GPS (màn cần GPS mới cho thao tác, vd
//                          submit báo cáo của rezil-esms-mobile). Không truyền → không cấp quyền
//   --headed               mở cửa sổ Chrome thật (mặc định headless)
//   --attach <port>        KHÔNG tự mở Chrome, attach vào Chrome đang chạy với
//                          --remote-debugging-port=<port> (dùng profile/session đang login sẵn)
//   --keep <ten>           GIỮ Chrome sống sau khi script xong; lần chạy sau cùng --keep <ten> sẽ
//                          ATTACH vào đúng Chrome đó. Bỏ được ~12-15s cold start mỗi lần chạy và
//                          giữ nguyên trạng thái trang (không phải dựng lại flow) — dùng khi chụp
//                          nhiều bước/nhiều TC trên cùng một màn. Chrome nền dùng đúng --profile và
//                          --chrome-flag của LẦN MỞ ĐẦU: lần đầu phải truyền đủ cờ
//   --renav                đang attach bằng --keep vẫn load lại <url> từ đầu (mặc định: giữ nguyên
//                          trang đang mở nếu cùng origin)
//   --keep-stop <ten>      đóng Chrome keep-alive tên <ten> rồi thoát (Browser.close → lưu session)
//   --env <file>           nạp file key=value; step/eval dùng được {{KEY}} (để credential
//                          KHÔNG lộ trên command line)
//   --login <preset>       tự đăng nhập trước khi chạy step (preset: xem LOGIN_PRESETS). Đang có
//                          session rồi thì tự bỏ qua; login xong quay lại đúng <url> đã truyền
//   --profile <ten|path>   dùng profile Chrome BỀN (mặc định Chrome tự tạo profile tạm, mỗi lần chạy
//                          là session trắng). Tên ngắn → ui-next/.chrome-profiles/<ten>; tên `ci` =
//                          profile của scripts/capture-ci-evidence.sh (đã login GitHub). Nhờ đó
//                          login 1 lần, các lần sau còn cookie nên bỏ qua bước login
//   --profile-login        mở CỬA SỔ Chrome thật trên profile để tự đăng nhập bằng tay (trang không có
//                          preset --login: GitHub, Jira…), đăng nhập xong ĐÓNG cửa sổ là script chạy tiếp
//   --host <origin>        origin cho <url> tương đối        (default http://localhost:<PORT .env>)
//   --basic-auth <u:p>     gửi header Authorization Basic; `auto` = lấy UI_BASIC_AUTH trong
//                          ui-next/.env (UI này có Basic Auth, không có header thì dừng ở 401)
//   --header <"K: V">      lặp lại được, thêm HTTP header cho mọi request
//   --step <spec>          lặp lại được, chạy tuần tự. Xem DSL bên dưới
//   --eval <js>            lặp lại được, chạy sau tất cả step, in kết quả (dump state)
//   --filter <regex>       chỉ in network khớp regex (mặc định: xhr/fetch + mọi request lỗi)
//   --body <regex>         lấy luôn response body của request khớp regex (cắt 2000 ký tự)
//   --all-logs             in MỌI dòng console (mặc định chỉ in error/warning)
//   --no-shot              không chụp màn
//   --json                 ghi báo cáo đầy đủ ra .snapshots/<label>-<id>.json
//
// Step DSL (--step):
//   wait:<ms>                     chờ
//   waitfor:<selector>            chờ tới khi selector xuất hiện (tối đa 15s)
//   click:<selector>              click (dispatch chuột thật vào giữa element)
//   type:<selector>::<text>       focus rồi nhập text (set value + input/change event)
//   key:<phím>                    gửi 1 phím, kèm modifier: Enter, Tab, Escape, Shift+Enter,
//                                 Ctrl+A, ArrowDown… (xem KEYS/MODS trong file)
//   scroll:<selector>             scrollIntoView
//   goto:<url>                    điều hướng
//   eval:<js>                     chạy JS, in kết quả
//   shot:<nhãn>                   chụp màn giữa flow
//
// Ví dụ:
//   # app rezil cần đăng nhập: --login tự lo, --profile giữ session cho lần sau
//   node .../debug.mjs http://localhost:5173/inspection/list --login rezil --profile rezil
//
//   # debug chính UI này (Basic Auth + basePath tự lo), gõ vào khung chat rồi gửi:
//   node .../debug.mjs /chat --label chat --basic-auth auto \
//     --step 'type:textarea::ping' --step 'key:Enter' --step 'wait:5000' \
//     --filter 'api/(chat|cancel)' --eval 'document.querySelectorAll(".md").length'
//
//   node .../debug.mjs http://localhost:5173/ --label mob002 \
//     --env ~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-test.env \
//     --step 'type:input[name=email]::{{EMAIL}}' --step 'type:input[name=password]::{{PASSWORD}}' \
//     --step 'click:button[type=submit]' --step 'waitfor:.home' --step 'click:.header__bell' \
//     --filter 'notifications|announcements' --eval 'window.location.hash'
//
// Stdout: báo cáo text; dòng cuối là đường dẫn ảnh (nếu có chụp) để chèn Markdown vào chat.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_NEXT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(UI_NEXT, ".snapshots");
const MAX_KEEP = 60;

// ---------- args ----------
const argv = process.argv.slice(2);
let url = argv[0];
// `--keep-stop <ten>` chỉ đóng Chrome nền nên KHÔNG cần url; các lệnh còn lại vẫn bắt buộc.
if ((!url || url.startsWith("--")) && !argv.includes("--keep-stop")) {
  console.error("Usage: node scripts/debug.mjs <url|/path> [--label x] [--step '...'] [--eval 'js'] … (xem đầu file)");
  process.exit(2);
}
if (!url || url.startsWith("--")) url = "about:blank";
const has = (n) => argv.includes(`--${n}`);
function opt(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
function optAll(name) {
  const out = [];
  for (let i = 0; i < argv.length - 1; i++) if (argv[i] === `--${name}`) out.push(argv[i + 1]);
  return out;
}
const num = (v, def, lo, hi) => Math.min(Math.max(parseInt(v, 10) || def, lo), hi);

const label = (opt("label", "debug").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 30)) || "debug";
const wait = num(opt("wait", "4000"), 4000, 0, 60000);
const settle = num(opt("settle", "1500"), 1500, 0, 60000);
const width = num(opt("width", "1280"), 1280, 320, 3840);
// --geo "<lat>,<lon>": cấp quyền vị trí + ghi đè toạ độ (app rezil-esms-mobile chặn submit report
// khi không lấy được GPS: hiện popup 位置情報の設定をオン). Không truyền --geo → giữ nguyên hành vi cũ.
const geoOpt = opt("geo", "");
const geo = (() => {
  if (!geoOpt) return null;
  const [la, lo] = geoOpt.split(",").map((s) => parseFloat(s.trim()));
  if (!Number.isFinite(la) || !Number.isFinite(lo)) {
    console.error(`--geo "${geoOpt}": cần dạng "<lat>,<lon>", ví dụ --geo "35.681236,139.767125"`);
    process.exit(2);
  }
  return { latitude: la, longitude: lo, accuracy: 20 };
})();
const height = num(opt("height", "800"), 800, 240, 4320);
const headed = has("headed");
const attachPort = opt("attach", "");
// --keep/--keep-stop: Chrome nền dùng lại giữa nhiều lần chạy (xem KEEP ở phần kết nối).
const slug = (v) => String(v || "").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
const keepName = slug(opt("keep", ""));
const keepStop = slug(opt("keep-stop", ""));
const wantRenav = has("renav");
const wantShot = !has("no-shot");
const allLogs = has("all-logs"); // "check console.log" cần cả log/info, không chỉ error/warning
const wantJson = has("json");
const filterRe = safeRe(opt("filter", ""));
const bodyRe = safeRe(opt("body", ""));

function safeRe(s) {
  if (!s) return null;
  try {
    return new RegExp(s, "i");
  } catch {
    console.error(`Regex không hợp lệ, bỏ qua: ${s}`);
    return null;
  }
}

// --env: nạp key=value cho {{VAR}} — giữ credential ngoài command line.
const vars = {};
// Không ghi đè key đã có: --env của người dùng thắng file credential của preset --login.
function loadEnvInto(file) {
  for (const line of readFileSync(file.replace(/^~/, process.env.HOME), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !(m[1] in vars)) vars[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const envFile = opt("env", "");
if (envFile) {
  try {
    loadEnvInto(envFile);
  } catch (e) {
    console.error(`Không đọc được --env ${envFile}: ${e.message}`);
    process.exit(2);
  }
}
const subst = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
// Che giá trị credential khi in log/báo cáo.
const mask = (s) => {
  let out = String(s);
  for (const v of Object.values(vars)) if (v && v.length > 2) out = out.split(v).join("***");
  return out;
};

const extraChromeFlags = optAll("chrome-flag");
const steps = optAll("step");
const evals = optAll("eval");

// --login <preset>: app có auth thì gọi thẳng URL màn bên trong chỉ ra được màn login, nên script
// tự đăng nhập rồi mới quay lại URL đó. `donePass` = selector ô mật khẩu; nó BIẾN MẤT là dấu hiệu
// đã rời màn login (không phụ thuộc màn đích nên dùng chung cho mọi route).
const LOGIN_PRESETS = {
  // rezil-esms-mobile (Ionic + Svelte, cổng dev 5173) — form email/password của màn ログイン.
  rezil: {
    envFile: "~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-test.env",
    userKey: "REZIL_ESMS_TEST_EMAIL",
    passKey: "REZIL_ESMS_TEST_PASSWORD",
    userSel: "input[name=username]",
    passSel: "input[name=password]",
    // `ion-button` chỉ có PROPERTY type=submit, không có attribute → `ion-button[type=submit]` không
    // match. Nút ログイン là ion-button.btn-primary; loại .sso__button (đăng nhập Microsoft Entra ID).
    submitSel: ["ion-button.btn-primary:not(.sso__button)", "button[type=submit]:not([style*='display: none'])"],
  },
  // rezil-esms-portal (portal khách hàng, SvelteKit) — form /login, cùng selector với admin web nhưng
  // credential riêng: account là customer_account, mật khẩu KHÁC account admin (login 400 nếu dùng sai file).
  "rezil-portal": {
    envFile: "~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-portal.env",
    userKey: "REZIL_PORTAL_TEST_EMAIL",
    passKey: "REZIL_PORTAL_TEST_PASSWORD",
    userSel: "input[name=email]",
    passSel: "input[name=password]",
    submitSel: ["button[type=submit]"],
  },
  // rezil-esms-portal, account thứ 3 (REZIL_PORTAL_TEST_EMAIL3) — account mới, Cognito đang ở
  // FORCE_CHANGE_PASSWORD nên sau khi login sẽ ra màn đặt mật khẩu mới (challenge
  // NEW_PASSWORD_REQUIRED). Mật khẩu mới truyền qua step `type:...::env:REZIL_PORTAL_NEW_PASSWORD`.
  "rezil-portal3": {
    envFile: "~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-portal.env",
    userKey: "REZIL_PORTAL_TEST_EMAIL3",
    passKey: "REZIL_PORTAL_TEST_PASSWORD3",
    userSel: "input[name=email]",
    passSel: "input[name=password]",
    submitSel: ["button[type=submit]"],
  },
  // rezil-esms-portal, account thứ 2 (REZIL_PORTAL_TEST_EMAIL2) — dùng cho account 1-row profile
  // chưa đủ (server trả nextStep=COMPLETE_PROFILE), luồng khác account mặc định.
  "rezil-portal2": {
    envFile: "~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-portal.env",
    userKey: "REZIL_PORTAL_TEST_EMAIL2",
    passKey: "REZIL_PORTAL_TEST_PASSWORD2",
    userSel: "input[name=email]",
    passSel: "input[name=password]",
    submitSel: ["button[type=submit]"],
  },
  // rezil-esms (admin web, SvelteKit, cổng dev 3000) — form メールアドレス/パスワード của /admin/login.
  "rezil-admin": {
    envFile: "~/.claude/projects/-home-nghiadv-IdeaProjects-rezil-esms/credentials/rezil-esms-test.env",
    userKey: "REZIL_ESMS_TEST_EMAIL",
    passKey: "REZIL_ESMS_TEST_PASSWORD",
    userSel: "input[name=email]",
    passSel: "input[name=password]",
    submitSel: ["button[type=submit]"],
  },
};
const loginPreset = opt("login", "");
if (loginPreset) {
  const preset = LOGIN_PRESETS[loginPreset];
  if (!preset) {
    console.error(`--login không có preset "${loginPreset}". Đang có: ${Object.keys(LOGIN_PRESETS).join(", ")}`);
    process.exit(2);
  }
  try {
    loadEnvInto(preset.envFile);
  } catch (e) {
    console.error(`--login ${loginPreset}: không đọc được ${preset.envFile}: ${e.message}`);
    process.exit(2);
  }
}

// --profile: profile Chrome bền để giữ session giữa các lần chạy. Tên ngắn → ui-next/.chrome-profiles/.
// Alias `ci` trỏ tới profile của scripts/capture-ci-evidence.sh (đã đăng nhập GitHub) để debug được
// trang repo private mà không phải login lại.
const PROFILE_ALIASES = { ci: path.join(process.env.HOME ?? "", ".local/share/ci-evidence-profile") };
const profileOpt = opt("profile", "");
const profileDir = !profileOpt
  ? ""
  : PROFILE_ALIASES[profileOpt] ??
    (profileOpt.includes("/")
      ? path.resolve(profileOpt.replace(/^~/, process.env.HOME ?? "~"))
      : path.join(UI_NEXT, ".chrome-profiles", profileOpt.replace(/[^a-zA-Z0-9-_]/g, "-")));
const wantProfileLogin = has("profile-login");
if (profileOpt && !profileDir) {
  console.error(`--profile ${profileOpt}: không giải được đường dẫn profile`);
  process.exit(2);
}
if (wantProfileLogin && !profileDir) {
  console.error("--profile-login cần đi kèm --profile <ten|path> (login vào profile nào?)");
  process.exit(2);
}
if (profileDir) mkdirSync(profileDir, { recursive: true });

// Chrome giữ SingletonLock trên user-data-dir: một tiến trình còn sống (cửa sổ login chưa đóng, lần
// chạy trước bị treo) làm mọi lần sau chết với "Failed to create a ProcessSingleton" và script chỉ
// thấy trang rỗng. Cách xử lý lấy từ scripts/capture-ci-evidence.sh.
// Khớp CHÍNH XÁC thư mục profile: `-f` so trên cả dòng lệnh, nên pattern trần `.../rezil` còn trúng
// `.../rezil-admin` (profile khác) → báo bận nhầm, và pkill bên dưới thì giết nhầm Chrome của profile đó.
const profilePattern = () =>
  `user-data-dir=${profileDir.replace(/[.[\]{}()*+?^$|\\]/g, "\\$&")}( |$)`;
const profileBusy = () =>
  !!profileDir && spawnSync("pgrep", ["-f", profilePattern()]).status === 0;
function clearSingletonLocks() {
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    rmSync(path.join(profileDir, f), { force: true });
  }
}
// Profile đang bị chiếm → chạy trên BẢN CHỤP (cookie + Local State + Local Storage). Không copy
// Default/Preferences: nó mang cấu hình extension và headless treo ở bước register service worker.
let snapDir = "";
function snapshotProfile() {
  snapDir = mkdtempSync(path.join(os.tmpdir(), "dbg-profile-"));
  mkdirSync(path.join(snapDir, "Default"), { recursive: true });
  const copy = (rel) => {
    const from = path.join(profileDir, rel);
    if (existsSync(from)) {
      cpSync(from, path.join(snapDir, rel), { recursive: true });
      return true;
    }
    return false;
  };
  copy("Local State");
  if (!copy("Default/Network/Cookies")) copy("Default/Cookies");
  copy("Default/Local Storage"); // token của SPA thường nằm ở localStorage, không phải cookie
  return snapDir;
}

// ---------- KEEP: Chrome nền dùng lại giữa nhiều lần chạy ----------
// Mỗi lần chạy bình thường trả giá ~12-15s cố định (mở Chrome + chờ DevTools + --wait + kiểm login).
// Chụp evidence hay đi theo cụm: nhiều lệnh liên tiếp trên CÙNG một màn → giá đó nhân lên. `--keep`
// mở Chrome DETACHED, ghi {port,pid} vào lockfile; lần sau attach lại đúng cửa sổ đó, giữ nguyên cả
// trạng thái trang (popup đang mở, form đã điền) nên không phải dựng lại flow.
const keepFile = (n) => path.join(UI_NEXT, ".chrome-profiles", `.keep-${n}.json`);
function readKeep(n) {
  try {
    return JSON.parse(readFileSync(keepFile(n), "utf8"));
  } catch {
    return null;
  }
}
// Lockfile còn nhưng Chrome đã chết (reboot, bị kill) → coi như không có và xoá lock.
async function keepAlive(n) {
  const k = readKeep(n);
  if (!k?.port) return null;
  try {
    const r = await fetch(`http://127.0.0.1:${k.port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) return { ...k, version: await r.json() };
  } catch {}
  rmSync(keepFile(n), { force: true });
  return null;
}

if (keepStop) {
  const k = await keepAlive(keepStop);
  if (!k) {
    console.log(`Không có Chrome keep-alive "${keepStop}" nào đang chạy.`);
    process.exit(0);
  }
  // Browser.close trước rồi mới kill: localStorage/cookie chỉ ghi xuống profile khi Chrome tự tắt.
  let graceful = false;
  try {
    const bws = new WebSocket(k.version.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      bws.addEventListener("open", res, { once: true });
      bws.addEventListener("error", () => rej(new Error("ws browser lỗi")), { once: true });
      setTimeout(() => rej(new Error("hết giờ mở ws browser")), 3000);
    });
    bws.send(JSON.stringify({ id: 1, method: "Browser.close", params: {} }));
    graceful = true;
    await new Promise((r) => setTimeout(r, 1500));
  } catch {}
  if (k.pid) spawnSync("kill", [String(k.pid)]);
  rmSync(keepFile(keepStop), { force: true });
  console.log(`Đã đóng Chrome keep-alive "${keepStop}" (port ${k.port}${graceful ? ", Browser.close" : ", kill"}).`);
  process.exit(0);
}

// Mở cửa sổ Chrome thật để đăng nhập bằng tay vào profile, rồi chạy tiếp phần debug headless.
if (wantProfileLogin) {
  if (profileBusy()) {
    console.error(`Profile đang được một Chrome khác dùng (${profileDir}) — đóng cửa sổ đó rồi chạy lại.`);
    process.exit(2);
  }
  console.error(`Mở Chrome trên profile ${profileDir}. Đăng nhập xong hãy ĐÓNG cửa sổ để script chạy tiếp…`);
  spawnSync(chromeBin(), [`--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", "--new-window", url], {
    stdio: "ignore",
  });
  spawnSync("pkill", ["-f", profilePattern()]);
  await new Promise((r) => setTimeout(r, 1000));
  clearSingletonLocks();
  console.error("Đã đóng cửa sổ đăng nhập, tiếp tục chạy headless.");
}

mkdirSync(OUT_DIR, { recursive: true });
try {
  const files = readdirSync(OUT_DIR)
    .map((f) => ({ f, t: statSync(path.join(OUT_DIR, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t);
  while (files.length > MAX_KEEP) rmSync(path.join(OUT_DIR, files.shift().f), { force: true });
} catch {}

function chromeBin() {
  for (const b of ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser"]) {
    if (spawnSync("which", [b]).status === 0) return b;
  }
  return "google-chrome-stable";
}

const runId = randomUUID().slice(0, 8);

// Đọc 1 key trong ui-next/.env (biến môi trường thắng) — dùng cho basePath, PORT, UI_BASIC_AUTH.
function dotenv(key) {
  if (process.env[key] != null) return process.env[key];
  try {
    const m = readFileSync(path.join(UI_NEXT, ".env"), "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return null;
}
const basePath = () => dotenv("NEXT_PUBLIC_BASE_PATH") ?? "";

// <url> tương đối ("/chat") → host mặc định + basePath. Bỏ qua nếu đã có sẵn basePath ở đầu path.
if (url.startsWith("/")) {
  const origin = opt("host", `http://localhost:${dotenv("PORT") || 5000}`).replace(/\/+$/, "");
  const bp = basePath().replace(/\/+$/, "");
  url = origin + (bp && url !== bp && !url.startsWith(bp + "/") ? bp : "") + url;
}

// Header thêm cho MỌI request: --header "K: V" (lặp được) và --basic-auth.
const extraHeaders = {};
for (const h of optAll("header")) {
  const j = h.indexOf(":");
  if (j > 0) extraHeaders[h.slice(0, j).trim()] = subst(h.slice(j + 1).trim());
}
const basicOpt = opt("basic-auth", "");
if (basicOpt) {
  const cred = basicOpt === "auto" ? dotenv("UI_BASIC_AUTH") : subst(basicOpt);
  if (!cred || !cred.includes(":")) {
    console.error(`--basic-auth cần dạng user:pass${basicOpt === "auto" ? " (không đọc được UI_BASIC_AUTH trong ui-next/.env)" : ""}`);
    process.exit(2);
  }
  // Đưa credential vào vars để mask() che nó trong báo cáo.
  vars.__BASIC_AUTH_USER = cred.split(":")[0];
  vars.__BASIC_AUTH_PASS = cred.slice(cred.indexOf(":") + 1);
  extraHeaders.Authorization = `Basic ${Buffer.from(cred).toString("base64")}`;
}

// ---------- bảng phím cho step `key:` ----------
const mkKey = (key, code, vk, text) => ({ key, code, vk, text });
const KEYS = Object.fromEntries(
  [
    mkKey("Enter", "Enter", 13, "\r"),
    mkKey("Tab", "Tab", 9, "\t"),
    mkKey("Escape", "Escape", 27),
    mkKey("Backspace", "Backspace", 8),
    mkKey("Delete", "Delete", 46),
    mkKey(" ", "Space", 32, " "),
    mkKey("ArrowUp", "ArrowUp", 38),
    mkKey("ArrowDown", "ArrowDown", 40),
    mkKey("ArrowLeft", "ArrowLeft", 37),
    mkKey("ArrowRight", "ArrowRight", 39),
    mkKey("Home", "Home", 36),
    mkKey("End", "End", 35),
    mkKey("PageUp", "PageUp", 33),
    mkKey("PageDown", "PageDown", 34),
  ].map((k) => [k.code.toLowerCase().replace(/^key/, ""), k])
);
const MODS = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };

// ---------- CDP client (request + event) ----------
function cdp(ws) {
  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (ev) => {
    let msg;
    try {
      msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
      return;
    }
    if (msg.method) for (const cb of handlers.get(msg.method) ?? []) cb(msg.params);
  });
  return {
    send: (method, params = {}) =>
      new Promise((res, rej) => {
        const mid = ++id;
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
      }),
    on: (method, cb) => handlers.set(method, [...(handlers.get(method) ?? []), cb]),
  };
}

// ---------- kết nối: tự mở Chrome hoặc attach ----------
let chrome = null;
let profileNote = ""; // ghi chú về profile để in trong báo cáo
let browserWs = ""; // endpoint CDP cấp browser — cần để đóng Chrome tử tế (xem shutdown())
let keepReused = false; // đang attach vào Chrome keep-alive có sẵn → không load lại trang
async function connect() {
  let port = attachPort;
  if (!port && keepName) {
    const k = await keepAlive(keepName);
    if (k) {
      port = String(k.port);
      keepReused = true;
      profileNote = `attach vào Chrome keep-alive "${keepName}" (port ${k.port}) — giữ nguyên trạng thái trang`;
    }
  }
  if (!port) {
    // Profile bị Chrome khác chiếm → chạy trên bản chụp (đọc được session, nhưng thay đổi KHÔNG lưu
    // lại profile gốc). Rảnh → chạy thẳng trên profile và dọn lock cũ còn sót.
    let userDataDir = "";
    if (profileDir) {
      if (profileBusy()) {
        userDataDir = snapshotProfile();
        profileNote = "profile đang bị Chrome khác dùng → chạy trên bản chụp, session mới KHÔNG được lưu";
      } else {
        clearSingletonLocks();
        userDataDir = profileDir;
      }
    }
    const args = [
      ...(headed ? [] : ["--headless=new", "--hide-scrollbars"]),
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // Cùng bộ cờ với scripts/capture-ci-evidence.sh: extension/sync/first-run làm headless treo
      // hoặc đổi nội dung trang khi chạy trên profile thật.
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-component-extensions-with-background-pages",
      `--window-size=${width},${height}`,
      // --chrome-flag: cờ Chrome thêm vào (lặp lại được), vd --chrome-flag --disable-web-security để
      // gọi API khác origin khi dev server chạy trên cổng không nằm trong CORS allow-list của BE.
      ...extraChromeFlags,
      ...(userDataDir ? [`--user-data-dir=${userDataDir}`] : []),
      // --keep cần port BIẾT TRƯỚC (lần chạy sau đọc lockfile để attach) nên không dùng port 0.
      `--remote-debugging-port=${keepName ? await freePort() : 0}`,
      "about:blank",
    ];
    if (keepName) {
      // Detached + stdio ignore: script này thoát trước, Chrome phải sống tiếp và không được ghi vào
      // pipe đã đóng (EPIPE làm Chrome chết ngay sau khi script thoát).
      chrome = spawn(chromeBin(), args, { stdio: "ignore", detached: true });
      chrome.unref();
      const kport = args.find((a) => a.startsWith("--remote-debugging-port=")).split("=")[1];
      const until = Date.now() + 20000;
      let version = null;
      while (Date.now() < until) {
        try {
          const r = await fetch(`http://127.0.0.1:${kport}/json/version`, { signal: AbortSignal.timeout(1000) });
          if (r.ok) {
            version = await r.json();
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!version) throw new Error(`Chrome keep-alive không mở được DevTools trên port ${kport} sau 20s`);
      browserWs = version.webSocketDebuggerUrl;
      port = kport;
      mkdirSync(path.dirname(keepFile(keepName)), { recursive: true });
      writeFileSync(
        keepFile(keepName),
        JSON.stringify({ port: Number(kport), pid: chrome.pid, profile: profileDir, openedFor: url }, null, 2)
      );
      profileNote = `Chrome keep-alive "${keepName}" vừa mở (port ${kport}) — lần sau thêm --keep ${keepName} là attach lại, đóng bằng --keep-stop ${keepName}`;
      return finishConnect(port);
    }
    chrome = spawn(chromeBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = "";
      const to = setTimeout(() => reject(new Error("hết giờ chờ DevTools")), 15000);
      chrome.stderr.on("data", (d) => {
        buf += d.toString();
        const m = buf.match(/ws:\/\/[^\s]+/);
        if (m) {
          clearTimeout(to);
          resolve(m[0]);
        }
      });
      chrome.on("exit", (c) => {
        clearTimeout(to);
        reject(new Error(`chrome thoát sớm (exit ${c})`));
      });
    });
    browserWs = wsUrl;
    port = new URL(wsUrl).port;
  }
  return finishConnect(port);
}

async function finishConnect(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page") || targets[0];
  if (!page?.webSocketDebuggerUrl) throw new Error("không tìm thấy page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("WebSocket lỗi")), { once: true });
  });
  return { ws, c: cdp(ws) };
}

// Cổng còn rảnh cho Chrome keep-alive (port 0 không dùng được: lần sau phải biết port mà attach).
function freePort() {
  return new Promise((resolve, reject) => {
    import("node:net").then(({ createServer }) => {
      const srv = createServer();
      srv.on("error", reject);
      srv.listen(0, "127.0.0.1", () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
      });
    }, reject);
  });
}

// Đóng Chrome bằng Browser.close rồi mới kill: localStorage/IndexedDB chỉ được ghi xuống đĩa khi
// Chrome tự tắt. Kill thẳng (SIGTERM) làm mất session vừa login → --profile trở nên vô nghĩa.
async function shutdown() {
  // --keep: để Chrome sống cho lần chạy sau attach vào. Đóng bằng `--keep-stop <ten>`.
  if (keepName) {
    if (snapDir) rmSync(snapDir, { recursive: true, force: true });
    return;
  }
  if (!chrome) return;
  if (browserWs) {
    try {
      const bws = new WebSocket(browserWs);
      await new Promise((res, rej) => {
        bws.addEventListener("open", res, { once: true });
        bws.addEventListener("error", () => rej(new Error("ws browser lỗi")), { once: true });
        setTimeout(() => rej(new Error("hết giờ mở ws browser")), 3000);
      });
      bws.send(JSON.stringify({ id: 1, method: "Browser.close", params: {} }));
      await new Promise((res) => {
        if (chrome.exitCode != null) return res();
        const t = setTimeout(res, 8000);
        chrome.once("exit", () => {
          clearTimeout(t);
          res();
        });
      });
    } catch {}
  }
  try {
    chrome.kill();
  } catch {}
  if (snapDir) rmSync(snapDir, { recursive: true, force: true });
}

// ---------- thu thập ----------
const consoleLogs = []; // {level, text, at}
const errors = []; // {text, stack}
const requests = new Map(); // requestId -> {method,url,type,status,ttfb,ms,size,failed,body}
const shots = [];
const evalResults = [];
const stepLog = [];

const fmtArg = (a) => {
  if (!a) return "";
  if ("value" in a) return typeof a.value === "object" ? JSON.stringify(a.value) : String(a.value);
  if (a.unserializableValue) return a.unserializableValue;
  if (a.description) return a.description;
  if (a.preview?.properties) return `{${a.preview.properties.map((p) => `${p.name}:${p.value}`).join(",")}}`;
  return a.type ?? "";
};
const frame0 = (st) => {
  const f = st?.callFrames?.[0];
  return f ? `${f.url.split("/").pop()}:${f.lineNumber + 1}` : "";
};

const { ws, c } = await connect();
try {
  await c.send("Page.enable");
  await c.send("Runtime.enable");
  await c.send("Log.enable");
  await c.send("Network.enable");
  if (Object.keys(extraHeaders).length) await c.send("Network.setExtraHTTPHeaders", { headers: extraHeaders });

  c.on("Runtime.consoleAPICalled", (p) => {
    consoleLogs.push({ level: p.type, text: mask(p.args.map(fmtArg).join(" ")), at: frame0(p.stackTrace) });
  });
  c.on("Log.entryAdded", (p) => {
    consoleLogs.push({ level: p.entry.level, text: mask(p.entry.text), at: p.entry.url ? `${p.entry.url.split("/").pop()}:${p.entry.lineNumber ?? ""}` : "" });
  });
  c.on("Runtime.exceptionThrown", (p) => {
    const d = p.exceptionDetails;
    errors.push({
      text: mask(d.exception?.description ?? d.text ?? "exception"),
      stack: (d.stackTrace?.callFrames ?? []).slice(0, 4).map((f) => `${f.functionName || "(anon)"} @ ${f.url.split("/").pop()}:${f.lineNumber + 1}`),
    });
  });
  c.on("Network.requestWillBeSent", (p) => {
    requests.set(p.requestId, { method: p.request.method, url: p.request.url, type: p.type ?? "", t0: p.timestamp });
  });
  c.on("Network.responseReceived", (p) => {
    const r = requests.get(p.requestId);
    if (!r) return;
    r.status = p.response.status;
    r.type = p.type ?? r.type;
    r.ttfb = Math.round(p.response.timing?.receiveHeadersEnd ?? 0);
    r.mime = p.response.mimeType;
  });
  c.on("Network.loadingFinished", async (p) => {
    const r = requests.get(p.requestId);
    if (!r) return;
    r.size = p.encodedDataLength;
    r.ms = Math.round((p.timestamp - r.t0) * 1000);
    if (bodyRe?.test(r.url)) {
      try {
        const b = await c.send("Network.getResponseBody", { requestId: p.requestId });
        r.body = mask(b.body ?? "").slice(0, 2000);
      } catch {}
    }
  });
  c.on("Network.loadingFailed", (p) => {
    const r = requests.get(p.requestId);
    if (!r) return;
    r.failed = p.errorText || "failed";
    r.ms = Math.round((p.timestamp - r.t0) * 1000);
  });

  // ---------- helpers trong trang ----------
  const evaluate = async (expr) => {
    const res = await c.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
    return res.result?.value;
  };
  const centerOf = (sel) =>
    evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return null; e.scrollIntoView({block:'center'});
      const r = e.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`);
  const clickSel = async (sel) => {
    const pt = await centerOf(sel);
    if (!pt) throw new Error(`không thấy selector ${sel}`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await c.send("Input.dispatchMouseEvent", { type, x: pt.x, y: pt.y, button: "left", clickCount: 1 });
    }
  };
  // Nhập text: focus + chọn hết nội dung cũ rồi Input.insertText — đi qua đúng đường nhập của
  // browser nên input controlled của React/Svelte nhận được thay đổi. Gán thẳng `e.value` thì React
  // so sánh với state nội bộ và ghi đè lại → ô nhập trông như không nhận chữ.
  const typeSel = async (sel, text) => {
    const ok = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)});
      if (!e) return false; e.focus();
      // input type=email/number không hỗ trợ selection → setSelectionRange ném InvalidStateError.
      if (e.setSelectionRange && e.value != null) { try { e.setSelectionRange(0, e.value.length); } catch { e.value = ''; } }
      else if (e.isContentEditable) document.getSelection()?.selectAllChildren(e);
      return true; })()`);
    if (!ok) return false;
    await c.send("Input.insertText", { text });
    return true;
  };
  const waitFor = async (sel, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`)) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };
  // Gửi 1 phím: "Enter", "Tab", "Shift+Enter", "Ctrl+a"… Thiếu windowsVirtualKeyCode/text thì
  // nhiều handler (Enter để submit, Tab để chuyển focus) không chạy, nên map từng phím.
  const pressKey = async (spec) => {
    const parts = spec.split("+").map((x) => x.trim()).filter(Boolean);
    const name = parts.pop() ?? "";
    let modifiers = 0;
    for (const m of parts) {
      const bit = MODS[m.toLowerCase()];
      if (!bit) throw new Error(`modifier không hiểu: ${m}`);
      modifiers |= bit;
    }
    const k = KEYS[name.toLowerCase()] ?? (name.length === 1 ? { key: name, code: `Key${name.toUpperCase()}`, vk: name.toUpperCase().charCodeAt(0), text: name } : null);
    if (!k) throw new Error(`phím không hiểu: ${name}`);
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
    // Có modifier (trừ Shift) thì KHÔNG gửi `text` — nếu gửi, trang nhận thêm ký tự (Ctrl+A gõ ra "a").
    const text = k.text && (modifiers & ~8) === 0 ? k.text : undefined;
    await c.send("Input.dispatchKeyEvent", { ...base, type: text ? "keyDown" : "rawKeyDown", ...(text ? { text } : {}) });
    await c.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  };

  // Chờ tới khi biểu thức JS trả về true.
  const waitExpr = async (expr, timeout = 20000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      try {
        if (await evaluate(expr)) return true;
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  // Chờ selector BIẾN MẤT — dùng để biết đã rời màn login.
  const waitGone = async (sel, timeout = 20000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      if (!(await evaluate(`!!document.querySelector(${JSON.stringify(sel)})`))) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  };

  const shoot = async (tag) => {
    if (!wantShot) return null;
    const name = `${label}-${tag}-${runId}.png`;
    const s = await c.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path.join(OUT_DIR, name), Buffer.from(s.data, "base64"));
    shots.push(name);
    return name;
  };

  // ---------- điều hướng ----------
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }).catch(() => {});
  if (geo) {
    const origin = new URL(url).origin;
    await c.send("Browser.grantPermissions", { origin, permissions: ["geolocation"] }).catch(() => {});
    await c.send("Emulation.setGeolocationOverride", geo).catch(() => {});
  }
  // Attach vào Chrome keep-alive mà trang đang mở CÙNG origin → không load lại: giữ nguyên trạng
  // thái đang dựng (popup, form, bước giữa flow) và bỏ luôn --wait. `--renav` để buộc load lại.
  let keptPage = false;
  if (keepReused && !wantRenav) {
    try {
      const href = String((await evaluate("location.href")) ?? "");
      keptPage = !!href && new URL(href).origin === new URL(url).origin;
    } catch {}
  }
  if (keptPage) {
    stepLog.push({ step: "navigate", ok: true, note: `giữ nguyên trang đang mở (--keep ${keepName}); dùng --renav để load lại ${url}` });
  } else {
    await c.send("Page.navigate", { url });
    await new Promise((r) => setTimeout(r, wait));
  }

  // ---------- đăng nhập (--login) ----------
  // Chạy TRƯỚC mọi --step: không login thì URL màn bên trong chỉ trả về màn login, mọi thứ thu được
  // (console, network, ảnh) đều là của màn login chứ không phải màn cần debug.
  let loginFailed = false;
  if (loginPreset) {
    const p = LOGIN_PRESETS[loginPreset];
    try {
      // Chờ trang render xong TRƯỚC khi kết luận có màn login hay không: dev server (Vite) mất vài
      // giây mới dựng DOM, hỏi sớm thì không thấy ô mật khẩu và tưởng là đã có session.
      // Không dùng body.innerText làm tín hiệu duy nhất: app Ionic/Capacitor dựng nội dung trong
      // shadow DOM nên innerText có thể rỗng dù trang đã render xong.
      const rendered = await waitExpr(
        `!!document.querySelector(${JSON.stringify(p.passSel)}) || document.querySelectorAll("*").length > 50 || document.body.innerText.trim().length > 0`,
        30000
      );
      if (!rendered) throw new Error("trang không render sau 30s (app chưa sẵn sàng?)");
      if (!(await evaluate(`!!document.querySelector(${JSON.stringify(p.passSel)})`))) {
        stepLog.push({ step: `login:${loginPreset}`, ok: true, note: "đã có session, bỏ qua" });
      } else {
        const user = vars[p.userKey];
        const pass = vars[p.passKey];
        if (!user || !pass) throw new Error(`thiếu ${p.userKey}/${p.passKey} trong ${p.envFile}`);
        if (!(await typeSel(p.userSel, user))) throw new Error(`không thấy ô tài khoản ${p.userSel}`);
        if (!(await typeSel(p.passSel, pass))) throw new Error(`không thấy ô mật khẩu ${p.passSel}`);
        let clicked = false;
        for (const sel of [].concat(p.submitSel)) {
          try {
            await clickSel(sel);
            clicked = true;
            break;
          } catch {}
        }
        // Không click được (nút ẩn / class đổi) → submit thẳng form chứa ô mật khẩu.
        if (!clicked) {
          const submitted = await evaluate(`(() => { const f = document.querySelector(${JSON.stringify(p.passSel)})?.closest("form");
            if (!f) return false; f.requestSubmit ? f.requestSubmit() : f.submit(); return true; })()`);
          if (!submitted) throw new Error(`không bấm được nút đăng nhập (${[].concat(p.submitSel).join(" | ")})`);
        }
        if (!(await waitGone(p.passSel))) throw new Error("vẫn ở màn login sau 20s (sai credential, hoặc selector/luồng login đã đổi)");
        // App thường điều hướng về màn mặc định sau login → quay lại đúng URL đã yêu cầu.
        const href = await evaluate("location.href");
        if (href !== url) {
          await c.send("Page.navigate", { url });
          await new Promise((r) => setTimeout(r, wait));
        }
        stepLog.push({ step: `login:${loginPreset}`, ok: true, note: profileDir ? "đã lưu session vào profile" : "profile tạm — lần sau vẫn phải login (dùng --profile để giữ)" });
      }
    } catch (e) {
      stepLog.push({ step: `login:${loginPreset}`, ok: false, error: e.message });
      loginFailed = true; // bỏ qua step: chạy tiếp trên màn login chỉ tạo báo cáo rác
    }
  }

  // ---------- chạy step ----------
  for (const raw of loginFailed ? [] : steps) {
    const spec = subst(raw);
    const i = spec.indexOf(":");
    const kind = (i < 0 ? spec : spec.slice(0, i)).trim().toLowerCase();
    const arg = i < 0 ? "" : spec.slice(i + 1);
    const shown = mask(`${kind}:${arg}`);
    try {
      switch (kind) {
        case "wait":
          await new Promise((r) => setTimeout(r, num(arg, 500, 0, 60000)));
          break;
        case "waitfor": {
          const ok = await waitFor(arg.trim());
          if (!ok) throw new Error("hết giờ chờ selector");
          break;
        }
        case "click":
          await clickSel(arg.trim());
          break;
        case "type": {
          const j = arg.indexOf("::");
          if (j < 0) throw new Error("thiếu ::<text>");
          const ok = await typeSel(arg.slice(0, j).trim(), arg.slice(j + 2));
          if (!ok) throw new Error(`không thấy selector ${arg.slice(0, j).trim()}`);
          break;
        }
        case "key":
          await pressKey(arg.trim());
          break;
        case "scroll":
          await centerOf(arg.trim());
          break;
        case "goto":
          await c.send("Page.navigate", { url: arg.trim() });
          await new Promise((r) => setTimeout(r, wait));
          break;
        case "eval":
          evalResults.push({ expr: mask(arg), value: await evaluate(arg) });
          break;
        case "shot":
          await shoot((arg.trim() || "step").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 20));
          break;
        default:
          throw new Error(`step không hiểu: ${kind}`);
      }
      stepLog.push({ step: shown, ok: true });
    } catch (e) {
      stepLog.push({ step: shown, ok: false, error: e.message });
      break; // step lỗi thì dừng, phần đã thu vẫn được báo cáo
    }
  }

  await new Promise((r) => setTimeout(r, settle));

  for (const ex of evals) {
    try {
      evalResults.push({ expr: mask(ex), value: await evaluate(subst(ex)) });
    } catch (e) {
      evalResults.push({ expr: mask(ex), error: e.message });
    }
  }

  await shoot("end");
} finally {
  try {
    ws.close();
  } catch {}
  await shutdown();
}

// ---------- báo cáo ----------
const net = [...requests.values()];
const shownNet = net.filter((r) => {
  if (r.failed || (r.status && r.status >= 400)) return true;
  if (filterRe) return filterRe.test(r.url);
  return ["XHR", "Fetch"].includes(r.type);
});
const short = (u) => {
  try {
    const x = new URL(u);
    return (x.pathname + (x.search || "")).slice(0, 70);
  } catch {
    return u.slice(0, 70);
  }
};
const kb = (n) => (n == null ? "-" : `${(n / 1024).toFixed(1)} kB`);

const out = [];
const stepDone = stepLog.filter((s) => s.ok && !s.step.startsWith("login:")).length;
out.push(`URL: ${url}   |   step: ${stepDone}/${steps.length} ok   |   request: ${net.length} (in ra ${shownNet.length})`);
if (profileDir) out.push(`Profile: ${profileDir}${profileNote ? ` — ${profileNote}` : ""}`);
if (stepLog.some((s) => !s.ok && s.step.startsWith("login:"))) out.push("LOGIN THẤT BẠI → đã bỏ qua toàn bộ step; báo cáo dưới đây là của MÀN LOGIN, không phải màn cần debug.");

if (stepLog.length) {
  out.push("", "## Step");
  for (const s of stepLog) out.push(`${s.ok ? "OK  " : "FAIL"} ${s.step}${s.error ? `  → ${s.error}` : ""}${s.note ? `  (${s.note})` : ""}`);
}

const bad = consoleLogs.filter((l) => ["error", "warning", "warn"].includes(l.level));
const shownLogs = allLogs ? consoleLogs : bad;
out.push("", `## Console (${consoleLogs.length} dòng, ${bad.length} error/warning${allLogs ? "" : " — thêm --all-logs để xem mọi dòng"})`);
for (const l of shownLogs.slice(0, allLogs ? 80 : 40)) out.push(`[${l.level}] ${l.text}${l.at ? `   (${l.at})` : ""}`);
if (!shownLogs.length) out.push(allLogs ? "(không có dòng console nào)" : "(không có error/warning)");
if (shownLogs.length > (allLogs ? 80 : 40)) out.push(`… còn ${shownLogs.length - (allLogs ? 80 : 40)} dòng nữa (dùng --json để lấy đủ)`);

if (errors.length) {
  out.push("", `## Uncaught exception (${errors.length})`);
  for (const e of errors.slice(0, 10)) out.push(`${e.text}`, ...e.stack.map((s) => `    ${s}`));
}

out.push("", `## Network`);
if (shownNet.length) {
  out.push("| status | ms | TTFB | size | url |", "|---|---|---|---|---|");
  for (const r of shownNet.slice(0, 60)) {
    out.push(`| ${r.failed ? `ERR ${r.failed}` : (r.status ?? "-")} | ${r.ms ?? "-"} | ${r.ttfb ?? "-"} | ${kb(r.size)} | ${r.method} ${short(r.url)} |`);
  }
} else out.push("(không có request khớp bộ lọc)");

const withBody = shownNet.filter((r) => r.body);
if (withBody.length) {
  out.push("", "## Response body");
  for (const r of withBody) out.push(`--- ${short(r.url)}`, r.body);
}

if (evalResults.length) {
  out.push("", "## Eval");
  for (const e of evalResults) out.push(`${e.expr}  →  ${e.error ? `LỖI: ${e.error}` : JSON.stringify(e.value)}`);
}

const bp = basePath();
if (shots.length) {
  out.push("", "## Ảnh");
  for (const s of shots) out.push(`${bp}/api/snapshot/${s}`);
}

if (wantJson) {
  const jsonName = `${label}-${runId}.json`;
  writeFileSync(
    path.join(OUT_DIR, jsonName),
    JSON.stringify({ url, stepLog, consoleLogs, errors, network: net.map(({ t0, ...r }) => r), evalResults, shots }, null, 2)
  );
  out.push("", `Báo cáo đầy đủ: ${path.join(OUT_DIR, jsonName)}`);
}

console.log(out.join("\n"));
// dòng cuối = ảnh cuối, để chèn Markdown vào chat
if (shots.length) console.log(`${bp}/api/snapshot/${shots[shots.length - 1]}`);
