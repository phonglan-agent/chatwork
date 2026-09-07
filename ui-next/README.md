# ui-next — Next.js UI

UI chính thức của AI agent (Next.js App Router + React + Tailwind). Đã thay thế hoàn toàn `ui/server.js` cũ (đã xoá). Sau gateway phục vụ ở prefix **`/ai`** (port **5000** qua pm2), Basic Auth qua `.env`.

**Console:** Auto REZIL Fix-Bug (ticket→PR) · **Feature** (BD+Figma → 16-phase → PR) · Auto/Chat **Story** (task→PR develop) · Auto/Chat **Film** (AI Film Studio, task→PR develop) · **Release** (drive github-ops: deploy DEV1/PR/tag) · **Rebase/Merge** (drive git-rebaser) · **Report** (Jira report read-only qua REST CLI) · **Sprint giờ âm** (burndown Expect vs Actual) · Chat REZIL + Chat **Toàn năng** (free, bypass) · `/usage` · Cancel · Basic Auth · `/healthz`.

**Kênh phụ:** Telegram bot (long-polling) chạy ở **pm2 app riêng** `ai-agent-telegram` (`telegram-bot.mjs`) — dùng lại y hệt plumbing chat của web (`buildChatArgv`/`handleEvent`) nên prompt & guardrail giống nhau, nhưng KHÔNG chết theo mỗi lần app Next restart. Có lệnh cứu hộ `/status` `/restart` `/logs` chạy thẳng pm2 (xem §Bot Telegram & cứu hộ pm2).

## Style

- **Tailwind CSS v4** (CSS-first config trong `app/globals.css` qua `@theme inline`).
- **Font**: UI dùng `--font-sans` (system-ui/Segoe UI/Roboto…) — KHÔNG dùng monospace cho text vì font mono đặt sai dấu chồng tiếng Việt (ư/ơ + thanh). `--font-mono` chỉ để dành cho code.
- **Dark mode**: class-based (`<html class="dark">`), toggle 🌙/☀️ lưu `localStorage`, mặc định tối, no-FOUC script trong `layout.jsx`. Token màu đổi theo `:root` / `.dark`.
- **Responsive**: mọi trang là console full-height (header + log + composer); home grid 1→2 cột.

## Chạy

```bash
npm install          # lần đầu
npm run dev          # dev (hot reload) — http://127.0.0.1:7000  (-p 7000 hardcode, KHÔNG đọc PORT)
npm run build        # build production (bake NEXT_PUBLIC_BASE_PATH=/ai)
npm run start        # chạy bản build — cũng -p 7000

# qua pm2 (ecosystem.config.js nằm ngay trong ui-next/) — chỉ chạy Next app, KHÔNG ngrok.
# pm2 đọc PORT từ .env (mặc định 5000), gateway route /ai → PORT này:
# ecosystem có 2 app: ai-agent-ui-next (Next) + ai-agent-telegram (bot, tiến trình riêng)
npm run build && pm2 start ecosystem.config.js --update-env   # cả 2 app
pm2 restart ecosystem.config.js --update-env                  # sau khi build lại

# ⚠️ ĐỪNG gọi thẳng `pm2 restart ai-agent-ui-next` từ trong console/agent (nó là process con của
# app → bị giết giữa chừng). Dùng script tự tách session:
./scripts/pm2-restart.sh ai-agent-ui-next
./scripts/pm2-restart.sh ai-agent-ui-next --fresh   # vừa sửa .env → delete + start để nạp lại
```

> ⚠️ `npm run dev`/`start` dùng `-p 7000` hardcode trong `package.json` và **BỎ QUA** `PORT` trong `.env`.
> Chỉ pm2 (ecosystem) mới đọc `PORT` (5000). Production thực tế = **pm2 → port 5000**.

Basic Auth: đặt `UI_BASIC_AUTH="user:pass"` trong `ui-next/.env` (rỗng = không auth, chỉ loopback).

## Expose ra ngoài (ngrok)

App này **không tự chạy ngrok**. Việc đó do **gateway dùng chung** lo: [`~/IdeaProjects/gateway`](../../gateway/CADDY.md)
(1 Caddy + 1 ngrok cho nhiều app, 1 domain). chatwork được route ở prefix **`/ai`** (port 5000).

- `NEXT_PUBLIC_BASE_PATH=/ai` trong `.env` — **BAKED lúc `next build`** (đổi là phải build lại). Next tự
  prefix Link/asset/API route; `EventSource`/`fetch` được prefix thủ công trong `AgentConsole` qua `BASE`.
- Cài Caddy + chạy gateway + cách thêm app mới: xem **[gateway/CADDY.md](../../gateway/CADDY.md)** và
  **[CADDY.md](../CADDY.md)** (repo này).

Truy cập: `https://<domain>/ai`.

## Cấu trúc

