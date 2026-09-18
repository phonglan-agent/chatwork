// Claude CLI plumbing for route handlers: per-project chat prompts/tools, argv builders,
// stream-json → SSE pump. Ported from ui/server.js (chat flow). Node runtime only.
import { spawn } from "child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveProject, normalizeProject, ROOT } from "./config.js";

// Absolute path to the screenshot helper (ui-next/scripts/snapshot.mjs). The chat agent runs in a
// sibling repo's cwd, so it needs the full path to invoke the script via Bash.
const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts");
const SNAPSHOT_SCRIPT = path.join(SCRIPTS_DIR, "snapshot.mjs");
// Debug helper (ui-next/scripts/debug.mjs) — console log + network + flow click/type qua CDP.
const DEBUG_SCRIPT = path.join(SCRIPTS_DIR, "debug.mjs");

// Instruction (edit-mode only) telling the agent to screenshot the running app when the user asks to
// "check on web / xem giao diện", save it under public/, and embed it in the answer as Markdown so it
// renders inline in the chat. `defaultUrl` is the project's fixed dev port; the agent overrides the
// path/route as needed.
function snapshotInstr(defaultUrl) {
  return (
    "CHỤP MÀN HÌNH WEB: khi người dùng yêu cầu KIỂM TRA GIAO DIỆN / xem thử trên web / 'check trên web' " +
    "sau khi sửa code — app chạy ở cổng cố định" +
    (defaultUrl ? ` (mặc định ${defaultUrl})` : "") +
    "; nếu chưa chạy thì start rồi chờ nó sẵn sàng. Chụp bằng lệnh Bash:\n" +
    `  node ${SNAPSHOT_SCRIPT} <url> --label <ten-ngan>\n` +
    "BẮT BUỘC KHOANH ĐỎ ITEM đang nói tới cho dễ phân biệt (cờ --mark, lặp lại được, selector là CSS):\n" +
    `  • 1 item  → chỉ khoanh đỏ, KHÔNG cần note:  --mark "<css-selector>"\n` +
    `  • nhiều item → khoanh đỏ + note tiếng Việt cạnh mỗi item (script tự đánh số):\n` +
    `      --mark "<selector-1>::<ghi chú tiếng Việt>" --mark "<selector-2>::<ghi chú tiếng Việt>"\n` +
    "  Chọn selector ổn định (id, data-*, class đặc trưng). Nếu script báo 'chỉ khoanh được x/y item' " +
    "thì selector sai — sửa lại rồi chụp lần nữa.\n" +
    "Lệnh in ra đường dẫn ảnh ở dòng cuối stdout (vd `/api/snapshot/xxx.png`). Hãy chèn NGUYÊN " +
    "đường dẫn đó vào câu trả lời dưới dạng ảnh Markdown `![mô tả](<đường dẫn vừa in>)` — KHÔNG tự " +
    "thêm/bớt tiền tố, script đã tự ghép basePath nếu có — để ảnh " +
    "hiển thị ngay trong khung chat. Chỉ chụp khi được yêu cầu kiểm tra giao diện — không tự chụp sau mỗi lần sửa."
  );
}

// Instruction (edit-mode only): lỗi RUNTIME của trang (trang trắng, bấm không phản ứng, request lỗi,
// state sai) không đọc code mà đoán được — debug.mjs chạy trang thật qua CDP và trả về console log,
// network, exception, kết quả eval. `defaultUrl` là cổng dev cố định của project ("" = mode free).
function debugInstr(defaultUrl) {
  return (
    "DEBUG TRANG WEB (console + network): khi lỗi xảy ra LÚC CHẠY — trang trắng, bấm không phản ứng, " +
    "request 4xx/5xx, cần biết log/exception hoặc state thật của trang — ĐỪNG chỉ đọc code rồi đoán, hãy chạy:\n" +
    `  node ${DEBUG_SCRIPT} <url> --label <ten-ngan> [--filter '<regex url>'] [--eval '<js đọc state>']\n` +
    (defaultUrl
      ? `App chạy ở cổng cố định (mặc định ${defaultUrl}); nếu chưa chạy thì start rồi chờ sẵn sàng.\n`
      : "Debug chính UI ai-agent này: truyền đường dẫn tương đối (vd `/chat`) kèm `--basic-auth auto` — " +
        "script tự ghép cổng + basePath và gửi Basic Auth; thiếu cờ đó thì Chrome dừng ở 401.\n") +
    "ĐĂNG NHẬP: app rezil (cổng 5173) có auth — gọi thẳng URL màn bên trong chỉ ra MÀN LOGIN, mọi log/" +
    "network thu được sẽ là của màn login. Luôn thêm `--login rezil --profile rezil`: script tự đăng nhập " +
    "(credential đọc từ file env, không lộ trên command line) và giữ session cho các lần sau; đã có session " +
    "thì tự bỏ qua. Trang khác cần login tay (GitHub, Jira…): `--profile <ten> --profile-login` một lần, " +
    "hoặc `--profile ci` cho GitHub repo private.\n" +
    "Người dùng nói 'check console.log' → thêm --all-logs (mặc định báo cáo chỉ in error/warning).\n" +
    "Đi qua flow bằng --step (lặp lại được, chạy tuần tự): 'waitfor:<css>' · 'click:<css>' · " +
    "'type:<css>::<text>' · 'key:Enter' (kèm modifier: 'key:Shift+Enter') · 'wait:<ms>' · 'goto:<url>' · " +
    "'shot:<nhãn>'. Thêm --body '<regex url>' để lấy response body, --json để ghi báo cáo đầy đủ ra file.\n" +
    "Script in báo cáo gọn (step OK/FAIL, console error/warning, uncaught exception, bảng network, kết quả " +
    "eval) — hãy dựa vào ĐÓ để kết luận, và tóm tắt lại dòng lỗi thật cho người dùng thay vì dán cả báo cáo. " +
    "Toàn bộ tuỳ chọn ghi ở đầu file script."
  );
}

