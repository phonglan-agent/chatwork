// PM2 ecosystem for the Next.js AI agent UI (this app only).
//   cd ui-next && pm2 start ecosystem.config.js     # start the app
//   pm2 restart ai-agent-ui-next                    # apply changes (build first!)
//   pm2 logs ai-agent-ui-next
//   pm2 save && pm2 startup                         # persist across reboots
//
// Build before (re)starting:  cd ui-next && npm run build   (bakes NEXT_PUBLIC_BASE_PATH)
// Exposing to the internet: app `ai-agent-ngrok` below chạy scripts/ngrok.sh, ngrok trỏ THẲNG vào
// PORT của app này (app phục vụ ở gốc `/`, NEXT_PUBLIC_BASE_PATH để rỗng).
// Config in ui-next/.env: PORT, HOSTNAME, NEXT_PUBLIC_BASE_PATH, UI_BASIC_AUTH.

const path = require("path");

try {
  require("dotenv").config({ path: path.join(__dirname, ".env") });
} catch {}

const PORT = process.env.PORT || "5000";
const HOST = process.env.HOSTNAME || "127.0.0.1";

// Chọn Claude account cho agent do UI spawn — đặt CLAUDE_ACCOUNT trong ui-next/.env:
//   (trống) | default → account mặc định  → UNSET CLAUDE_CONFIG_DIR
//   account2 → ~/.claude-account2   (đăng nhập lại được từ 2026-08-19)
//   account3 → ~/.claude-account3
//   /đường/dẫn/tuyệt/đối → dùng nguyên
//
// ⚠️ Account mặc định = UNSET, KHÔNG PHẢI `~/.claude`. Lý do: `CLAUDE_CONFIG_DIR` đổi luôn chỗ CLI
// đọc file config thành `$CLAUDE_CONFIG_DIR/.claude.json`. Config THẬT của account mặc định lại nằm
// ở `~/.claude.json` (NGOÀI dir, đủ 5 MCP), còn `~/.claude/.claude.json` chỉ là file stub với
// mcpServers = { atlassian } → set `~/.claude` là agent MẤT mysql_207 / gsheets / figma. Các dir
// account2/3 thì tự chứa `.claude.json` đầy đủ nên trỏ vào chúng chạy bình thường.
//
// Luôn set/delete tường minh: env spread từ pm2 daemon, mà daemon kế thừa từ terminal đã start nó
// (có thể đang trỏ account cũ/đã chết) — không xoá tay thì giá trị lạ lọt vào.
const HOME = process.env.HOME;
const ACCOUNT = (process.env.CLAUDE_ACCOUNT || "").trim();
const CLAUDE_DIR =
  !ACCOUNT || ACCOUNT === "default"
    ? ""
    : path.isAbsolute(ACCOUNT)
      ? ACCOUNT
      : path.join(HOME, `.claude-${ACCOUNT.replace(/^\.?claude-/, "")}`);

if (CLAUDE_DIR === path.join(HOME, ".claude")) {
  console.warn(
    "[ecosystem] CLAUDE_ACCOUNT trỏ vào ~/.claude — dir này chỉ có file stub 1 MCP server.\n" +
      "            Bỏ trống CLAUDE_ACCOUNT để dùng account mặc định. Đang unset CLAUDE_CONFIG_DIR."
  );
}

// The UI spawns `claude` by name; pm2's PATH often lacks ~/.local/bin where it lives. Dedupe so the
// prefix doesn't pile up một bản sao mỗi lần restart (env spread lại từ chính nó).
const PATH = [`${HOME}/.local/bin`, ...(process.env.PATH || "").split(":")]
  .filter((p, i, a) => p && a.indexOf(p) === i)
  .join(":");

const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "production",
  PORT,
  HOSTNAME: HOST,
  PATH,
};