```
app/
  layout.jsx            # root layout + globals.css + no-FOUC theme script
  ThemeToggle.jsx       # client: toggle dark/light (localStorage)
  page.jsx              # home: card tới mọi console (Auto/Điều tra/Feature/Release/Rebase/Report/KLOC/Sprint/Chat…)
  globals.css           # Tailwind v4 + theme tokens (light/dark)
  _components/AgentConsole.jsx # client: console DÙNG CHUNG cho mọi trang. mode "chat" (chat/release/
                               #   rebase/report) + mode "job" (auto/feature/story/film: composer +
                               #   result/NEED-INFO/cancel). Upload file, snapshot, âm báo khi xong.
  chat/     page.jsx → Chat.jsx        # chat project-aware (rezil/story/film/free) + toggle ✏️ Sửa code
  auto/     page.jsx → Auto.jsx        # job: ticket REZIL + repo → /api/run
  feature/  page.jsx → Feature.jsx     # job: ticket + repo + BD/Figma → /api/feature-run
  story/    page.jsx → StoryAuto.jsx   # job: task free-form → /api/story-run
  film/     page.jsx → FilmAuto.jsx    # job: task AI Film Studio → /api/film-run
  release/  page.jsx → Release.jsx     # chat: drive github-ops (deploy/PR/tag) → /api/release
  rebase/   page.jsx → Rebase.jsx      # chat: drive git-rebaser (rebase/merge/force-push) → /api/rebase
  report/   page.jsx → Report.jsx      # chat: Jira report read-only (JQL→REST CLI) → /api/report
  investigate/ page.jsx → Investigate.jsx # chat: điều tra ticket read-only (nguyên nhân gốc + đánh giá
                                       #   DEV/SQA + phương án khắc phục) → /api/investigate
  evidence/ page.jsx → Evidence.jsx    # chat: chụp/gán evidence TC lên Google Sheet SQA (spec
                                       #   SCREEN_EVIDENCE.md cạnh màn — rule, nhúng vào prompt;
                                       #   EVIDENCE_REFERENCE.md = phần tra cứu, agent sed khi cần;
                                       #   SELECTORS_<SCREEN>.md = bản đồ selector) → /api/evidence
  kloc/     page.jsx → Kloc.jsx        # chat: đọc PR merge 4 repo rezil → append LoC/KLoC vào Google
                                       #   Sheet KLoC-MVP2 (spec KLOC_SPEC.md cạnh màn, nhúng vào
                                       #   prompt lúc chạy) → /api/kloc
  sprint/   page.jsx                   # tool: upload xlsx burndown → giờ âm (Expect vs Actual)
  api/
    chat/route.js         # SSE chat (project-aware, slash-commands)
    run/route.js          # SSE auto REZIL (ticket → PR), job-lock per repo
    feature-run/route.js  # SSE auto Feature (BD+Figma → 16-phase → PR), job-lock per repo
    story-run/route.js    # SSE auto Story (task → PR develop), job-lock "story"
    film-run/route.js     # SSE auto Film (task → PR develop), job-lock "film"
    release/route.js      # SSE release (drive github-ops, multi-turn resume, no lock)
    rebase/route.js       # SSE rebase (drive git-rebaser, multi-turn resume)
    report/route.js       # SSE report (Jira read-only chat, multi-turn resume)
    investigate/route.js  # SSE điều tra ticket (read-only: Jira + code + git log + SELECT QA)
    evidence/route.js     # SSE evidence (đọc-ghi sheet SQA + rclone Drive, multi-turn resume)
    kloc/route.js         # SSE KLOC (gh đọc PR → ghi tab KLoC-MVP2, multi-turn resume)
    sprint/route.js       # POST xlsx → JSON giờ âm (dùng lib/sprint.js)
    v1/generate/route.js  # API CHO BÊN THỨ BA: POST/GET prompt → text (hộp kín, API key riêng,
                          #   hạn mức/phút-ngày, tuỳ chọn stream SSE) — xem §API cho bên thứ ba
    sessions/route.js     # list/đọc/xoá phiên Claude CLI (.jsonl) theo project + console
    snapshot/[name]/route.js # serve runtime asset (ảnh snapshot web) — Next16 không serve public/ sau build
    cancel/route.js       # POST hủy job đang chạy
    healthz/route.js      # health check
proxy.js                # HTTP Basic Auth (UI_BASIC_AUTH) — Next "proxy" convention; /api/v1 được
                        #   miễn (nó tự gác bằng API key riêng)
instrumentation.js      # boot hook; chỉ start bot in-process khi TELEGRAM_IN_PROCESS=1 (mặc định: không)
telegram-bot.mjs        # entry của pm2 app `ai-agent-telegram` — bot chạy tiến trình riêng
scripts/pm2-restart.sh  # restart pm2 an toàn từ bên trong chính app (setsid + bậc thang tự chữa)
lib/
  config.js             # đọc ../config/*.json; resolveRepo / resolveProject
  claude.js             # chat prompt/tools per project, claudeSSE pump (onSpawn/onClose/timeout)
  auto.js               # auto REZIL prompt/tools (ticket → minimal fix → PR)
  featureAuto.js        # auto Feature prompt/tools (16-phase BD+Figma → Scala/Svelte → PR)
  storyAuto.js          # auto Story prompt/tools (task → PR develop)
  filmAuto.js           # auto Film prompt/tools (task → PR develop; repo không có MCP/agents)
  release.js            # release prompt/argv (--agent github-ops, bypassPermissions, merge allowed)
  rebase.js             # rebase prompt/argv (--agent git-rebaser, multi-turn confirm-before-write)
  report.js             # report prompt/argv (Jira JQL → REST CLI, read-only, không dùng MCP)
  investigate.js        # điều tra ticket: prompt/argv read-only + CAUSE_OPTIONS (bảng phân loại
                        #   nguyên nhân cố định của team) — không Edit/Write, không git ghi, không ghi Jira
                        #   Ngoại lệ ghi duy nhất: DEGRADE_SHEET (sheet Degrade Investigation Ticket).
                        #   Nhãn nguyên nhân ra `Degrade` → lượt kết luận CHỈ gợi ý "Lập sheet degrade
                        #   cho REZIL-XXXX"; user xác nhận mới copy tab `Template V1` thành tab
                        #   REZIL-XXXX rồi điền Q&A (hàng 13–23) + Summary (B27) + Solution (từ 34)
  evidence.js           # evidence prompt/argv: nhúng nguyên văn spec app/evidence/SCREEN_EVIDENCE.md
                        #   lúc chạy — ghi cột M/N của sheet + upload Drive; không Edit/Write, không git
                        #   + tiết kiệm token: --setting-sources '' kèm mcp config rút gọn (.ai-agent/
                        #   mcp-evidence.json) và planSession() cắt phiên khi context vượt EVIDENCE_MAX_CTX
  kloc.js               # KLOC prompt/argv: nhúng nguyên văn spec app/kloc/KLOC_SPEC.md lúc chạy —
                        #   `gh`/`git` chỉ ĐỌC, chỉ ghi tab KLoC-MVP2 (append), không Edit/Write
  jira.js               # Jira Cloud REST client server-side (report console dùng thay MCP)
  sprint.js             # burndown "giờ âm" — nguồn chung cho web + skill sprint-negative-hours
  slashCommands.js      # slash-command dùng chung (/usage…) — short-circuit trước khi spawn claude
  sessions.js           # đọc phiên chat Claude CLI (.jsonl); gộp nhiều account, copy phiên giữa account
  accountSwitch.js      # chooseAccount(): chat tự đổi account Claude khi account đang dùng hết quota
  upload.js             # lưu file upload vào .ai-uploads/ trong cwd (chat/report Read được)
  telegram.js           # Telegram long-polling bot (kênh chat thứ 2, dùng lại plumbing lib/claude.js)
                        #   + lệnh vận hành /status /restart /logs chạy THẲNG pm2, không qua agent
  notifySound.js        # beep Web Audio khi run xong/lỗi (AgentConsole)
  limits.js             # live rate-limit /usage (Anthropic OAuth) + quota theo từng account
  usage.js              # buildUsageReport() — offline ~/.claude/projects parse
  jobs.js               # running Map (job-lock) + cancel
  publicApi.js          # API bên thứ ba: xác thực API key, hạn mức, argv hộp kín (không tool/MCP/
                        #   settings, cwd thư mục tạm rỗng), chạy 1 lượt + bản stream SSE
ecosystem.config.js     # pm2: ai-agent-ui-next (chỉ Next app; ngrok do ~/IdeaProjects/gateway lo)
scripts/
  snapshot.mjs          # chụp screenshot 1 trang (kèm --mark khoanh đỏ) → .snapshots/
  debug.mjs             # debug 1 trang qua CDP: console/network/exception + flow click-type + ảnh
  jira-search.mjs       # tra Jira bằng JQL từ CLI (không cần MCP)
  shot-check.mjs        # kiểm ảnh evidence KHÔNG nạp ảnh vào context: tự decode PNG (zlib), đếm
                        #   pixel khoanh đỏ → 1 dòng/ảnh (OK/NO-RED/BLANK + cờ WEAK/EDGE/FULL-VIEWPORT)
  mobile-e2e/           # kịch bản e2e app mobile
```