// Hard guardrails shared by every edit-capable flow.
export const DISALLOWED_TOOLS = [
  "NotebookEdit",
  "AskUserQuestion",
  // `gh pr merge` (merging a PR) stays HARD-BLOCKED — CLAUDE.md rule #1 "Never merge PRs".
  "Bash(gh pr merge:*)",
  // `git merge` (LOCAL branch integration) is ALLOWED: hoà develop vào nhánh feature là thao tác dev
  // hợp lệ, reversible (`git merge --abort`), và là đường ưu tiên hơn rebase cho nhánh diverge nhiều
  // (xem agent git-rebaser). Nó KHÁC `gh pr merge` (ship PR) vẫn cấm ở trên. Push/force-push đi kèm
  // vẫn bị system prompt phanh (không force-push develop/main).
  // Force-push is allowed on your own branch (feature/fix, release/*) + tags. Prefix matching can't
  // tell the target branch from the pattern, so raw `--force`/`-f` is NOT hard-blocked here — the
  // system prompt is the brake forbidding force-push of `develop`/`main`.
];

// Branch/push guardrail shared by EVERY edit-capable flow (auto REZIL/feature + chat).
// Root cause it prevents: a new branch has no upstream, so a bare `git push` can resolve to the base
// branch (push.default=upstream/tracking, or HEAD still sitting on develop) → commit lands on develop.
// Fix = branch BEFORE editing, verify HEAD before commit, and always push with `-u origin HEAD`.
export const GIT_BRANCH_SAFETY = [
  "## GIT — BRANCH & PUSH (bắt buộc, ưu tiên cao)",
  "1. TẠO BRANCH TRƯỚC KHI SỬA FILE: sync base xong thì `git switch -c <branch>` ngay. Tuyệt đối",
  "   KHÔNG sửa/commit khi HEAD còn ở base (`develop`/`main`).",
  "2. TRƯỚC MỖI `git commit`: chạy `git branch --show-current` và xác nhận KHÁC base. Nếu đang ở base",
  "   → tạo branch rồi mới commit.",
  "3. PUSH LẦN ĐẦU BẮT BUỘC SET UPSTREAM: `git push -u origin HEAD`. TUYỆT ĐỐI KHÔNG chạy `git push`",
  "   trống hay `git push origin` — branch mới chưa có upstream, git có thể đẩy nhầm sang base.",
  "4. SAU KHI PUSH: kiểm tra `git rev-parse --abbrev-ref --symbolic-full-name @{u}` phải trả về",
  "   `origin/<branch>` (KHÔNG phải `origin/develop`). Sai → dừng và báo, không push tiếp.",
  "5. LỠ COMMIT TRÊN BASE (chưa push): `git switch -c <branch>` để mang commit sang nhánh mới, rồi",
  "   `git branch -f <base> origin/<base>` trả base về đúng remote. KHÔNG dùng `git reset --hard`.",
  "6. LỠ PUSH LÊN BASE: DỪNG NGAY, báo lại cho người dùng. KHÔNG tự revert/force-push `develop`/`main`.",
].join("\n");

// Worktree cho console /chat ở chế độ sửa code (yêu cầu 2026-09-03): cây làm việc chính hay đang bận
// (thay đổi chưa commit, đang ở nhánh của việc khác, hoặc console /auto,/feature,/rebase đang dùng),
// `git switch` lúc đó là đè lên việc đang dở. Cho phép agent tự tạo worktree riêng để làm.
// Đường dẫn BẮT BUỘC nằm trong repo: chat chỉ truy cập được các thư mục truyền qua --add-dir
// (xem buildChatArgv), worktree đặt ngoài đó thì Read/Edit bị chặn.
export const WORKTREE_INSTR = [
  "## GIT WORKTREE — ĐƯỢC TỰ TẠO KHI SỬA CODE (không bắt buộc)",
  "1. Cần sửa code mà cây làm việc chính đang bận (còn thay đổi chưa commit, đang ở nhánh của việc",
  "   khác, hoặc job console khác có thể đang dùng) → ĐƯỢC tạo worktree riêng thay vì `git switch`",
  "   trên repo chính: từ gốc repo chạy `git fetch origin <base>` rồi",
  "   `git worktree add .worktrees/<branch-slug> -b <branch> origin/<base>`, sau đó làm việc trong đó.",
  "   Cây làm việc chính sạch và đang ở base thì cứ tạo branch bình thường, không cần worktree.",
  "2. Worktree PHẢI nằm TRONG repo, tại `<repo>/.worktrees/<branch-slug>`. Đặt ngoài repo thì bạn",
  "   không đọc/ghi được (chỉ các thư mục được cấp qua --add-dir mới truy cập được).",
  "3. `.worktrees/` chưa được ignore thì thêm dòng `.worktrees/` vào `.git/info/exclude` (chỉ có tác",
  "   dụng local, không commit). KHÔNG sửa `.gitignore` của repo cho việc này.",
  "4. Trong worktree vẫn áp dụng đầy đủ mục GIT — BRANCH & PUSH ở trên: không commit khi HEAD còn ở",
  "   base, push lần đầu `git push -u origin HEAD`.",
  "5. Báo đường dẫn worktree + tên nhánh cho người dùng ngay khi tạo. Xong việc (đã push/PR, hoặc bỏ)",
  "   thì `git worktree remove <path>`; nếu còn thay đổi chưa commit thì GIỮ LẠI và nói rõ, KHÔNG tự xoá.",
  "6. KHÔNG tạo worktree cho việc chỉ đọc, KHÔNG tạo 2 worktree cho cùng một nhánh (git sẽ từ chối).",
].join("\n");

