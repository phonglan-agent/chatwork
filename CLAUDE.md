# CLAUDE.md

## Role

You are an AI Software Engineer working on this repository.

Goals:
- Understand Jira tickets.
- Produce safe, minimal code changes.
- Follow existing project conventions.
- Prefer correctness to creativity.

## Core Rules

1. Never merge PRs.
2. Never deploy production.
3. Never modify secrets.
4. Never force-push `develop` or `main` (protected branches). Force-pushing your own branch (feature/fix, `release/*`) or a tag is allowed when genuinely needed.
5. Never change infrastructure unless explicitly instructed.
6. Run tests and build before proposing completion.
7. Stop and ask for help if requirements are ambiguous.
8. Never degrade working behaviour. Before editing shared code, list every caller it affects; keep the
   old contract and add a branch for the new case instead of changing defaults; never delete a guard,
   attribute, or filter you don't understand; re-read every diff hunk before committing. Build/test
   passing is NOT proof there is no degrade — see `AGENT_RULES.md` §Chống degrade for the rules and the
   past cases they come from.

## Workflows

There are two workflows. Pick by task type:

- **Fix-Bug** (`WORKFLOW.md`, `prompts/fix_bug.md`) — a bug fix / small change driven by a Jira ticket.
  Read Jira -> Create branch -> Implement -> Test -> Build -> Commit -> PR -> Update Jira.
- **Feature** (`WORKFLOW_FEATURE.md`, `prompts/feature_workflow.md`) — building a new feature from design
  docs. 16 phases: BD + Figma -> spec -> UT/IT -> OpenAPI/Aspida -> Scala LIB/BE -> Svelte FE -> test ->
  review -> PR. Design-first, testcase-first, contract-first; per-phase artifacts under
  `.ai-agent/generated/` (git-ignored); may produce a PR in both `rezil-esms` and `rezil-esms-lib`.

## Coding Style

- Keep changes small.
- Reuse existing patterns.
- Avoid unrelated refactoring.
- Add tests when appropriate.

## Project Structure

```
ai-agent/
├── CLAUDE.md
├── README.md
├── AGENT_RULES.md
├── WORKFLOW.md          # Fix-Bug workflow (12-step ticket → minimal fix → PR)
├── WORKFLOW_FEATURE.md  # Feature workflow (16-phase BD + Figma → Scala/Svelte → PR)
├── TOOLS.md
├── MEMORY.md
│
├── prompts/
│   ├── fix_bug.md
│   ├── feature_workflow.md
│   ├── create_pr.md
│   ├── update_jira.md
│   └── review_pr.md
│
├── config/
│   ├── jira.json
│   ├── github.json
│   ├── project.json
│   └── story.json        # secondary "story" project for Auto/Chat (non-Jira)
│
├── memory/
│   ├── architecture.md
│   ├── coding_style.md
│   ├── common_bugs.md
│   ├── deployment.md
│   ├── database.md
│   └── jira_history.md
│
├── scripts/
│   ├── _lib.js
│   ├── fix-ticket.js
│   ├── create-pr.js
│   ├── update-jira.js
│   └── share-projects.sh  # 2 account Claude dùng chung thư mục phiên (symlink) — cho auto-switch khi hết quota
│
├── templates/
│   ├── pr_template.md
│   ├── jira_comment.md
│   └── commit_message.md
│
└── ui-next/               # Next.js (App Router + React + Tailwind) web UI — port 5000, ngrok, Basic Auth
    ├── app/               # pages (auto REZIL/Feature/Story, release, chat, /kloc, /translate, /usage)
    │                      #   + api route handlers (SSE)
    │                      #   /kloc: đọc PR merge 4 repo rezil → append LoC vào Sheet KLoC-MVP2
    │                      #   (spec app/kloc/KLOC_SPEC.md đọc lúc chạy, không cần build)
    │                      #   /translate: đối chiếu tài liệu bản VN ↔ bản JP trên Google Sheet (8 cặp
    │                      #   file khai ở lib/translate.js), báo điểm lệch cho BSE; ghi report vào tab
    │                      #   ChecklistAI khi được yêu cầu (spec app/translate/TRANSLATE_SPEC.md,
    │                      #   đọc lúc chạy, không cần build); tab đã soát nhớ trong
    │                      #   data/translate-scan-state.json qua scripts/translate-state.mjs
    ├── lib/               # config / claude SSE / auto+feature+story+release prompts / usage / limits / job-lock
    │                      #   + accountSwitch.js: chat tự đổi account Claude khi hết quota (xem §Nhiều account)
    ├── proxy.js           # HTTP Basic Auth (UI_BASIC_AUTH) — Next "proxy" convention
    ├── telegram-bot.mjs   # bot Telegram chạy TIẾN TRÌNH RIÊNG (pm2 app ai-agent-telegram)
    ├── scripts/shot-check.mjs # kiểm ảnh evidence bằng text (decode PNG, đếm pixel khoanh đỏ) —
    │                          #   /evidence KHÔNG được Read file .png, xem README §/evidence
    ├── scripts/pm2-restart.sh # restart pm2 an toàn từ trong chính app (setsid + bậc thang tự chữa
    │                          #   + --fresh nạp lại .env, tự xoá CLAUDE_* rò từ phiên gọi lệnh)
    ├── ecosystem.config.js# pm2: ai-agent-ui-next + ai-agent-telegram (ngrok do ~/IdeaProjects/gateway lo)
    ├── .env               # UI config: UI_BASIC_AUTH + PORT/HOSTNAME/NGROK_DOMAIN (pm2); npm scripts dùng -p 5000
    └── .env.example
```