## Debug trang web qua CDP — `scripts/debug.mjs`

Chạy 1 trang trong Chrome headless rồi in BÁO CÁO gọn: console log/warning/error, uncaught exception,
bảng network (status/ms/TTFB/size, kèm response body nếu cần), kết quả `--eval`, ảnh chụp. Dùng khi cần
biết *trang đang làm gì* — trang trắng, request 4xx/5xx, log lỗi, state sai — chứ chỉ cần ảnh thì dùng
`snapshot.mjs`. Không cần npm dep (CDP qua WebSocket có sẵn trong Node ≥ 21); đầy đủ tuỳ chọn ở đầu file.

```bash
# app CÓ ĐĂNG NHẬP (rezil-esms-mobile): --login tự đăng nhập, --profile giữ session cho lần sau
npm run debug -- http://localhost:5173/inspection/list --login rezil --profile rezil --all-logs

# đường dẫn tương đối = chính UI này: tự ghép PORT + NEXT_PUBLIC_BASE_PATH trong .env,
# --basic-auth auto lấy UI_BASIC_AUTH (không có header thì Chrome dừng ở 401)
npm run debug -- /chat --label chat --basic-auth auto --filter 'api/'

# đi qua flow: chờ selector → nhập → gửi → chờ → soi request + state
npm run debug -- /chat --basic-auth auto \
  --step 'waitfor:textarea' --step 'type:textarea::ping' --step 'key:Enter' --step 'wait:8000' \
  --filter 'api/(chat|cancel)' --body 'api/chat' --eval 'document.querySelectorAll(".md").length'

# app khác, credential để trong file env (không lộ trên command line), chụp giữa flow
npm run debug -- http://localhost:5173/ --env ~/.../rezil-esms-test.env \
  --step 'type:input[name=email]::{{EMAIL}}' --step 'click:button[type=submit]' \
  --step 'waitfor:.home' --step 'shot:sau-login' --json
```

Đăng nhập & profile (phần hay dùng nhất):

| Cần gì | Cờ |
|---|---|
| App có auth, đã có preset (rezil-esms-mobile) | `--login rezil` — tự nhập credential từ file env, submit, chờ rời màn login rồi quay lại đúng URL đã truyền; đang có session thì tự bỏ qua |
| Giữ session giữa các lần chạy | `--profile <ten>` → `ui-next/.chrome-profiles/<ten>` (git-ignored). Không có cờ này thì Chrome tạo profile tạm, mỗi lần chạy là session trắng |
| Trang chưa có preset (GitHub, Jira…) | `--profile <ten> --profile-login` mở cửa sổ Chrome thật để login tay một lần; đóng cửa sổ là script chạy tiếp headless |
| Trang GitHub repo private | `--profile ci` — dùng luôn profile đã login của `scripts/capture-ci-evidence.sh` |
| Chạy nhiều lệnh liên tiếp trên **cùng một màn** | `--keep <ten>` — xem "Chrome keep-alive" bên dưới |

