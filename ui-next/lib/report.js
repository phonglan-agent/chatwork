// Report console: a multi-turn CHAT that produces READ-ONLY Jira reports. The agent turns the user's
// free-form request into a JQL, fetches data via the LOCAL REST CLI (scripts/jira-search.mjs, which
// wraps lib/jira.js) — NOT the Atlassian MCP, whose fat responses blow past the token limit — then
// analyses / aggregates the compact JSON and answers. So: user chats → Claude builds JQL → we run
// jiraSearchAll → Claude analyses. Multi-turn via --resume so the user can refine across turns.
import { WORDING_INSTR } from "./claude.js";


// Phân vai member để gom nhóm trong block report Chatwork. Ai KHÔNG thuộc 3 list này → DEV.
// Tên KHỚP CHÍNH XÁC `assignee.displayName` trên Jira (gồm phần tiếng Nhật).
export const LIST_BSE = [
  "HTJ - AnhTT",
  "HTJ - BieuNV",
  "HTV - DatHM",
  "Nguyen Thuy Quynh（クイン）",
];
export const LIST_SQA = [
  "HTV - HoaNT",
  "HTV - HuyenNT",
  "HTV - YenLTB",
  "HTV - NgocTTB",
];
export const LIST_COMTOR = ["HTV - NamNP"];

// Env đang chạy: tên env → JQL lấy TOÀN BỘ ticket của env đó (JQL chứ không phải filter id trần, để
// env nào chưa có filter Jira thì dùng thẳng `parent = <epic>`).
// MVP2-B hiện CHỈ có một tập ticket: epic REZIL-2926 (ticket tag `[PreUAT-MVP2-B]` ở đầu summary),
// phủ bởi filter 10777 ("UAT - MVP2-B"). Hai tên env cùng trỏ filter 10777 → user gõ "PreUAT" hay
// "UAT" đều ra đúng data; khi Jira tách filter riêng cho UAT thì chỉ sửa 1 dòng ở đây.
export const REPORT_ENVS = {
  "PreUAT-MVP2-B": "filter=10777",
  "UAT-MVP2-B": "filter=10777",
};

// Đường dẫn CLI (tính từ cwd = ROOT của agent, tức repo root — xem app/api/report/route.js).
const CLI = "ui-next/scripts/jira-search.mjs";

// Read-only: chặn mọi tool ghi + chặn Atlassian MCP để ÉP agent lấy data qua CLI (không phình token).
// Bash vẫn mở (agent cần chạy CLI); Edit/Write/Agent tắt.
export const REPORT_DISALLOWED = [
  "Edit",
  "Write",
  "NotebookEdit",
  "AskUserQuestion",
  "Agent",
  // Ép dùng CLI, không cho fallback sang MCP (search MCP trả avatarUrls → vượt token limit).
  "mcp__atlassian__searchJiraIssuesUsingJql",
  "mcp__atlassian__getJiraIssue",
  "mcp__atlassian__getJiraIssueRemoteIssueLinks",
  "mcp__atlassian__fetch",
  "mcp__atlassian__search",
  // Mọi tool GHI Jira/Confluence (an toàn tuyệt đối cho màn report).
  "mcp__atlassian__addCommentToJiraIssue",
  "mcp__atlassian__editJiraIssue",
  "mcp__atlassian__transitionJiraIssue",
  "mcp__atlassian__addWorklogToJiraIssue",
  "mcp__atlassian__createJiraIssue",
  "mcp__atlassian__createIssueLink",
  "mcp__atlassian__createConfluencePage",
  "mcp__atlassian__updateConfluencePage",
  "mcp__atlassian__createConfluenceFooterComment",
  "mcp__atlassian__createConfluenceInlineComment",
];

// Mô tả roster gọn để nhúng vào system prompt (agent không tự biết ai vai gì).
function rosterPromptLines() {
  return [
    `- BSE: ${LIST_BSE.join(", ")}`,
    `- SQA: ${LIST_SQA.join(", ")}`,
    `- COMTOR (dịch): ${LIST_COMTOR.join(", ")}`,
    "- DEV: MỌI assignee KHÔNG nằm trong 3 nhóm trên (kể cả Unassigned).",
  ];
}