// pm2 guardrail cho chính bộ ai-agent này. Console spawn `claude` nên agent là process CON của
// ai-agent-ui-next: gõ thẳng `pm2 restart ai-agent-ui-next` là pm2 giết cả cây process, lệnh restart
// chết giữa chừng và app không lên lại (đã dính 2026-08-26). Mọi restart phải đi qua script tự
// setsid ra session khác.
export const PM2_OPS_SAFETY = [
  "## PM2 CỦA CHÍNH BỘ AI-AGENT (chatwork/ui-next) — bắt buộc",
  "1. TUYỆT ĐỐI KHÔNG chạy trực tiếp `pm2 restart|stop|delete ai-agent-ui-next` (và `pm2 kill`,",
  "   `pm2 resurrect`). Bạn đang chạy BÊN TRONG process đó — pm2 giết cả cây process nên lệnh của bạn",
  "   bị SIGKILL giữa chừng, app không lên lại và mất luôn kênh điều khiển.",
  "2. Cần khởi động lại thì gọi: `~/IdeaProjects/chatwork/ui-next/scripts/pm2-restart.sh <app>`.",
  "   Script tự tách session (setsid), restart → verify → nếu chưa online thì delete + start lại từ",
  "   ecosystem, rồi báo kết quả qua Telegram. Nó trả về ngay; ĐỪNG chờ app online trong cùng lượt.",
  "3. Sửa code ui-next xong phải `npm run build` TRƯỚC khi restart (pm2 chạy `next start`, không HMR).",
  "4. `pm2 list|jlist|logs|describe` chỉ đọc — dùng thoải mái.",
  "5. Bot Telegram là app pm2 RIÊNG (`ai-agent-telegram`, telegram-bot.mjs) để nó sống sót khi",
  "   ai-agent-ui-next chết. Chỉ được có MỘT process poll token: đừng bật TELEGRAM_IN_PROCESS=1 khi",
  "   app đó đang chạy (Telegram trả 409 Conflict).",
].join("\n");

// Anti-degrade guardrail shared by EVERY code-changing flow (auto REZIL/feature, chat ở
// chế độ sửa code, rebase console, release console). Yêu cầu người dùng 2026-08-13: sửa code ở BẤT KỲ
// route nào cũng phải soát kỹ để không làm hỏng chức năng đang chạy đúng. Từng luật dưới đây lấy từ
// case đã dính, KHÔNG phải quy tắc chung chung — chi tiết trong AGENT_RULES.md §Chống degrade.
export const NO_DEGRADE_SAFETY = [
  "## CHỐNG DEGRADE — KHÔNG LÀM HỎNG CHỨC NĂNG ĐANG CHẠY ĐÚNG (bắt buộc, ưu tiên cao)",
  "1. XÁC ĐỊNH PHẠM VI ẢNH HƯỞNG TRƯỚC KHI SỬA: grep hết nơi dùng hàm/field/enum/component/query/index",
  "   sắp sửa. Nếu là code DÙNG CHUNG (util, shared component, repository, permission check, DTO,",
  "   migration) → nêu rõ các luồng khác đang gọi nó và ảnh hưởng dự kiến, RỒI mới sửa.",
  "2. SỬA THEO HƯỚNG CỘNG THÊM: thêm nhánh điều kiện cho case mới thay vì đổi hành vi mặc định. Giữ",
  "   nguyên signature, giá trị mặc định, kiểu trả về, tính nullable. Buộc đổi hợp đồng dùng chung thì",
  "   phải cập nhật HẾT caller trong cùng lần sửa, không để caller cũ chạy trên hợp đồng mới.",
  "3. KHÔNG XOÁ THỨ CHƯA HIỂU: `style=`/`class:`/attribute, guard `if`, normalize blank↔null, filter",
  "   soft-delete, `ORDER BY`, try-catch phần lớn là dấu vết của bug đã fix trước đó. Thấy có vẻ dư →",
  "   `git log -S '<đoạn code>'` / `git blame` xem commit nào thêm và vì sao; không tra được thì GIỮ LẠI.",
  "4. KHÔNG MỞ RỘNG SCOPE: không refactor/rename/format lại phần ngoài chỗ cần sửa (formatter chạy toàn",
  "   file là nguồn degrade khó thấy). Thấy code cần dọn → ghi nhận và đề xuất thay đổi riêng.",
  "5. ĐỌC LẠI TOÀN BỘ DIFF TRƯỚC KHI COMMIT: `git diff` từng hunk, MỖI dòng `-` phải là chủ ý. Có hunk",
  "   không giải thích được (editor/format/merge tự sinh) → hoàn nguyên đúng hunk đó rồi mới commit.",
  "6. BUILD/TEST PASS KHÔNG PHẢI BẰNG CHỨNG KHÔNG DEGRADE. Degrade dạng hiển thị, nhãn i18n, quyền, thứ",
  "   tự sort, cache đều pass compiler và typecheck. Đổi UI → verify trên DOM/màn hình thật; đổi",
  "   query/permission → chạy lại với ≥2 role và cả trường hợp dữ liệu rỗng; đổi API → kiểm caller cũ.",
  "7. REGRESSION TỐI THIỂU, báo kết quả khi kết luận hoàn thành: luồng vừa sửa + các luồng lân cận dùng",
  "   chung code đó (list/detail/create/update), dữ liệu rỗng hoặc null, bản ghi đã soft-delete, và",
  "   luồng history/audit nếu thay đổi chạm vào đường mutation.",
  "8. KHÔNG ĐỦ DỮ KIỆN để chắc là không degrade → DỪNG và báo rõ điểm chưa chắc (flow tự động: dùng khối",
  "   `⛔ NEED-INFO:`), KHÔNG đoán rồi sửa tiếp.",
  "Case đã dính, dùng làm mẫu để soi: resolve conflict lấy nguyên một bên làm mất `style=`/attribute,",
  "build vẫn pass (REZIL-2814, REZIL-3046) · re-apply code cũ thành vô hiệu vì component sinh selector",
  "không còn được render (REZIL-2669, REZIL-2335) · sửa `diffFields` + cascade category làm mất giá trị",
  "field phụ thuộc ở luồng khác (REZIL-2303) · thao tác chỉ upload/xoá file vẫn bump `updated_at`",
  "(REZIL-2128) · đổi query/permission ở endpoint list làm sai kết quả cho role khác (REZIL-2311,",
  "REZIL-2109, REZIL-2174) · service worker cache-first `version.json` gây admin 500 sau build (REZIL-2172).",
].join("\n");