Không login thì gọi thẳng URL màn bên trong chỉ trả về **màn login**, và mọi thứ thu được (console,
network, ảnh) là của màn login — script in cảnh báo rõ khi `--login` thất bại thay vì báo cáo im lặng.

Ghi chú khi dùng lại:

- `--all-logs` in mọi dòng console; mặc định chỉ in error/warning. Cần "check console.log" thì bật cờ này.
- Profile đang bị một Chrome khác chiếm (`SingletonLock`) thì script tự chạy trên **bản chụp** profile
  (cookie + Local State + Local Storage) và ghi rõ "session mới KHÔNG được lưu" — cùng cách xử lý với
  `scripts/capture-ci-evidence.sh`.
- Script đóng Chrome bằng `Browser.close` trước khi kill: `localStorage`/IndexedDB chỉ được ghi xuống
  đĩa khi Chrome tự tắt, kill thẳng là mất session vừa login.

- **Step DSL**: `wait` · `waitfor` · `click` · `type:<sel>::<text>` · `key:<phím>` (kèm modifier:
  `Shift+Enter`, `Ctrl+a`) · `scroll` · `goto` · `eval` · `shot`. Step lỗi thì dừng flow nhưng vẫn in
  báo cáo phần đã thu.
- `type:` **thay** toàn bộ nội dung ô (select-all rồi `Input.insertText`, nên input controlled của
  React/Svelte nhận được thay đổi); muốn nối thêm thì dùng `key:End` + `type` trên selector khác hoặc `eval`.
- `--attach <port>` để dùng Chrome đang mở (`--remote-debugging-port=<port>`) khi cần session đã login sẵn.
- **Chrome keep-alive — `--keep <ten>`**: giữ Chrome sống sau khi lệnh xong, lệnh sau cùng `--keep <ten>`
  attach lại đúng cửa sổ đó. Trang đang mở cùng origin thì **không** load lại nên giữ nguyên trạng thái
  (popup đang mở, form đã điền, biến `window.*` đã inject) và bỏ luôn `--wait` + bước kiểm login. Đo trên
  web mobile env 207 ngày 2026-08-26: lệnh mở 5,9s → lệnh attach **0,8s**. Dùng khi chụp một cụm ảnh trên
  cùng một màn (`/evidence`); đóng bằng `node scripts/debug.mjs --keep-stop <ten>` (`Browser.close` nên
  session vẫn được lưu vào `--profile`). Cần về màn đầu thì thêm `--renav`. Lockfile `{port,pid}` nằm ở
  `.chrome-profiles/.keep-<ten>.json`; **quên `--keep-stop` là còn một Chrome headless treo chiếm profile**
  — lần chạy sau với cùng `--profile` mà không có `--keep` sẽ rơi vào nhánh "bản chụp profile".
  `--login/--profile/--chrome-flag` chỉ có tác dụng ở lệnh MỞ; `--width/--height/--geo` là override theo
  phiên CDP nên phải truyền lại mỗi lệnh.
- Ảnh lưu ở `.snapshots/` (git-ignored, giữ 60 file mới nhất) và in ra dạng `/ai/api/snapshot/<file>.png`
  — dán nguyên đường dẫn đó vào chat là ảnh hiện inline.
- Credential từ `--env` / `--basic-auth` được che (`***`) trong mọi dòng báo cáo.

## /evidence — giữ chi phí token thấp

Một batch evidence tốn token theo công thức **số lượt gọi tool × context hiện có**, mà context được
nạp lại toàn bộ ở mỗi lượt và chỉ tăng dần trong một phiên. Đo trên phiên thật ngày 2026-08-26
(transcript `5f3656a6`, MOB-011 TC 507–549): 129 lượt · context 49k → 152k · **~11,5M token**.

Bốn chốt chặn đang áp (2026-08-27):

| Chốt | Ở đâu | Cắt được |
|---|---|---|
| Bỏ settings khỏi context (`--setting-sources ''`), tự nạp lại 2 MCP server cần dùng qua `--strict-mcp-config --mcp-config .ai-agent/mcp-evidence.json` + `--model` | `lib/evidence.js` `buildEvidenceArgv` | 36,7k → 23,3k token nền mỗi lượt |
| Spec tách đôi: `SCREEN_EVIDENCE.md` giữ rule (nhúng nguyên văn), `EVIDENCE_REFERENCE.md` giữ số đếm/ví dụ/snippet (agent `sed` khi cần) | `app/evidence/` | 12,6k → 8,8k token prompt |
| Không `Read` file ảnh; kiểm bằng `scripts/shot-check.mjs` (tự decode PNG, đếm pixel đỏ, trả 1 dòng/ảnh) | spec §4 + prompt | ~2,5k token/ảnh, và ảnh không nằm lại trong context |
| Cắt phiên theo batch: context vượt `EVIDENCE_MAX_CTX` thì mở phiên mới, chèn lại dòng `<<<STATE>>>` của lượt trước làm bối cảnh | `planSession()` + `app/api/evidence/route.js` | giữ context phẳng ~30k thay vì bò lên 152k |

Ghi chú vận hành:

- `--setting-sources ''` **bỏ luôn MCP server khai trong `~/.claude.json`** (verify 2026-08-27: agent
  trả `NO_MCP`) và cả `model` trong settings. Vì vậy hai thứ đó phải truyền lại tường minh; không
  sinh được file mcp rút gọn thì `buildEvidenceArgv` tự quay về hành vi cũ (nạp đủ settings).
- File `.ai-agent/mcp-evidence.json` sinh lại mỗi lượt từ config của account đang chạy, chmod 600,
  nằm trong thư mục đã git-ignore — **không** commit, không chép credential vào repo.