export function reportSystemPrompt(nowStamp) {
  const envLines = Object.entries(REPORT_ENVS).map(([name, jql]) => `- ${name} → JQL \`${jql}\``);
  return [
    "Bạn đang chạy trong Report Console của AI agent — phiên web UI, ĐA LƯỢT (multi-turn), CHỈ ĐỌC.",
    "Nhiệm vụ: người dùng gõ yêu cầu tự do bằng tiếng Việt → bạn (1) dựng JQL phù hợp, (2) LẤY DATA qua",
    "CLI bên dưới, (3) PHÂN TÍCH / THỐNG KÊ rồi trả lời gọn. Trả lời TIẾNG VIỆT.",
    "",
    "## LẤY DATA — DÙNG CLI, KHÔNG DÙNG MCP",
    `Chạy (tool Bash) từ thư mục hiện tại:`,
    `  node ${CLI} --jql "<JQL>" --fields "summary,status,assignee,issuetype,created"`,
    'CLI in ra JSON GỌN 1 dòng: {"jql","count","truncated","issues":[{key, <các field>}]} — field đã được',
    "làm phẳng (status/issuetype/priority → tên; assignee → displayName; bỏ avatarUrls). DÒNG STDOUT CUỐI",
    "CÙNG là JSON (bỏ qua mọi cảnh báo Node/dotenv phía trên). Chỉ cần đếm → thêm cờ `--count-only`",
    "(trả {jql,count}). LUÔN truyền `--fields` tối thiểu cần cho câu hỏi.",
    "TUYỆT ĐỐI KHÔNG gọi Atlassian MCP (đã bị chặn) — mọi truy vấn Jira đi qua CLI này.",
    "",
    "## JQL",
    `Project mặc định = REZIL. Mọi JQL mặc định nằm trong \`project = REZIL\` trừ khi người dùng nêu filter/JQL khác.`,
    "Env đã biết (người dùng nhắc tên env → dùng ĐÚNG JQL bên dưới, không tự dựng JQL khác):",
    ...envLines,
    `Hôm nay = ${nowStamp} (giờ địa phương). Dùng mốc này cho 'hôm nay'/'tuần này'/quá hạn; KHÔNG tự sinh ngày khác.`,
    "Nếu {truncated:true} (kết quả bị cắt ở --max) → hẹp JQL lại hoặc dùng --count-only để đếm chính xác.",
    "",
    "## CHỈ ĐỌC",
    "Không comment/transition/edit/tạo ticket-link/worklog, không sửa file, không git. CLI chỉ GET (search).",
    "Người dùng yêu cầu thao tác ghi → từ chối ngắn gọn, nhắc màn Report chỉ đọc.",
    "",
    "## PHÂN VAI MEMBER (để gom nhóm report)",
    "Dựa vào `assignee` (displayName, khớp CHÍNH XÁC) trong mỗi issue, phân mỗi người vào 1 nhóm:",
    ...rosterPromptLines(),
    "",
    "## REPORT TỔNG QUAN 1 ENV (mặc định khi người dùng xin 'report <env>')",
    "Cách làm gọn & CHÍNH XÁC: chạy CLI 1 lần với `--jql \"<JQL của env>\"` lấy toàn bộ issue (fields:",
    "summary,status,assignee,issuetype,created), rồi TỰ phân loại & đếm từ mảng issues:",
    "- N = count tổng.",
    "- closed/pending Z = số issue status ∈ {Closed, PENDING} (không phân biệt hoa/thường).",
    "- 'còn' = status ∉ {Closed, PENDING}. Gom 'còn' theo nhóm vai (DEV/SQA/BSE/COMTOR).",
    "- mới hôm nay X = số issue có `created` >= đầu ngày hôm nay.",
    "- Với MỖI nhóm, đếm thêm số 'còn' TÁCH THEO TỪNG STATUS (để ghi breakdown phía sau — xem dưới).",
    "KIỂM TRA BẮT BUỘC: (DEV còn)+(SQA còn)+(BSE còn)+(COMTOR còn) = N − Z. Lệch → rà lại phân loại,",
    "KHÔNG báo số sai. (Có thể chạy thêm --count-only để đối chiếu.) Tổng breakdown mỗi dòng = số 'còn' của nhóm đó.",
    "",
    "## NHÃN STATUS (để viết breakdown) — map status Jira → nhãn tiếng Việt gọn",
    "- To Do → chưa làm · In Progress → đang làm · In Review → đang review · Resolved → đã resolve",
    "- FEEDBACK → feedback · Reopened → mở lại. Status KHÁC không có trong bảng → giữ nguyên tên Jira.",
    "",
    "## OUTPUT MẶC ĐỊNH = BLOCK CHATWORK (để copy-paste) cho report tổng quan 1 env",
    "Trả về block sau, ĐẶT CẢ block trong khối ``` để copy nguyên văn (thẻ Chatwork [To:]/[info]/[title]/[hr]).",
    "MỖI dòng nhóm có breakdown theo status trong ngoặc, dạng `<count> <nhãn>`, nối bằng ` · `, theo thứ tự",
    "pipeline (chưa làm → đang làm → đang review → đã resolve → feedback), BỎ status có 0:",
    "```",
    "[To:6040320]Le Ngoc Chien",
    "Em gửi report <TÊN ENV> ngày <DD/MM> ạ",
    "[info][title]📊 Report <TÊN ENV> — <DD/MM>[/title]",
    "Tổng <N> ticket · <X> mới hôm nay · <Z> closed/pending",
    "[hr]",
    "🔧 DEV — còn <a> (<vd: 7 chưa làm · 6 đang làm · 2 feedback>)",
    "🧪 SQA — còn <b> (<breakdown status>)",
    "👔 BSE — còn <c> (<breakdown status; FEEDBACK ghi là 'feedback (cần confirm)'>)",
    "🌐 <tên COMTOR rút gọn, vd Nam> (dịch) — còn <d> (<breakdown status>)",
    "[/info]",
    "```",
    "Quy tắc: dòng `Tổng …` LUÔN ghi cả `mới hôm nay` và `closed/pending` (kể cả = 0). Nhóm có 0 ticket 'còn'",
    "→ bỏ dòng emoji đó. Breakdown chỉ liệt kê status > 0; nếu nhóm chỉ có 1 status thì vẫn ghi (vd `(3 đã resolve)`).",
    "KHÔNG bịa số — mọi count phải đếm từ data CLI.",
    "Người dùng có thể đổi env, đổi người nhận [To:], hoặc xin 'chi tiết' (bảng markdown từng ticket) — khi đó",
    "trả markdown thay vì block. Với câu hỏi ad-hoc (không phải report env) → trả lời tùy ngữ cảnh, nhưng khi dữ",
    "liệu CÓ CẤU TRÚC (danh sách ticket, thống kê theo người/status, so sánh...) ƯU TIÊN BẢNG Markdown (GFM:",
    "`| Cột | Cột |` + `|---|---|`) cho dễ nhìn — UI render markdown. Block Chatwork ở trên GIỮ NGUYÊN, không đổi.",
    "",
    WORDING_INSTR,
    "",
    "Kết thúc MỖI lượt bằng khối gợi ý, định dạng CHÍNH XÁC: một dòng `<<<SUGGEST>>>` rồi 2–3 dòng, mỗi dòng",
    "`- <gợi ý ngắn bấm để hỏi/báo cáo tiếp>` (vd đổi env, xem chi tiết nhóm DEV, đổi người nhận). Tiếng Việt,",
    "không viết gì sau khối này.",
  ].join("\n");
}

export function buildReportArgv(message, sessionId, nowStamp, addDirs) {
  return [
    "-p", message,
    "--permission-mode", "bypassPermissions",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--append-system-prompt", reportSystemPrompt(nowStamp),
    ...addDirs.flatMap((d) => ["--add-dir", d]),
    "--disallowedTools", ...REPORT_DISALLOWED,
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}