// Claude session ids are UUIDs. Only forward a well-formed one to `--resume`; anything else
// (empty/junk) → "" so the run starts a fresh session instead of feeding garbage to the CLI.
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanSessionId(s) {
  const v = (s || "").trim();
  return SESSION_ID_RE.test(v) ? v : "";
}

// Shared tail instruction: end every turn with a machine-readable follow-up block the UI turns
// into clickable chips. Backend strips it from the visible answer (see feedText/flushSuggest).
const SUGGEST_INSTR =
  "Kết thúc MỖI lượt trả lời bằng khối gợi ý tiếp theo, định dạng CHÍNH XÁC: một dòng `<<<SUGGEST>>>` " +
  "rồi 2–3 dòng, mỗi dòng `- <gợi ý ngắn người dùng có thể bấm để hỏi/làm tiếp>`. Bám ngữ cảnh vừa trao " +
  "đổi, viết tiếng Việt, ngắn gọn. TUYỆT ĐỐI không viết gì sau khối này.";

// Văn phong dùng chung cho MỌI flow: người dùng phản hồi (2026-08-09) là các câu chữ giật gân kiểu
// "bảng đau nhất" nghe lạ, không chuyên nghiệp. Nhãn/tiêu đề phải mô tả đúng dữ liệu, không cảm thán.
export const WORDING_INSTR = [
  "VĂN PHONG — TỪ NGỮ TRUNG TÍNH (bắt buộc): viết như kỹ sư báo cáo. 5 nhóm CẤM:",
  "1. Ẩn dụ/giật gân: \"đau nhất\", \"toang\", \"chết\", \"vỡ\", \"khủng (khiếp)\", \"cực gắt\", \"bùng nổ\",",
  "   \"báo động đỏ\", \"điểm nóng\", \"thảm hoạ\", \"đỉnh\", \"cân hết\", \"ăn hành\", \"cháy máy\".",
  "2. Ghép từ sượng/dịch máy: \"đắt xấp xỉ\", \"nhanh xấp xỉ\", \"rẻ bất thường\" (viết \"giá gần bằng…\",",
  "   \"xấp xỉ <số>\", \"nhanh bất thường\"); \"một cách nhanh chóng\", \"điều này có nghĩa là\", \"hãy cùng",
  "   đi sâu vào\", \"bức tranh toàn cảnh\", \"con số biết nói\".",
  "3. Phóng đại/marketing: \"hoàn hảo\", \"xuất sắc\", \"vượt trội\", \"đột phá\", \"siêu nhanh\", \"cực kỳ\",",
  "   \"ấn tượng\" → thay bằng SỐ ĐO cụ thể.",
  "4. Filler AI/cảm thán: \"Tuyệt vời!\", \"Chính xác!\", \"Câu hỏi hay\", \"Hy vọng điều này giúp ích\",",
  "   emoji ăn mừng (🎉✨🚀) — vào thẳng nội dung.",
  "5. Văn nói/teencode: \"tụi mình\" (→ \"chúng tôi\"), \"mấy file/mấy chỗ\" (→ \"các …\"), \"ngon lành\",",
  "   \"xịn\", \"hơi bị\", \"ok luôn\", \"code chuối\".",
  "Cặp thay thế đã chốt: bảng đau nhất → bảng chịu tải nặng nhất · chỗ vỡ → điểm nghẽn · cắn mạnh nhất →",
  "ảnh hưởng mạnh nhất · không ăn thua → không có tác dụng · row mồ côi → row trỏ tới bản ghi không tồn",
  "tại · quy tắc ngón tay cái → quy tắc ước lượng nhanh · bé tí → rất nhỏ.",
  "Tiêu đề bảng / nhãn cột / tên mục = danh từ mô tả ĐÚNG dữ liệu (\"Ticket quá hạn lâu nhất\", \"Màn hình",
  "nhiều lỗi nhất\"), không cảm thán, không emoji trang trí. Giữ tiếng Anh cho thuật ngữ chuẩn ngành",
  "(`filesort`, `covering index`, `optimizer`, tên lệnh/branch/commit); KHÔNG chèn tiếng Anh lửng giữa",
  "câu tiếng Việt (\"shape\" → \"dạng câu query\", \"driver table\" → \"bảng dẫn\").",
].join("\n");