// Xoá biến điều khiển RÒ TỪ PHIÊN CLAUDE CODE CHA. `pm2 start/restart --update-env` lấy env của
// terminal gọi lệnh — start pm2 từ bên trong một phiên Claude Code là app thừa hưởng CLAUDECODE=1,
// CLAUDE_CODE_SESSION_ID, CLAUDE_EFFORT... rồi truyền tiếp cho MỌI `claude -p` mà nó spawn: CLI
// tưởng mình là phiên con của phiên cha, và CLAUDE_EFFORT đè effort mà app tự chọn (auto/feature
// không truyền cờ --effort). App phải luôn spawn agent "sạch" nên xoá hết ở đây.
for (const k of Object.keys(env)) {
  if (/^(CLAUDECODE|CLAUDE_|AI_AGENT$)/.test(k)) delete env[k];
}

// Chỉ set lại CLAUDE_CONFIG_DIR khi thực sự chọn account khác (xem trên).
if (CLAUDE_DIR && CLAUDE_DIR !== path.join(HOME, ".claude")) {
  env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
}

module.exports = {
  apps: [
    {
      name: "ai-agent-ui-next",
      script: "./node_modules/next/dist/bin/next",
      args: "start",
      interpreter: "node",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      // Đổi env phải apply bằng `pm2 restart ecosystem.config.js --update-env`
      // (restart theo TÊN process sẽ giữ env cũ).
      env,
      out_file: path.join(__dirname, "logs/ui-out.log"),
      error_file: path.join(__dirname, "logs/ui-error.log"),
      merge_logs: true,
      time: true,
    },
    {
      // Bot Telegram — TIẾN TRÌNH RIÊNG, cố tình KHÔNG nằm trong app Next.
      // Lý do: bot là kênh cứu hộ. Nếu nó chạy chung ai-agent-ui-next thì một lần restart hỏng /
      // build lỗi là mất luôn đường ra lệnh "khởi động lại pm2". Tách ra, restart app này không
      // đụng tới bot, và bot có lệnh /restart /status /logs để dựng lại app kia.
      // ⚠️ Chỉ được có ĐÚNG MỘT process poll token: nếu bật TELEGRAM_IN_PROCESS=1 cho app Next thì
      // phải `pm2 stop ai-agent-telegram`, không thì Telegram trả 409 Conflict.
      name: "ai-agent-telegram",
      script: "./telegram-bot.mjs",
      interpreter: "node",
      // lib/*.js là ESM nhưng package.json không khai "type" (thêm vào sẽ vỡ các file config dùng
      // require). Node vẫn chạy đúng nhờ tự nhận cú pháp — chỉ tắt cảnh báo cho log đỡ rác.
      node_args: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "400M",
      // Nhịp thở: poll loop hỏng → process tự exit → pm2 dựng lại. Chặn vòng lặp crash-restart
      // liên tục (token sai, mạng chết) bằng restart_delay + giới hạn số lần restart nhanh.
      restart_delay: 5000,
      min_uptime: 15000,
      max_restarts: 20,
      env,
      out_file: path.join(__dirname, "logs/telegram-out.log"),
      error_file: path.join(__dirname, "logs/telegram-error.log"),
      merge_logs: true,
      time: true,
    },
    {
      // ngrok RIÊNG của project. Script tự chờ app lên
      // (/api/healthz) rồi mới dựng tunnel, và từ chối chạy nếu UI_BASIC_AUTH trống.
      // Domain + authtoken đọc từ ui-next/.env → đổi chúng phải restart bằng --fresh.
      name: "ai-agent-ngrok",
      script: "./scripts/ngrok.sh",
      interpreter: "bash",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      // Tunnel rớt (mạng chết, endpoint bị agent khác chiếm) → thử lại thưa, không quay vòng liên tục.
      restart_delay: 10000,
      min_uptime: 20000,
      max_restarts: 20,
      env,
      out_file: path.join(__dirname, "logs/ngrok-out.log"),
      error_file: path.join(__dirname, "logs/ngrok-error.log"),
      merge_logs: true,
      time: true,
    },
  ],
};