> UI cũ `ui/server.js` (Node thuần) đã được thay bằng `ui-next/` (Next.js). Xem `ui-next/README.md`.

## Bot Telegram = kênh cứu hộ (đừng gộp lại vào app Next)

Bot chạy ở pm2 app **riêng** `ai-agent-telegram` (`ui-next/telegram-bot.mjs`), KHÔNG còn khởi động
trong `instrumentation.js`. Lý do: bot chạy chung app thì mỗi lần `ai-agent-ui-next` restart hỏng là
mất luôn kênh ra lệnh khôi phục.

- **Không bao giờ** gọi thẳng `pm2 restart|stop|delete ai-agent-ui-next` từ agent/console — agent là
  process CON của app đó, pm2 giết cả cây process nên lệnh chết giữa chừng và app không lên lại.
  Dùng `ui-next/scripts/pm2-restart.sh <app>` (tự `setsid`, có bậc thang delete + start lại từ
  ecosystem, báo kết quả qua Telegram). Guard prompt: `PM2_OPS_SAFETY` trong `ui-next/lib/claude.js`.
- **Sửa `app/`/`lib/` → `npm run build` TRƯỚC khi restart.** Sửa `ui-next/.env` → phải
  `./scripts/pm2-restart.sh <app> --fresh` (delete + start): `pm2 restart` không nạp lại `.env` vì
  `ecosystem.config.js` chỉ đọc file đó lúc `pm2 start`. Sửa file `.md` (spec `/evidence`, selector
  map) thì không cần build lẫn restart — đọc lúc chạy.
- **Không gõ pm2 tay từ trong phiên Claude Code.** `pm2` nhét env của shell gọi lệnh vào app, đè cả
  phần `ecosystem.config.js` đã xoá (kể cả `pm2 delete` + `pm2 start`) → app thừa hưởng
  `CLAUDE_CONFIG_DIR`/`CLAUDE_EFFORT` của phiên đó và truyền tiếp cho mọi `claude -p` nó spawn, tức
  agent chạy nhầm account. Script restart đã tự xoá `CLAUDECODE|CLAUDE_*|AI_AGENT` trước khi gọi pm2.
- Trong Telegram: `/status`, `/restart [app]`, `/logs [app] [n]` — chạy thẳng pm2 CLI, không qua
  `claude`, nên vẫn dùng được khi agent hỏng hoặc hết quota.
- Chỉ MỘT process được poll một bot token (bật `TELEGRAM_IN_PROCESS=1` thì phải stop app bot, không
  thì Telegram trả 409). Chi tiết: `ui-next/README.md` §Bot Telegram & cứu hộ pm2.

## Nhiều account Claude (fallback khi hết quota)

Máy này có 3 account, khai báo ở `ui-next/lib/config.js` → `ACCOUNTS`: `acct1` = `~/.claude` (account
mặc định), `acct2` = `~/.claude-account2`, `acct3` = `~/.claude-account3`. Thêm account = thêm 1 entry.

- **Account mặc định phải UNSET `CLAUDE_CONFIG_DIR`.** Set biến đó thành `~/.claude` sẽ khiến CLI đọc
  file stub `~/.claude/.claude.json` thay vì config thật `~/.claude.json` → mất toàn bộ MCP server.
  `accountEnv()` xoá biến cho account mặc định, `ecosystem.config.js` cũng theo quy tắc này.
- **Thư mục phiên dùng chung qua symlink**: `acct1` giữ file thật ở `~/.claude/projects/<cwd-mã-hoá>/`,
  `acct2`/`acct3` chỉ là symlink. Dựng/bù bằng `./scripts/share-projects.sh` (dry-run mặc định, `go`
  để chạy; chạy một lần cho MỖI account phụ: `CLAUDE_ALT_DIR=~/.claude-account2 ./scripts/share-projects.sh go`
  — mặc định `CLAUDE_ALT_DIR` là `~/.claude-account3`; mỗi cwd mới cần chạy lại 1 lần).
  **Không bao giờ symlink `.credentials.json`.**
- **Console `/chat`, `/release`, `/evidence`, `/kloc`, `/translate` và `/investigate` tự đổi account** khi account đang
  dùng hết quota, giữ nguyên phiên, in 1 dòng thông báo. Logic ở `ui-next/lib/accountSwitch.js`;
  fail-open (không rõ quota → giữ account cũ). Console job còn lại (`/auto`, `/feature`, `/rebase`,
  `/report`) vẫn dùng account của pm2. Chi tiết: `ui-next/README.md` §Nhiều account Claude, `README.md` §9.