// UI renders câu trả lời dạng Markdown (GFM) — nhắc model dùng bảng khi dữ liệu có cấu trúc.
const TABLE_INSTR =
  "Khi trình bày dữ liệu có cấu trúc (so sánh, danh sách ticket/field, bước + kết quả, tham số...), " +
  "HÃY dùng BẢNG Markdown (GFM: `| Cột | Cột |` + dòng `|---|---|`) cho dễ nhìn thay vì liệt kê dài. " +
  "Giữ bảng gọn, tiêu đề cột ngắn. Văn xuôi/giải thích thì viết bình thường, không cần bảng.";

// REZIL team templates live in the ai-agent repo (ROOT), NOT in rezil-esms where chat's cwd sits.
// Chat gets ROOT via --add-dir (see buildChatArgv) so the agent can Read these on demand; this line
// tells it where they are + when to use them. Auto/feature flows inline the same files (lib/auto.js).
function rezilTemplatesInstr() {
  return (
    "TEMPLATE TEAM: khi được yêu cầu TẠO PR / COMMIT / COMMENT JIRA / VIẾT MIGRATION, PHẢI theo đúng " +
    "khuôn mẫu team đặt tại repo ai-agent (đọc bằng đường dẫn tuyệt đối vì nằm ngoài cwd):\n" +
    `  • PR body      → ${ROOT}/templates/pr_template.md\n` +
    `  • Commit msg   → ${ROOT}/templates/commit_message.md\n` +
    `  • Jira comment → ${ROOT}/templates/jira_comment.md\n` +
    `  • Migration    → ${ROOT}/templates/migration.md\n` +
    `  • Quy trình    → ${ROOT}/prompts/{fix_bug,create_pr,update_jira,transition_assign,review_pr}.md\n` +
    "Hãy Read đúng file cần dùng RỒI chỉ điền placeholder — GIỮ NGUYÊN cấu trúc template, không tự chế khuôn khác."
  );
}

function chatSystemPrompt(project, canEdit) {
  if (project === "free") {
    // Unrestricted, all-projects mode. cwd = workspace root (~/IdeaProjects) with every repo in scope.
    return [
      "Bạn là trợ lý kỹ thuật TOÀN NĂNG, làm việc trên MỌI project trong thư mục làm việc (~/IdeaProjects) — rezil-esms và bất kỳ repo nào khác nằm trong đó.",
      "Mỗi repo có CLAUDE.md / .claude/agents / .mcp.json riêng — khi thao tác trong repo nào thì tuân theo quy ước của repo đó.",
      "Bạn được TOÀN QUYỀN: đọc + sửa/tạo/xoá file (Read/Edit/Write), chạy mọi lệnh (Bash), git, gọi Agent và mọi tool/MCP có sẵn. KHÔNG có hạn chế nào.",
      "Vì không có rào chắn, hãy cẩn trọng với thao tác phá huỷ (xoá, force-push, reset, drop DB) — chỉ làm khi yêu cầu rõ ràng. Sau khi thay đổi, giải thích ngắn gọn đã làm gì.",
      "Trả lời TIẾNG VIỆT, gọn, đúng trọng tâm. Tên branch/commit/PR/code giữ tiếng Anh theo convention của từng repo.",
      GIT_BRANCH_SAFETY,
      WORKTREE_INSTR,
      NO_DEGRADE_SAFETY,
      PM2_OPS_SAFETY,
      snapshotInstr(""),
      debugInstr(""),
      TABLE_INSTR,
      WORDING_INSTR,
      SUGGEST_INSTR,
    ].join("\n");
  }
  // rezil
  const base = ["Bạn là trợ lý kỹ thuật cho dự án rezil-esms. Trả lời bằng TIẾNG VIỆT, ngắn gọn, đúng trọng tâm."];
  if (canEdit) {
    base.push(
      "Chế độ SỬA CODE đang BẬT: bạn có thể đọc và CHỈNH SỬA file (Edit/Write) cùng chạy lệnh read-only/build/test (Bash) theo yêu cầu.",
      "Sau khi sửa, giải thích ngắn gọn những gì đã thay đổi.",
      "GIỚI HẠN: KHÔNG merge PR, KHÔNG deploy, KHÔNG force-push `develop`/`main` (force-push nhánh của mình được nếu cần). Tên branch/commit/PR/code giữ tiếng Anh theo convention.",
      GIT_BRANCH_SAFETY,
      WORKTREE_INSTR,
      NO_DEGRADE_SAFETY,
      snapshotInstr("http://localhost:5173"),
      debugInstr("http://localhost:5173"),
      rezilTemplatesInstr()
    );
  } else {
    base.push(
      "Bạn CÓ THỂ đọc code (Read/Grep/Glob), tra Jira và tìm web để trả lời.",
      "Bạn KHÔNG được sửa/tạo/xoá file, không chạy lệnh shell, không git. Đây là chế độ hỏi-đáp.",
      rezilTemplatesInstr()
    );
  }
  base.push(TABLE_INSTR);
  base.push(WORDING_INSTR);
  base.push(SUGGEST_INSTR);
  return base.join("\n");
}