- `EVIDENCE_MAX_CTX=0` tắt hẳn việc cắt phiên. Muốn giữ một phiên dài để hỏi lại lịch sử batch thì
  đặt 0, đổi lại chấp nhận giá token.
- `shot-check.mjs` chạy độc lập: `node ui-next/scripts/shot-check.mjs <file|thư mục>` — verdict
  `OK`/`NO-RED`/`BLANK`/`UNREADABLE` kèm cờ `WEAK`/`EDGE`/`FULL-VIEWPORT`, exit 1 nếu có ảnh chưa đạt.

## /kloc — thống kê KLoC từ PR

Console `/kloc` đọc Pull Request đã merge của 4 repo rezil bằng `gh` CLI rồi **append** vào Google
Sheet `REZIL - KLoc` (`1UkianWTMWCpZaZgBQSC9DJnJqNfE8gwmTTEjQUE369A`), tab `KLoC-MVP2`
(`gid=2011708823`, header dòng 2, dữ liệu từ dòng 3, 13 cột `A..M`).

Quy tắc nằm trong `app/kloc/KLOC_SPEC.md` — spec được ĐỌC LÚC CHẠY và nhúng nguyên văn vào system
prompt (giống `/evidence`), nên sửa spec là đổi hành vi ngay lượt sau, **không cần build/restart**.
Rút gọn:

- `LoC (New)` = `additions` của PR, `LoC (Modified)` = `deletions`, `LoC (Sum)` = cộng hai cột.
- PR title team có dạng `[<tag>] <FEATURE-ID> | <tên việc>` → cột `Feature ID` / `Feature Name` /
  `Sprint` (tag normalize theo tab `Metadata`, vd `PreUAT-MVP2-B` → `PreUAT - MVP2-B`).
- `PIC` map từ `author.login` (bảng trong spec §5). Login lạ → để trống + báo, không tự suy tên.
- `Log Date`/`Last Update` = ngày `mergedAt` (Asia/Saigon); `STT = số dòng − 2`.
- `AI Usage (%)` lấy từ mục `## AI Usage` trong PR description (neo theo heading rồi lấy số đầu —
  grep `%` trên cả body là sai, dòng checklist có `100%`). PR không có mục đó → để trống.
- Chống ghi trùng theo URL PR ở cột E; chỉ APPEND, không sửa/xoá dòng cũ, không đụng tab
  `Overview - MVP2` (tab đó tổng hợp bằng `SUMIF` trên CẢ cột nên dòng mới tự cộng).
- `gh`/`git` chỉ ĐỌC; `Write`/`Edit`/`Agent` bị chặn ở tool — màn này không sửa file repo.

Chạy thật 2026-08-27: ghi 5 PR còn thiếu (row 1627–1631) → quét PR merge 01/08–27/08 của 4 repo, ghi
thêm 4 PR còn thiếu (row 1632–1635) → điền bù 48 ô cột `AI Usage (%)` đang trống từ PR description
(151 dòng vẫn trống vì PR không có mục đó). Đối chiếu lại với `gh`: khớp toàn bộ.

## Bot Telegram & cứu hộ pm2

Bot **không** chạy chung tiến trình với Next nữa. Nó là pm2 app riêng `ai-agent-telegram`
(`telegram-bot.mjs` → `lib/telegram.js`), vì bot chính là kênh cứu hộ: chạy chung thì một lần
restart hỏng hay build lỗi là mất luôn đường ra lệnh "khởi động lại pm2".

| Vấn đề đã gặp (2026-08-26) | Cách xử lý hiện tại |
|---|---|
| Agent trong console gõ `pm2 restart ai-agent-ui-next` → pm2 giết cả cây process (agent là process con) → lệnh restart chết giữa chừng, app không lên lại | `scripts/pm2-restart.sh` tự `setsid` sang session mới nên sống sót; prompt guard `PM2_OPS_SAFETY` (lib/claude.js) cấm agent gọi pm2 trực tiếp |
| App chết → bot chết theo → không còn kênh nào ra lệnh | Bot ở pm2 app riêng, `autorestart` + `restart_delay: 5s`; app Next chết không ảnh hưởng |
| Không biết app đang sống hay chết | `/status` trong Telegram (đọc `pm2 jlist`) |

Lệnh trong Telegram — xử lý **trực tiếp bằng pm2 CLI, không qua `claude`**, nên vẫn dùng được khi
agent hỏng hoặc hết quota:

| Lệnh | Việc |
|---|---|
| `/status` | trạng thái + uptime + số lần restart của các app trong `TELEGRAM_PM2_APPS` |
| `/restart [app]` | gọi `scripts/pm2-restart.sh` (mặc định `ai-agent-ui-next`); kết quả báo ngược về đúng chat |
| `/logs [app] [n]` | `n` dòng log cuối (mặc định 40, tối đa 200) |

`scripts/pm2-restart.sh <app>` chạy bậc thang tự chữa: `pm2 restart --update-env` → chờ online →
chưa được thì `pm2 delete` + `pm2 start ecosystem.config.js --only <app>` → vẫn hỏng thì gửi Telegram
kèm 30 dòng log lỗi. Log đầy đủ ở `logs/pm2-restart.log`. Script tự tách session nên dùng được cả khi
app gọi nó chính là app bị restart (kể cả bot tự restart chính mình).

Hai điểm phải nhớ khi restart:

| Vừa sửa gì | Làm gì |
|---|---|
| `app/**`, `lib/**` (JS/JSX) | `npm run build` **rồi** `./scripts/pm2-restart.sh <app>` |
| `ui-next/.env` | `./scripts/pm2-restart.sh <app> **--fresh**` — `pm2 restart` KHÔNG nạp lại `.env`: `ecosystem.config.js` chỉ đọc file đó (qua dotenv) lúc `pm2 start`, nên `--fresh` bỏ qua bậc 1 và `delete` + `start` thẳng (kèm `pm2 save`) |
| Spec/tài liệu `.md` (`app/evidence/*.md`…) | không cần build, cũng không cần restart — đọc lúc chạy |