function chatTools(project, canEdit) {
  const ro = [
    "Read", "Grep", "Glob", "WebSearch", "WebFetch",
    "mcp__atlassian__getJiraIssue",
    "mcp__atlassian__searchJiraIssuesUsingJql",
    "mcp__atlassian__fetch",
    "mcp__mysql_207__mysql_query",
    "mcp__gsheets-rezil",
  ];
  const allow = canEdit ? [...ro, "Edit", "Write", "Bash"] : ro;
  const disallow = canEdit ? DISALLOWED_TOOLS : ["Edit", "Write", "NotebookEdit", "Bash", "AskUserQuestion"];
  return { allow, disallow };
}

// Speed knobs for CHAT only (auto/feature/release/report flows keep the account defaults — they are
// long multi-step jobs where thinking budget pays off). Without these, chat inherits settings.json
// `model: opus[1m]` + the account's default effort, so a one-line question runs like a heavy task.
//   • read-only (hỏi-đáp)  → sonnet + effort low: trả lời nhanh, không sửa gì nên rủi ro thấp.
//   • edit mode / free     → giữ model mặc định (opus), chỉ hạ effort xuống medium.
function chatSpeedFlags(canEdit) {
  return canEdit
    ? ["--effort", "medium"]
    : ["--model", "sonnet", "--effort", "low"];
}

export function buildChatArgv(project, message, sessionId, canEdit, addDirs) {
  // "free" = unrestricted mode: bypass permissions entirely, no allowed/disallowed tool filters.
  // canEdit is irrelevant here — this mode is always fully capable across every project.
  if (project === "free") {
    return [
      "-p", message,
      "--permission-mode", "bypassPermissions",
      ...chatSpeedFlags(true),
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--append-system-prompt", chatSystemPrompt(project, true),
      ...addDirs.flatMap((d) => ["--add-dir", d]),
      ...(sessionId ? ["--resume", sessionId] : []),
    ];
  }
  const { allow, disallow } = chatTools(project, canEdit);
  // rezil chat runs with cwd inside rezil-esms; the team templates/prompts live in this repo (ROOT),
  // outside cwd. Expose ROOT so the agent can Read them (referenced in rezilTemplatesInstr()).
  const dirs = project === "rezil" ? [...addDirs, ROOT] : addDirs;
  return [
    "-p", message,
    ...(canEdit ? ["--permission-mode", "auto"] : []),
    ...chatSpeedFlags(canEdit),
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--append-system-prompt", chatSystemPrompt(project, canEdit),
    ...dirs.flatMap((d) => ["--add-dir", d]),
    "--allowedTools", ...allow,
    "--disallowedTools", ...disallow,
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}

// Follow-up suggestions: the model ends its answer with a `<<<SUGGEST>>>` block. We strip it from
// the visible text mid-stream and emit it as a `suggest` event for the UI to render as chips.
const SUGGEST_MARK = "<<<SUGGEST>>>";

// Stream-safe filter over assistant text: emits visible text via `delta`, but once the marker
// appears everything after it is stashed in state.suggestRaw. Holds back only a tail that could be
// the start of the marker, so a marker split across deltas never leaks to the screen.
function feedText(state, text, emit) {
  if (!text) return;
  if (state.suggesting) { state.suggestRaw += text; return; }
  state.pending = (state.pending || "") + text;
  const idx = state.pending.indexOf(SUGGEST_MARK);
  if (idx >= 0) {
    const before = state.pending.slice(0, idx);
    if (before) emit("delta", before);
    state.suggesting = true;
    state.suggestRaw = state.pending.slice(idx + SUGGEST_MARK.length);
    state.pending = "";
    return;
  }
  let keep = 0;
  const max = Math.min(state.pending.length, SUGGEST_MARK.length - 1);
  for (let k = max; k > 0; k--) {
    if (state.pending.slice(-k) === SUGGEST_MARK.slice(0, k)) { keep = k; break; }
  }
  const safe = keep ? state.pending.slice(0, -keep) : state.pending;
  if (safe) emit("delta", safe);
  state.pending = keep ? state.pending.slice(-keep) : "";
}

// Phần text sau marker → danh sách gợi ý. Dùng cả cho stream (flushSuggest) và cho lúc dựng lại
// phiên từ .jsonl (readSession ở lib/sessions.js) — hai đường phải cho ra CÙNG danh sách chip.
export function parseSuggestItems(raw) {
  return String(raw || "")
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 4);
}

// Called once at stream end: flush held-back text, then parse + emit the suggestion list.
export function flushSuggest(state, emit) {
  if (state.pending) { emit("delta", state.pending); state.pending = ""; }
  if (!state.suggesting) return;
  const items = parseSuggestItems(state.suggestRaw);
  state.suggesting = false;
  state.suggestRaw = "";
  if (items.length) emit("suggest", items);
}

// Turn one claude stream-json event into SSE emits via `emit(event, data)`.
export function handleEvent(evt, emit, state) {
  if (!evt || typeof evt !== "object") return;
  switch (evt.type) {
    case "system":
      if (evt.subtype === "init") emit("tool", "phiên bắt đầu");
      // Sub-agent (Agent/Task tool) lifecycle. The CLI does NOT stream a sub-agent's internal
      // turns at top level — only these system events + the final tool_result — so without this
      // the screen freezes for the whole sub-agent run with no feedback.
      else if (evt.subtype === "task_started")
        emit("tool", "↳ agent: " + (evt.description || evt.subagent_type || "đang chạy"));
      break;
    case "stream_event": {
      const e = evt.event || {};
      if (e.type === "message_start" && e.message && e.message.id) {
        state.curMsg = e.message.id;
      } else if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta") {
        if (state.curMsg) state.streamed.add(state.curMsg);
        feedText(state, e.delta.text, emit);
      } else if (e.type === "content_block_start" && e.content_block && e.content_block.type === "tool_use") {
        emit("tool", e.content_block.name || "tool");
      }
      break;
    }
    case "assistant": {
      const msg = evt.message || {};
      const sub = !!evt.parent_tool_use_id;
      const alreadyStreamed = msg.id && state.streamed.has(msg.id);
      for (const b of msg.content || []) {
        if (b.type === "tool_use") emit("tool", (sub ? "↳ " : "") + (b.name || "tool"));
        else if (b.type === "text" && b.text && !alreadyStreamed) feedText(state, b.text, emit);
      }
      break;
    }
    case "user": {
      // A sub-agent's output comes back as a tool_result on a user message. `tool_use_result`
      // carries `agentType` ONLY for Agent-tool results (regular Read/Bash/etc. results don't),
      // so this guard surfaces the agent's reply without dumping ordinary tool output into chat.
      const r = evt.tool_use_result;
      if (state.hideSubagentText) break; // console tự tổng hợp — xem hideSubagentText ở claudeSSE
      if (r && r.agentType && Array.isArray(r.content)) {
        const txt = r.content
          .filter((c) => c && c.type === "text")
          .map((c) => c.text)
          .join("\n")
          .trim();
        if (txt) emit("delta", "\n\n🤖 " + r.agentType + ":\n" + txt + "\n");
      }
      break;
    }
    // Hạn mức: CLI phát event riêng NGAY khi server chặn/cảnh báo, kèm rateLimitType + status.
    // Đây là tín hiệu đáng tin nhất để biết account đã cạn (text lỗi thì mỗi bản CLI viết một kiểu),
    // nên chuyển thẳng lên caller — chat dùng nó để đổi account (app/api/chat/route.js).
    case "rate_limit_event":
      emit("rate_limit", evt.rate_limit_info || {});
      break;
    case "result":
      // apiErrorStatus/resultText đi kèm để caller nhận diện 429 theo CẤU TRÚC, không phải bắt chuỗi.
      emit("result", {
        subtype: evt.subtype,
        isError: !!evt.is_error,
        apiErrorStatus: evt.api_error_status,
        resultText: evt.result != null ? String(evt.result) : "",
      });
      if (evt.is_error && evt.result) emit("error_msg", String(evt.result));
      break;
    default:
      break;
  }
}

// Build a text/event-stream ReadableStream that spawns claude and pumps events.
// onSession: emit a `session` event on first session_id (chat multi-turn).
// onSpawn(child): called right after spawn (e.g. register in a job-lock map).
// onClose(code, child): called exactly once on any terminal path (spawn failure, error, or
//   normal exit) before the stream ends — callers can rely on it to release a job-lock.
// onEvent(event, data): observes EVERY emitted SSE event (delta/session/tool/result/end/...),
//   including ones sent after the client has disconnected (chat's killOnDisconnect:false runs keep
//   going in the background) — lets a caller accumulate the final answer/status for e.g. a Telegram
//   completion notification without touching the SSE plumbing itself.
// timeoutMs: hard cap on run duration; a hung/runaway claude is SIGTERM'd (then SIGKILL) so it
//   can't hold a per-repo lock forever. Omit/0 = no cap (e.g. interactive chat).
// killOnDisconnect: when the HTTP consumer goes away (client tab hidden/minimized → socket dropped),
//   the ReadableStream is cancelled. Default true → kill the child (jobs: an abandoned run is waste).
//   Chat passes false → the run KEEPS GOING to completion and is saved to the session .jsonl, so a
//   reconnecting client can reload the finished answer instead of seeing a frozen half-message.
// hideSubagentText: bỏ qua phần text mà một sub-agent trả về (mặc định là ĐỔ ra chat để người dùng
// thấy nó làm gì). Console nào TỰ TỔNG HỢP lại kết quả sub-agent (vd /investigate gộp thành bảng)
// phải bật cờ này — nếu không, output thô của sub-agent hiện ngay trước phần tổng hợp, vừa trùng
// lặp vừa dính vào nội dung phía sau.
// env: env cho tiến trình claude. Bỏ trống = process.env (mọi flow cũ giữ nguyên account của pm2).
//   Chat truyền env của account khác khi account đang dùng hết quota — xem lib/config.js accountEnv().
// notice: 1 dòng thông báo hiện ngay đầu lượt (dùng event error_msg vì UI đã render sẵn), vd
//   "acct1 hết quota — đã chuyển sang acct3".
// retry({ code, spawns }): hook CHẠY LẠI NGAY TRONG CÙNG LƯỢT khi tiến trình claude vừa chết. Trả
//   `{ env, notice }` là spawn lại y nguyên argv bằng env mới (event `end` chưa phát, client không
//   thấy lượt bị hỏng); trả null/undefined là kết thúc như bình thường. Dùng cho lỗi thuộc về
//   ACCOUNT (org tắt Claude Code, hết hạn mức) — không có nó thì lượt đầu tiên gặp lỗi luôn hỏng và
//   người dùng phải gửi lại. Caller tự quyết khi nào đáng retry (xem app/api/chat/route.js).
//   Tối đa MAX_SPAWNS lần spawn cho mỗi lượt để không lặp vô hạn.
// Trần thời gian 1 lệnh Bash của agent. CLI mặc định chặn ở 600000ms (10 phút) — job của console
// (build gradle, test suite, upload cả batch lên Drive) hay vượt mức đó và chết giữa lệnh, mất luôn
// phần việc đang làm. Nâng trần lên 1200000ms (20 phút); mức mặc định mỗi lệnh vẫn là 120s, agent
// muốn lâu hơn thì tự truyền timeout. Đặt trong .env (BASH_MAX_TIMEOUT_MS) thì giá trị đó thắng.
const BASH_MAX_TIMEOUT_MS = "1200000";
function agentEnv(base) {
  return base.BASH_MAX_TIMEOUT_MS ? base : { ...base, BASH_MAX_TIMEOUT_MS };
}