**Rò biến môi trường của phiên Claude Code** (đo 2026-08-26): `pm2` nhét env của **shell gọi lệnh**
vào app và đè cả phần `ecosystem.config.js` đã xoá — kể cả khi dùng `pm2 delete` + `pm2 start`. Gọi
pm2 tay từ trong một phiên Claude Code là app thừa hưởng `CLAUDE_CONFIG_DIR` / `CLAUDE_EFFORT` /
`CLAUDE_CODE_*` của phiên đó rồi truyền tiếp cho **mọi** `claude -p` nó spawn → agent chạy nhầm
account, effort bị đè. `scripts/pm2-restart.sh` đã tự xoá `CLAUDECODE|CLAUDE_*|AI_AGENT` trước khi
gọi pm2, nên **luôn restart qua script**. Kiểm nhanh sau restart — chỉ được còn `CLAUDE_ACCOUNT=`:

```bash
tr '\0' '\n' < /proc/$(pm2 jlist | jq -r '.[]|select(.name=="ai-agent-ui-next").pid')/environ | grep ^CLAUDE
```

Env liên quan (`ui-next/.env`):

| Biến | Ý nghĩa |
|---|---|
| `TELEGRAM_BOT_TOKEN` | thiếu là bot không chạy (app pm2 exit ngay) |
| `TELEGRAM_ALLOWED_CHAT_IDS` | allowlist; rỗng = bot chỉ trả về chat id để tự whitelist |
| `TELEGRAM_PM2_APPS` | app được phép /status /restart /logs (mặc định `ai-agent-ui-next,ai-agent-telegram`) |
| `TELEGRAM_IN_PROCESS` | `1` = chạy bot trong app Next như cũ (chỉ dùng cho `npm run dev`) |

> ⚠️ Chỉ được **một** process poll một token. Bật `TELEGRAM_IN_PROCESS=1` thì phải
> `pm2 stop ai-agent-telegram` trước, không thì Telegram trả 409 Conflict và cả hai đều nhận thiếu tin.

## API cho bên thứ ba — `/api/v1/generate`

Một đầu API để hệ thống NGOÀI gọi Claude sinh nội dung (viết bài, tóm tắt, dịch, đặt tiêu đề…).
Khách chỉ gửi prompt và nhận text; không có đường nào để họ đọc/ghi file, chạy lệnh hay thấy dữ liệu
nội bộ.

**Bật**: đặt `PUBLIC_API_KEYS` trong `ui-next/.env` rồi `./scripts/pm2-restart.sh ai-agent-ui-next --fresh`
(`pm2 restart` không nạp lại `.env`). Bỏ trống biến này = endpoint tắt, trả 503.

```bash
# sinh key cho từng khách
openssl rand -hex 24
# .env — định dạng "key:nhãn", nhãn dùng cho log và tính hạn mức
PUBLIC_API_KEYS=ab12…:khach-a,cd34…:khach-b
```

**Gọi**:

```bash
# 1 lượt, trả JSON
curl -X POST https://<domain>/ai/api/v1/generate \
  -H 'Authorization: Bearer <API_KEY>' -H 'Content-Type: application/json' \
  -d '{"prompt":"Viết bài viết 300 từ về con mèo","model":"sonnet"}'
# → {"ok":true,"text":"…","usage":{"input_tokens":…,"output_tokens":…,"duration_ms":…}}

# stream (SSE): event delta {text} … → done {usage} | error {error}
curl -N 'https://<domain>/ai/api/v1/generate?prompt=Vi%E1%BA%BFt+v%E1%BB%81+con+m%C3%A8o&stream=1' \
  -H 'Authorization: Bearer <API_KEY>'

# GET không kèm prompt → trả bản mô tả tham số + hạn mức đang áp
curl https://<domain>/ai/api/v1/generate -H 'Authorization: Bearer <API_KEY>'
```

Tham số: `prompt` (bắt buộc), `system` (chỉ dẫn thêm, được CỘNG vào system prompt nên ràng buộc an
toàn vẫn giữ), `model` (`haiku|sonnet|opus`, mặc định `PUBLIC_API_MODEL`), `effort`
(`low|medium|high`, mặc định `low`), `stream`.

### Vì sao phải là hộp kín

Prompt của bên thứ ba chạy qua CÙNG một CLI `claude` với các console nội bộ, nên nếu không bó lại thì
họ thừa hưởng nguyên bộ ngữ cảnh của máy này. `lib/publicApi.js` chặn từng đường:

| Ràng buộc | Cờ | Lý do |
|---|---|---|
| Không tool nào | `--tools ""` | không Read/Write/Bash → prompt không mở được file hay chạy lệnh |
| Không MCP | `--strict-mcp-config` | không với tới Jira, MySQL 207, Google Sheets |
| Bỏ settings user/project/local | `--setting-sources ""` | không nạp `~/.claude/settings.json`, không mang theo quy tắc nội bộ |
| Xin phép là từ chối | `--permission-prompts none` | không có ai trả lời prompt permission → phải deny, không được treo |
| Không lưu phiên | `--no-session-persistence` | request của khách không sinh transcript, không lẫn vào panel "Phiên đã lưu" |
| cwd = thư mục tạm RỖNG | `PUBLIC_API_SANDBOX_DIR` | `CLAUDE.md` nạp theo cwd; chạy trong repo là câu trả lời cho khách thừa hưởng context REZIL |

Xác thực KHÔNG dùng `UI_BASIC_AUTH`: key phát cho khách phải thu hồi được từng cái mà không đổi lối
vào UI, nên `proxy.js` miễn `/api/v1` khỏi Basic Auth và route tự kiểm API key.

### Hạn mức

Đếm theo NHÃN khách, trong RAM của tiến trình Next (app restart thì reset — đây là van an toàn quota
Claude, không phải billing): `PUBLIC_API_RATE_PER_MIN` (10), `PUBLIC_API_RATE_PER_DAY` (200),
`PUBLIC_API_MAX_CONCURRENT` (2), `PUBLIC_API_MAX_PROMPT` (8000 ký tự), `PUBLIC_API_TIMEOUT_MS`
(300000). Vượt → 429 kèm `Retry-After`; mỗi phản hồi có `X-RateLimit-Remaining-Minute/-Day`.

### Tự đổi account Claude

Hai lớp, áp cho CẢ gọi thường lẫn stream:

1. **Trước khi chạy** — `chooseAccount()` như các console khác: account của pm2 cạn quota, mất đăng
   nhập hoặc bị org chặn thì request chạy bằng account còn dư nhiều nhất. Endpoint stateless nên
   không phải copy transcript giữa account (bước tốn nhất của `/chat` ở đây không tồn tại).
2. **Giữa lượt** — lượt chết vì lỗi THUỘC ACCOUNT (429, org tắt Claude Code) được chạy lại bằng
   account khác trên cùng request/stream, tối đa 3 lần spawn. Khách chỉ thấy đáp án tới chậm hơn,
   không thấy lỗi. Account hỏng được đánh dấu vào cache quota (`markAccountExhausted/Blocked`) để
   request sau chọn thẳng account khác, khỏi diễn lại màn "chạy hỏng rồi mới đổi".