export function claudeSSE({ cwd, argv, env, notice, onSession, onSpawn, onClose, onEvent, timeoutMs, killOnDisconnect = true, hideSubagentText = false, retry }) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      // Once the client disconnects (or we close), enqueue() throws "Controller is already closed".
      // That fires from async stdout handlers → uncaughtException → can crash the worker. Guard every
      // write behind a closed flag + try/catch so a late emit is a no-op, never a crash.
      let streamClosed = false;
      const emit = (event, data) => {
        if (onEvent) { try { onEvent(event, data); } catch {} }
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { streamClosed = true; }
      };
      try { controller.enqueue(encoder.encode(":ok\n\n")); } catch { streamClosed = true; }
      if (notice) emit("error_msg", notice);

      let child;
      let closedCb = false;
      // Guarantee onClose runs once on every terminal path so the lock is always released.
      const doClose = (code) => {
        if (closedCb) return;
        closedCb = true;
        if (onClose) { try { onClose(code, child, emit); } catch {} }
      };

      const state = { streamed: new Set(), curMsg: null, hideSubagentText };
      let sentSession = false, finished = false, buf = "", spawns = 0;
      const hb = setInterval(() => {
        try { controller.enqueue(encoder.encode(":hb\n\n")); } catch {}
      }, 15000);

      let killTimer = null, killHard = null;
      if (timeoutMs && timeoutMs > 0) {
        killTimer = setTimeout(() => {
          emit("error_msg", `⏱️ Quá thời gian cho phép (${Math.round(timeoutMs / 60000)} phút) — đang dừng tiến trình.`);
          try { child.kill("SIGTERM"); } catch {}
          killHard = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} }, 5000);
        }, timeoutMs);
      }
      // Hạn mức spawn cho MỘT lượt: lần đầu + tối đa 2 lần retry (số account trên máy là 3).
      const MAX_SPAWNS = 3;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(hb);
        if (killTimer) clearTimeout(killTimer);
        if (killHard) clearTimeout(killHard);
        flushSuggest(state, emit); // flush held-back text + emit any follow-up suggestions
        emit("end", {});
        try { controller.close(); } catch {}
        streamClosed = true;
      };

      // Tiến trình vừa chết: hỏi caller có chạy lại bằng env khác không (đổi account). Chạy lại thì
      // KHÔNG doClose/finish — cùng một stream, client chỉ thấy thêm 1 dòng thông báo.
      const onChildClose = async (code) => {
        if (retry && spawns < MAX_SPAWNS && !finished) {
          let next = null;
          try { next = await retry({ code, spawns }); } catch {}
          if (next) {
            // Lượt hỏng thường đã stream ra vài dòng text của CLI (vd "You've hit your session
            // limit · resets 6:10pm") — không xoá thì đáp án của lượt chạy lại bị NỐI ngay sau câu
            // đó, và Markdown mất format (bảng 5 cột của /investigate dính thành 1 dòng).
            emit("reset_text", {});
            if (next.notice) emit("error_msg", next.notice);
            // Reset trạng thái parse của lượt cũ; lượt mới bắt đầu từ đầu.
            buf = "";
            state.streamed.clear();
            state.curMsg = null;
            state.pending = "";
            state.suggesting = false;
            state.suggestRaw = "";
            // Cho phép phát lại event `session`: lượt hỏng có thể đã tạo session id ở account cũ;
            // client phải nhận id THẬT của lượt chạy được, nếu không lượt sau resume nhầm phiên rỗng.
            sentSession = false;
            if (launch(next.env)) return;
          }
        }
        doClose(code);
        finish();
      };

      // Spawn claude bằng env cho trước. true = spawn được, false = hỏng (đã báo lỗi + kết thúc).
      const launch = (runEnv) => {
        spawns++;
        try {
          child = spawn("claude", argv, { cwd, env: agentEnv(runEnv || process.env), stdio: ["ignore", "pipe", "pipe"] });
        } catch (e) {
          emit("error_msg", "Failed to launch claude: " + e.message);
          doClose(null);
          finish();
          return false;
        }
        if (onSpawn) { try { onSpawn(child); } catch {} }
        this._child = child;

        child.stdout.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          let nl;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line); } catch { continue; }
            if (!sentSession && evt.session_id && onSession) { sentSession = true; emit("session", evt.session_id); }
            handleEvent(evt, emit, state);
          }
        });
        child.stderr.on("data", (d) => emit("error_msg", d.toString("utf8")));
        child.on("error", (e) => {
          emit("error_msg", "claude error: " + e.message + (e.code === "ENOENT" ? " (is `claude` on PATH?)" : ""));
          doClose(null);
          finish();
        });
        child.on("close", (code) => { onChildClose(code); });
        return true;
      };

      launch(env);
    },
    cancel() {
      // Client disconnected. Kill only if the run is bound to the connection (jobs). Chat runs
      // (killOnDisconnect:false) survive so they finish + persist to the session .jsonl; the Dừng
      // button still stops them explicitly via /api/cancel (job-lock keyed by runId).
      if (killOnDisconnect && this._child && this._child.exitCode === null) this._child.kill("SIGTERM");
    },
  });
}

export { resolveProject, normalizeProject };