Với stream, điều kiện chạy lại là **chưa đẩy nội dung nào ra**: đẩy rồi mà chạy lại thì đáp án lượt
mới nối vào đuôi lượt hỏng, mà hợp đồng công khai không có event "xoá phần đã gửi" như `reset_text`
của console nội bộ. Vướng ở chỗ CLI in câu báo hết hạn mức ("You've hit your usage limit · resets
3pm") NHƯ text của assistant, tức nó tới đúng đường `delta` — gửi thẳng ra là mất luôn quyền chạy
lại ở đúng lượt cần nhất. Nên 200 ký tự đầu được giữ trong bộ đệm *probation* tới khi biết lượt lành
hay hỏng: hỏng thì bỏ cùng cả lượt, lành thì đẩy ra rồi stream bình thường. Cái giá là đáp án chậm
thêm đúng một nhịp đệm; hỏng GIỮA CHỪNG (đã qua nhịp đó) thì vẫn trả `event: error`, khách gọi lại.

## Nhiều account Claude — chat tự đổi khi hết quota

pm2 chạy app dưới MỘT account (`CLAUDE_ACCOUNT` trong `.env` → `ecosystem.config.js` set
`CLAUDE_CONFIG_DIR`; để trống = account mặc định và biến này phải UNSET). Khi account đó cạn hạn mức,
console `/chat`, `/release`, `/evidence`, `/kloc` và `/investigate` tự chạy lượt tiếp theo bằng account
còn quota, **vẫn trên cùng phiên**, và in 1 dòng đầu lượt:

```
⚠️ acct1 hết quota (còn 0%) — chuyển sang acct3 (còn 5%).
```

Cơ chế:

| Bước | Ở đâu |
|---|---|
| Khai báo account (dir + account mặc định) | `lib/config.js` → `ACCOUNTS`, `accountEnv`, `currentAccountKey` |
| Đọc quota còn lại từng account (cache 60s) | `lib/limits.js` → `accountUsage`, `surveyAccounts`, `pickAccountWithQuota` |
| Chọn account + đồng bộ transcript trước khi resume | `lib/accountSwitch.js` → `chooseAccount` |
| Spawn `claude` bằng account đã chọn | `lib/claude.js` → `claudeSSE({ env, notice })` |
| Đánh dấu account cạn khi run báo hết hạn mức | `app/api/{chat,release,evidence,kloc,investigate}/route.js` → `markAccountExhausted` |
| Đánh dấu account bị tổ chức chặn Claude Code | `app/api/{chat,release,evidence,kloc,investigate}/route.js` → `markAccountBlocked` (xem dưới) |
| Chạy lại NGAY trong lượt bằng account khác | `lib/claude.js` → `claudeSSE({ retry })` + `lib/accountSwitch.js` → `fallbackAccount` |

Phiên nằm ở `<CLAUDE_CONFIG_DIR>/projects/<cwd-mã-hoá>/<session-id>.jsonl`, nên account mới phải
thấy được file đó. Hai cách, dùng song song được:

- **Dùng chung qua symlink (khuyến nghị)** — `../scripts/share-projects.sh go`: account chính giữ file
  thật, account phụ là symlink. Không copy, không thể phân kỳ. Mỗi cwd mới cần chạy lại 1 lần. Chạy
  một lần cho MỖI account phụ — `CLAUDE_ALT_DIR` mặc định là `~/.claude-account3`:
  `CLAUDE_ALT_DIR=~/.claude-account2 ../scripts/share-projects.sh go`.
- **Copy tự động** — project chưa symlink thì `ensureSessionInAccount` copy bản mới nhất sang account
  sắp chạy (cả 2 chiều, kể cả khi account cũ reset quota và chạy tiếp ở đó).

Fail-open: không đọc được quota (token hết hạn, API lỗi) hoặc copy phiên thất bại → giữ account cũ
đúng như trước, chỉ kèm cảnh báo.

### Ngoài hết quota: 2 trường hợp cũng phải đổi account

Cả hai đều là NGOẠI LỆ của fail-open — giữ account cũ thì lượt nào cũng chết, nên đổi là lựa chọn duy
nhất còn chạy được:

1. **Mất đăng nhập** — access token hết hạn mà refresh token cũng mất/hết hạn (`unusableReason` trong
   `lib/limits.js`). CLI sẽ chết với "OAuth session expired and could not be refreshed". Xử lý:
   `CLAUDE_CONFIG_DIR=<dir> claude auth login`.
2. **Tổ chức tắt Claude subscription cho Claude Code** — run chết ngay với:

   ```
   ⚠ Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access
   ```

   Lỗi này KHÔNG tự hết sau vài giờ và API `/usage` vẫn trả quota bình thường, nên không đo ra được —
   chỉ bắt được bằng text (`BLOCKED_RE` trong `lib/accountSwitch.js`, khớp cả `result` lẫn stderr).
   Vì vậy nó được nhớ RIÊNG (`markAccountBlocked`), giữ suốt đời process (pm2 restart là hết) thay vì
   đi qua cache quota 60s — nếu coi là "hết quota" thì sau 60s account lại được chọn lại và lượt nào
   cũng chết. Account đã đánh dấu bị loại khỏi mọi lựa chọn sau đó; dòng cảnh báo ghi "bị tổ chức chặn
   Claude Code", và nếu không còn account nào khác thì nhắc nhờ admin bật lại / dùng Anthropic API key.

### Chạy lại ngay trong lượt (không mất lượt)

Hai lỗi trên chỉ lộ ra KHI RUN ĐÃ CHẾT, còn `chooseAccount` chạy trước đó — nếu chỉ đổi account cho
lượt sau thì lượt đang gửi luôn hỏng và người dùng phải gửi lại. Vì vậy `claudeSSE` nhận thêm hook
`retry`: tiến trình `claude` chết → hỏi caller có env khác để chạy lại không → có thì **spawn lại
nguyên argv trong CÙNG stream** (chưa phát `end`, client chỉ thấy thêm 1 dòng thông báo):

```
Your organization has disabled Claude subscription access for Claude Code · …
⚠️ acct1 bị tổ chức chặn Claude Code — chạy lại lượt này bằng acct2 (còn 97%).
4
```

Chi tiết đáng lưu ý:

- Tối đa 3 lần spawn cho mỗi lượt (`MAX_SPAWNS` trong `lib/claude.js`) — bằng số account trên máy.
- Chỉ chạy lại khi lượt **chưa trả ra nội dung thật** (`contentLen` trong route). CLI in dòng
  "Your organization has disabled…" như **text của assistant** (event `delta`, kèm
  `api_error_status: 403`), nên đoạn text khớp `BLOCKED_RE`/`LIMIT_RE` KHÔNG được tính là nội dung —
  tính cả nó thì đúng lượt cần chạy lại nhất lại bị chặn.
- `session` được phát lại cho lượt mới: lượt hỏng có thể đã tạo session id ở account cũ, client phải
  giữ id của lượt chạy được, nếu không lượt sau resume nhầm phiên rỗng.
- Console job (`/auto`, `/feature`, …) không truyền `retry` → hành vi y như trước.

Refresh token: token OAuth mỗi account chỉ được CLI làm mới khi có một lượt `claude` thật chạy dưới
account đó, nên account ít dùng hay bị quá hạn token. Quy tắc:

- **Account của pm2 còn quota** → pre-check không spawn `claude` (đỡ ~15s/lượt); account nào token quá
  hạn thì coi như "không kiểm tra được" và bỏ qua.
- **Account của pm2 đã cạn** → `surveyAccounts({ allowRefresh: true })` refresh token cho ứng viên quá
  hạn trước khi hỏi quota (`claude -p ok --model haiku`, ~15s/account, tối đa 60s rồi kill). Lượt đó
  đằng nào cũng hỏng nếu không đổi account, nên chờ vẫn hơn bỏ sót account còn dư.

Khi không đổi được, dòng cảnh báo nói rõ lý do từng account bị loại — phân biệt "hết quota" (chờ
reset) với "không kiểm tra được: token hết hạn / HTTP 401" (cần `CLAUDE_CONFIG_DIR=<dir> claude auth
login`):

```
⚠️ acct1 đã hết quota, không dùng được account nào khác (acct3 hết quota (còn 1%)) — lượt này vẫn chạy bằng acct1.
```

Giới hạn: áp cho `/chat`, `/release` và `/evidence` (cả ba đều đa lượt, resume theo phiên;
`/release` an toàn vì cả 3 account đều có agent `github-ops` và cùng bộ MCP server, `/evidence` vì
cả 3 account đều có `gsheets-rezil` + `mysql_207` và cùng đọc được spec `SCREEN_EVIDENCE.md`). Các
console job còn lại (`/auto`, `/feature`, `/rebase`, `/report`, `/investigate`) vẫn chạy bằng
account của pm2; `todos/` và
`file-history/` (`/rewind`) vẫn riêng theo account nên không mang theo khi đổi. Đổi account xảy ra ở
ĐẦU LƯỢT (`chooseAccount`, theo quota đo được) và ở lúc RUN VỪA CHẾT (`retry` → `fallbackAccount`,
theo lỗi thật của run). Lượt đã trả ra nội dung rồi mới cạn quota thì vẫn hỏng — lượt kế tiếp mới
nhảy account.

## Trạng thái: migration xong ✅

UI cũ `ui/server.js` đã xoá. Mọi tính năng đã port sang đây. Mở rộng tiếp:
chỉ thêm route/page mới + 1 entry trong `lib/config.js` (cho project mới).
