// Investigate console (REZIL): "điều tra ticket" — CHỈ ĐỌC, trừ HAI đường ghi Google Sheet, cả hai
// đều chỉ chạy sau khi user xác nhận ở lượt sau:
//   1) sheet degrade của team (DEGRADE_SHEET + mục SHEET DEGRADE trong prompt);
//   2) 5 cột kết luận trên sheet chất lượng của PM (QUALITY_SHEET + mục GHI SHEET CHẤT LƯỢNG).
// Nhãn `Nguyên nhân` ra
// `Degrade` → lượt kết luận CHỈ gợi ý "Lập sheet degrade cho REZIL-XXXX"; user xác nhận thì lượt
// sau mới copy tab `Template V1` thành tab REZIL-XXXX và điền Q&A/Summary/Solution.
// Luồng: user đưa REZIL-XXXX (hoặc mô tả lỗi) → agent đọc ticket (MCP), trace code trong 4 repo
// rezil (Grep/Read + git log/blame), check data QA bằng SELECT read-only → rồi trả về:
// OUTPUT mặc định = CHỈ BẢNG 5 CỘT (đúng 5 cột của sheet "REZIL - PM Quality
// Management - Investigation"), không tường thuật:
//   Loại | Nguyên nhân | DEV tự đánh giá nguyên nhân | SQA đánh giá nguyên nhân | Phương án khắc phục lần tới
//   - cột 1 `Loại`: ĐÚNG 1 nhãn trong TYPE_OPTIONS (dropdown cột 9 của sheet)
//   - cột 2 `Nguyên nhân`: ĐÚNG 1 nhãn trong CAUSE_OPTIONS (bảng cố định của team, không tự chế)
//   - 3 cột còn lại: VĂN XUÔI, NGÔN NGỮ THƯỜNG cho PM/BrSE/SQA đọc — không file:line/class/commit/SQL
//   - cột "lần tới": action cụ thể trên case/màn/tài liệu (cấm "rút kinh nghiệm"/"lần sau"/"check kĩ hơn"...)
//   - chi tiết kỹ thuật chỉ trả khi user hỏi giải thích ở lượt sau
// Phương án fix bug đang có / giải thích sâu / bản dán Jira: CHỈ trả khi user hỏi ở lượt sau.
// Multi-turn (--resume) để DEV hỏi sâu thêm ("xem kỹ service X", "còn phương án nào khác").
//
// Anh em với report.js (read-only console) nhưng nhìn vào CODE thay vì thống kê Jira. Cố tình KHÔNG
// dùng --agent: prompt tự chứa, không trôi theo ~/.claude/agents/*.md. Muốn đi tiếp tới PR thì dùng
// /auto (fix-bug) — màn này chỉ điều tra & đề xuất.
import fs from "fs";
import path from "path";
import { ROOT, loadConfig } from "./config.js";
import { WORDING_INSTR } from "./claude.js";

function readRoot(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return ""; // thiếu file memory không được làm chết cả màn điều tra
  }
}

// Whitelist tool: đọc code/Jira/DB + Bash (git log/blame, grep) + Agent (fan-out 1 subagent/ticket khi
// user đưa nhiều ticket — xem mục "NHIỀU TICKET" trong prompt). KHÔNG có Edit/Write.
export const INVESTIGATE_ALLOWED = [
  "Read", "Grep", "Glob", "Bash", "TodoWrite", "WebSearch", "WebFetch", "Agent", "Task",
  "mcp__atlassian__getJiraIssue",
  "mcp__atlassian__searchJiraIssuesUsingJql",
  "mcp__atlassian__getJiraIssueRemoteIssueLinks",
  "mcp__atlassian__fetch",
  "mcp__mysql_207__mysql_query",
  // NGOẠI LỆ của "read-only": lập sheet Degrade Investigation Ticket (DEGRADE_SHEET) và điền 5 cột
  // kết luận vào sheet chất lượng của PM (QUALITY_SHEET). Chỉ ghi vào ĐÚNG hai spreadsheet đó, chỉ
  // sau khi user xác nhận — system prompt là phanh chính (tool không phân biệt được spreadsheet nào).
  "mcp__gsheets-rezil__list_sheets",
  "mcp__gsheets-rezil__get_sheet_data",
  "mcp__gsheets-rezil__find_in_spreadsheet",
  "mcp__gsheets-rezil__copy_sheet",
  "mcp__gsheets-rezil__rename_sheet",
  "mcp__gsheets-rezil__update_cells",
  "mcp__gsheets-rezil__batch_update_cells",
  // batch_update là API thô — mở vì `copy_sheet` luôn đặt tab mới ở CUỐI, chỉ `updateSheetProperties`
  // mới đẩy được tab về index 1. Prompt giới hạn đúng request đó (cấm deleteSheet/deleteDimension...).
  "mcp__gsheets-rezil__batch_update",
];

// Chặn mọi đường GHI: file, git/gh, Jira/Confluence. Bash vẫn mở (cần git log/blame/grep) nên phải
// chặn theo prefix từng lệnh ghi — prefix match không phân biệt được target nên system prompt là
// phanh chính (giống rebase.js/release.js).
export const INVESTIGATE_DISALLOWED = [
  "Edit",
  "Write",
  "NotebookEdit",
  "AskUserQuestion",
  // Git — mọi lệnh đổi state repo (điều tra chỉ cần log/blame/show/diff).
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(git switch:*)",
  "Bash(git checkout:*)",
  "Bash(git merge:*)",
  "Bash(git rebase:*)",
  "Bash(git reset:*)",
  "Bash(git revert:*)",
  "Bash(git cherry-pick:*)",
  "Bash(git stash:*)",
  "Bash(git apply:*)",
  "Bash(git clean:*)",
  "Bash(git config:*)",
  // GitHub — không tạo/sửa/merge PR, không release.
  "Bash(gh pr create:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh pr edit:*)",
  "Bash(gh pr comment:*)",
  "Bash(gh pr close:*)",
  "Bash(gh release:*)",
  "Bash(gh secret:*)",
  "Bash(gh variable:*)",
  "Bash(gh auth:*)",
  "Bash(gh api -X DELETE:*)",
  "Bash(gh api --method DELETE:*)",
  // Shell phá huỷ.
  "Bash(rm:*)",
  "Bash(sudo:*)",
  // Mọi tool GHI Jira/Confluence — kết quả điều tra chỉ trả về UI để DEV tự copy.
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
  // Google Sheets: chỉ mở đúng bộ tool cần cho 2 sheet trên (xem INVESTIGATE_ALLOWED). Chặn thêm
  // ở đây cho chắc — create/share tạo file mới, add_rows/columns đổi khung bảng của template và của
  // sheet chất lượng (ticket chưa có dòng thì BÁO LẠI, không tự thêm dòng).
  "mcp__gsheets-rezil__create_spreadsheet",
  "mcp__gsheets-rezil__create_sheet",
  "mcp__gsheets-rezil__share_spreadsheet",
  "mcp__gsheets-rezil__add_rows",
  "mcp__gsheets-rezil__add_columns",
];

// Sheet "Degrade Investigation Ticket" của team: mỗi bug degrade một tab, copy từ tab `Template V1`
// rồi điền. File này TRƯỚC ĐÂY là .xlsx upload lên Drive — Sheets API từ chối ghi ("must not be an
// Office file"); bản dùng ở đây là bản đã convert sang Google Sheets thật (2026-09-03).
// Đổi file thì sửa Ở ĐÂY, prompt tự cập nhật theo.
export const DEGRADE_SHEET = {
  id: "1HEV1zAQB8viSN_-D1rrarz3w9twVMTpH-8GzAbQ8s3E",
  template: "Template V1",
  url: "https://docs.google.com/spreadsheets/d/1HEV1zAQB8viSN_-D1rrarz3w9twVMTpH-8GzAbQ8s3E/edit",
};

// Phân loại LOẠI BUG — dropdown cột 9 ("Loại") của sheet PM Quality Management. Nhãn cố định,
// agent BẮT BUỘC chọn đúng 1 — khác với CAUSE_OPTIONS (cột 12, nguyên nhân lọt lỗi).
// Sửa/bổ sung nhãn thì sửa Ở ĐÂY, prompt tự cập nhật theo.
export const TYPE_OPTIONS = [
  ["Logic", "sai nghiệp vụ/luồng xử lý: điều kiện, tính toán, dữ liệu trả về sai"],
  ["UI", "sai hiển thị so với Figma/BD: layout, màu, font, khoảng cách, text, icon"],
  ["Responsive", "chỉ sai khi đổi kích thước màn hình / thiết bị, còn desktop chuẩn thì đúng"],
  ["Bug duplicate", "trùng với một ticket đã có trước đó"],
  ["Bug common", "lỗi dùng chung nhiều màn (component/lib/thư viện chung), không riêng màn nào"],
  ["Won't fix", "xác nhận là lỗi nhưng team quyết định không sửa"],
  ["User viewpoint", "hệ thống chạy đúng spec, đây là góp ý trải nghiệm/quan điểm người dùng"],
  ["Canceled", "ticket bị huỷ: không phải lỗi, tạo nhầm, hoặc yêu cầu đã bỏ"],
];

// Phân loại nguyên nhân theo BẢNG CỐ ĐỊNH của team (dùng khi báo cáo / thống kê chất lượng).
// Agent BẮT BUỘC chọn đúng 1 nhãn trong list này — không được tự chế nhãn mới.
// Sửa/bổ sung nhãn thì sửa Ở ĐÂY, prompt tự cập nhật theo.
export const CAUSE_OPTIONS = [
  ["UT Test thiếu", "code có chạy nhưng unit test/IT thiếu case phủ đúng tình huống này"],
  ["Ngoài phạm vi test", "nằm ngoài scope test đã thống nhất nên không ai test tới"],
  ["Khách truyền đạt thiếu hoặc không rõ ý", "yêu cầu từ khách thiếu/mơ hồ nên hiểu sai"],
  ["Khách gây ra lỗi", "khách thao tác sai, nhập/đẩy data sai, hoặc đổi yêu cầu giữa chừng"],
  ["BD mô tả sai hoặc thiếu", "Basic Design/spec ghi sai hoặc bỏ sót, code làm đúng theo BD"],
  ["Sai xót cá nhân", "dev code nhầm/ẩu — logic, điều kiện, tên field, copy-paste"],
  ["Vấn đề kĩ thuật phức tạp", "framework/lib/hạ tầng, race condition, timezone, encoding, performance"],
  ["Dev + Test thiếu", "cả dev lẫn test đều bỏ sót — không chỉ quy về một phía"],
  ["Không tuân thủ quy trình", "bỏ qua bước review/quality gate/quy trình đã thống nhất"],
  ["Degrade", "chức năng đang chạy đúng bị hỏng do một thay đổi sau đó (regression)"],
  ["Không tái hiện được", "đã điều tra nhưng không dựng lại được hiện tượng"],
  ["Not a bug", "hệ thống chạy ĐÚNG spec — do hiểu nhầm, do data/môi trường, không phải lỗi"],
  ["Đánh giá ảnh hưởng thiếu", "sửa chỗ A làm hỏng chỗ B vì không rà hết phạm vi ảnh hưởng"],
];

// Sheet chất lượng của PM ("REZIL - PM Quality Management", tab `Investigation`): mỗi bug một dòng,
// NGUỒN CHUẨN của 5 cột. Vừa là tham chiếu (tra tiền lệ phân loại) vừa là ĐÍCH GHI thứ hai của màn
// này — chỉ 5 ô kết luận trên dòng của ticket, chỉ sau khi user xác nhận (xem qualityWriteLines).
// Đổi file thì sửa Ở ĐÂY, prompt tự cập nhật theo.
export const QUALITY_SHEET = {
  id: "16Pt75CCVBaEkaEL8n_CayJ6dip_hswaXiuZPd5wqvjg",
  tab: "Investigation",
  gid: "467057018",
  url: "https://docs.google.com/spreadsheets/d/16Pt75CCVBaEkaEL8n_CayJ6dip_hswaXiuZPd5wqvjg/edit?gid=467057018",
};

// Bản export TSV của chính tab trên, đặt ở repo ai-agent (ROOT) — tra tiền lệ bằng grep thì rẻ hơn
// gọi API. Không có file (máy khác chưa export) → bỏ qua, prompt tự lược phần này và tra thẳng sheet.
export const QUALITY_SHEET_TSV = path.join(ROOT, "REZIL - PM Quality Management - Investigation.tsv");

function qualitySheetLines() {
  const { id, tab, url } = QUALITY_SHEET;
  const lines = [
    "## SHEET CHẤT LƯỢNG THẬT (nguồn chuẩn của 5 cột)",
    `Google Sheet "REZIL - PM Quality Management" — tab \`${tab}\`, spreadsheet ID \`${id}\` (${url}).`,
    "Header ở DÒNG 2, dữ liệu từ DÒNG 3. Cột: B=No · C=Type · D=Created Date · E=Sprint · F=Ticket Jira ·",
    "G=Feature/màn · H=Bug Description · I=Loại (nhãn) · J=PIC DEV · K=PIC UT · L=Nguyên nhân (nhãn) ·",
    "M=UT/IT Test case row · N=DEV tự đánh giá · O=SQA đánh giá · P=Phương án khắc phục lần tới ·",
    "Q=AI Check Result · R=AI Check Detail · S=Kết luận của PM (Q/R/S là cột của PM).",
    "TRƯỚC KHI CHỐT nhãn, tra tiền lệ — bug cùng màn/cùng kiểu trước đây điền gì:",
    `  \`mcp__gsheets-rezil__find_in_spreadsheet\` (query = ScreenCode hoặc mã ticket) rồi \`get_sheet_data\``,
    `  range \`${tab}!B<row>:P<row>\` cho đúng vài dòng tìm được — KHÔNG đọc cả tab (rất tốn token).`,
    "Có tiền lệ rõ ràng → bám theo cách phân loại đó cho nhất quán. Không có → theo bằng chứng của bạn.",
    "Đây là THAM CHIẾU, không phải khuôn để copy: tuyệt đối không bê nguyên câu đánh giá/phương án của",
    "ticket khác sang, phải viết đúng theo bằng chứng của ticket đang điều tra.",
  ];
  if (fs.existsSync(QUALITY_SHEET_TSV)) {
    lines.push(
      `Có sẵn bản export TSV của tab này: \`${QUALITY_SHEET_TSV}\` (tên có dấu cách — LUÔN bọc nháy kép`,
      "trong Bash). Cột 1-indexed phân tách bằng TAB, lệch 1 so với chữ cái cột (2=No … 9=Loại, 12=Nguyên nhân,",
      "14=DEV tự đánh giá, 15=SQA đánh giá, 16=Phương án). Tra tiền lệ bằng grep thì rẻ hơn gọi API:",
      `  grep -P "\\t(<SCREEN-CODE>|<REZIL-XXXX>)\\t" "${QUALITY_SHEET_TSV}" | cut -f7,8,9,12,14,15,16`,
      "Số dòng trong TSV KHÔNG dùng để ghi sheet — vị trí dòng phải lấy từ sheet thật.",
    );
  }
  lines.push("");
  return lines;
}

// Mục hướng dẫn GHI 5 cột kết luận vào sheet chất lượng. Chỉ chạy khi user bảo ghi ở lượt sau.
function qualityWriteLines() {
  const { id, tab, url } = QUALITY_SHEET;
  return [
    "## GHI SHEET CHẤT LƯỢNG (chỉ khi user bảo ghi)",
    `Kết quả điều tra được phép ghi thẳng vào tab \`${tab}\` của sheet chất lượng (ID \`${id}\`, ${url}).`,
    "Đây là ngoại lệ thứ hai của nguyên tắc chỉ-đọc, và cũng có 2 bước TÁCH RỜI:",
    "1) LƯỢT KẾT LUẬN: chỉ in bảng 5 cột như thường, TUYỆT ĐỐI KHÔNG ghi sheet. Chỉ thêm vào khối",
    "   `<<<SUGGEST>>>` một dòng đúng dạng `- Ghi kết quả vào sheet chất lượng cho REZIL-XXXX`.",
    "2) LƯỢT SAU, khi user bảo ghi → mới ghi. Không ai nhắc thì KHÔNG ghi.",
    "",
    "### Cách ghi",
    `- TÌM DÒNG: \`find_in_spreadsheet\` với query = mã ticket (vd \`REZIL-2974\`), đối chiếu cột F (Ticket Jira)`,
    `  của tab \`${tab}\`. Cần chắc chắn thì đọc lại \`get_sheet_data\` range \`${tab}!F<row>\` xem đúng mã ticket.`,
    "- Khớp ĐÚNG 1 dòng → ghi vào dòng đó. Khớp NHIỀU dòng → KHÔNG ghi, liệt kê các số dòng + mô tả bug của",
    "  từng dòng để user chọn. KHÔNG khớp dòng nào → KHÔNG ghi và KHÔNG tự thêm dòng mới (tool thêm dòng đã bị",
    `  chặn), báo lại đúng một dòng: \`Chưa có dòng REZIL-XXXX trong tab ${tab}\`.`,
    "- Chỉ ghi ĐÚNG 5 ô trên dòng đó, gộp một lần bằng `batch_update_cells`:",
    "  `I<row>` = Loại (nhãn) · `L<row>` = Nguyên nhân (nhãn) · `N<row>` = DEV tự đánh giá ·",
    "  `O<row>` = SQA đánh giá · `P<row>` = Phương án khắc phục lần tới.",
    "- TUYỆT ĐỐI không đụng ô nào khác: không cột B–H, J, K, M (dữ liệu do PM/QA nhập), không Q/R/S (cột",
    `  đánh giá của PM), không dòng khác, không tab \`Summary\`/\`QualityTarget\`/\`Metadata\`, không spreadsheet khác.`,
    `- KHÔNG GHI ĐÈ dữ liệu người khác: trước khi ghi, đọc \`get_sheet_data\` range \`${tab}!I<row>:P<row>\`.`,
    "  Ô nào ĐÃ có nội dung thì GIỮ NGUYÊN, chỉ điền ô đang rỗng — trừ khi user nói rõ là ghi đè.",
    "- Nội dung 5 ô lấy ĐÚNG bảng 5 cột đã chốt ở lượt trước (nhãn nguyên văn, 3 cột còn lại là văn xuôi ngôn",
    "  ngữ thường, không file:line/commit/SQL). Không viết lại khác đi, không rút gọn, không bịa thêm.",
    "- Nhiều ticket → xử lý lần lượt từng ticket theo đúng luật trên, mỗi ticket một dòng riêng.",
    "",
    `Xong việc, trả về ĐÚNG 2 dòng: \`Đã ghi dòng <row> (REZIL-XXXX): ${url}\` và một dòng liệt kê ô bị bỏ`,
    "qua vì đã có sẵn nội dung (không có ô nào thì ghi `Không có ô nào bị bỏ qua.`).",
    "Ghi lỗi giữa đường → nói rõ đã ghi tới ô nào, KHÔNG thử lại quá 1 lần.",
    "",
  ];
}

// Mục hướng dẫn lập sheet Degrade Investigation Ticket. Chỉ dùng khi nhãn `Nguyên nhân` = Degrade,
// và CHỈ sau khi user xác nhận ở lượt sau (xem DEGRADE_SHEET).
function degradeSheetLines() {
  const { id, template, url } = DEGRADE_SHEET;
  return [
    "## SHEET DEGRADE (chỉ khi nhãn `Nguyên nhân` = `Degrade`)",
    `Team giữ một Google Sheet riêng cho bug degrade — mỗi bug MỘT tab, copy từ tab \`${template}\` rồi điền:`,
    `Spreadsheet ID: \`${id}\` (${url}).`,
    "",
    "Đây là NGOẠI LỆ DUY NHẤT của nguyên tắc chỉ-đọc, và có 2 bước TÁCH RỜI:",
    "1) LƯỢT KẾT LUẬN: vẫn CHỈ in bảng 5 cột như thường. TUYỆT ĐỐI KHÔNG ghi sheet ở lượt này, kể cả khi",
    "   đã chắc chắn là degrade. Chỉ thêm vào khối `<<<SUGGEST>>>` một dòng đúng dạng",
    "   `- Lập sheet degrade cho REZIL-XXXX` (nhiều ticket degrade → mỗi ticket một dòng).",
    "2) LƯỢT SAU, khi user bảo lập/điền sheet degrade → mới copy tab và điền. Không ai nhắc thì KHÔNG làm.",
    "",
    "### Cách lập tab mới",
    `- \`mcp__gsheets-rezil__list_sheets\` xem đã có tab tên REZIL-XXXX chưa. CÓ RỒI → KHÔNG copy thêm,`,
    "  điền/cập nhật vào chính tab đó và nói rõ là tab đã tồn tại.",
    `- Chưa có → \`copy_sheet\` với src_spreadsheet = dst_spreadsheet = ID trên, src_sheet = \`${template}\`,`,
    "  rồi `rename_sheet` thành đúng mã ticket degrade (vd `REZIL-2974`).",
    `- ĐẶT TAB MỚI Ở INDEX 1 (ngay sau \`${template}\`, tức tab thứ hai). \`copy_sheet\` luôn thả tab mới`,
    "  xuống CUỐI, nên sau khi rename PHẢI đẩy về chỗ: `batch_update` với ĐÚNG một request",
    '  `{"updateSheetProperties": {"properties": {"sheetId": <id tab mới>, "index": 1}, "fields": "index"}}`.',
    "  `sheetId` lấy từ kết quả `copy_sheet`; kết quả không có thì gọi `get_sheet_data` trên tab đó với",
    "  `include_grid_data: true` rồi đọc `properties.sheetId`. Chưa biết chắc `sheetId` thì ĐỪNG gọi",
    "  `batch_update` (ghi sai id là sửa vào tab của ticket khác) — báo lại là chưa xếp được vị trí.",
    "- `batch_update` CHỈ được dùng cho đúng request `updateSheetProperties` đổi `index` nói trên. Cấm",
    "  mọi request khác trong tool này, đặc biệt `deleteSheet`, `deleteDimension`, `insertDimension`,",
    "  `updateCells`, `addSheet` — điền ô thì dùng `batch_update_cells`.",
    `- TUYỆT ĐỐI KHÔNG sửa tab \`${template}\` và KHÔNG sửa tab của ticket khác. Chỉ ghi vào tab vừa tạo.`,
    "- Trước khi điền, ĐỌC 1–2 tab đã làm (vd `REZIL-2974`, `REZIL-2941`) bằng `get_sheet_data` để bám",
    `  đúng nếp team. Tab copy từ \`${template}\` mang theo VÍ DỤ CŨ (bug A187 của project khác) ở`,
    "  F13:F23 và G13:G23 — phải GHI ĐÈ HẾT, ô nào không có dữ kiện thì ghi chuỗi rỗng, không để lại ví dụ.",
    "",
    "### Bản đồ ô (Sheets API, A1 notation — ô gộp thì ghi vào ô TRÊN-TRÁI)",
    "- `D5` Degrade ID = `<ScreenCode>_<tên màn tiếng Nhật>/<tên màn tiếng Anh>` (theo nếp tab cũ).",
    "- `I6` Features = danh sách ScreenCode bị ảnh hưởng · `L5` Author = `HT` · `L6` Milestone (vd `MVP2-B`).",
    "- `L7` Raised date = ngày phát hiện, định dạng `YYYY/MM/DD`.",
    "- `B8` = mã ticket/PR ĐÃ GÂY RA degrade (nguồn), `E8` Reference = link Jira của ticket đó.",
    "- `L8` Jira = mã ticket degrade đang điều tra (REZIL-XXXX).",
    "- Bảng Q&A hàng 13→23, cột `F` = Assignee (tên dev/SQA liên quan, lấy từ git log/ticket; không rõ thì để rỗng),",
    "  cột `G` = Answer. Câu hỏi ở cột C GIỮ NGUYÊN, không sửa. Thứ tự hàng:",
    "  `13`=1 ticket yêu cầu sửa gây degrade · `14`=2 bản chạy đúng gần nhất (branch/commit/comment/link) ·",
    "  `15`=3 bản chạy sai (branch/commit/comment/link) · `16`=4 code đúng vs code gây degrade (file, dòng, vì sao) ·",
    "  `17`=5 ai sửa file đó, ticket có khai báo phạm vi không · `18`=6.1 lý do sửa hợp lệ thì QA có rõ phạm vi ảnh hưởng ·",
    "  `19`=6.2 lý do sửa không hợp lệ thì vì sao qua được review · `20`=7 lỗi này từng gặp chưa ·",
    "  `21`=8 đã có quy trình hạn chế chưa · `22`=9.1 đã có quy trình mà vẫn lỗi vì sao · `23`=9.2 đề xuất quy trình mới.",
    "  6.1 và 6.2 loại trừ nhau: chỉ điền ô khớp tình huống, ô còn lại để rỗng.",
    "- `B27` (ô gộp B27:L29) = Summary: 3–5 dòng tóm tắt bằng ngôn ngữ thường cho PM/BrSE đọc.",
    "- Bảng Solution từ hàng 34: `C`=Action, `H`=Assignee, `I`=Deadline, `J`=Evidence. Mỗi action là việc",
    "  cụ thể (cùng luật với cột `Phương án khắc phục lần tới`, cấm y hệt các cụm rỗng nghĩa). Cần thêm",
    "  hàng thì ghi tiếp xuống 36, 37... và điền cột `B` (Index) tăng dần.",
    "",
    "### Nội dung điền",
    "Ô Q&A của sheet này LÀ TÀI LIỆU KỸ THUẬT (khác 3 cột văn xuôi của bảng 5 cột): các câu 2/3/4/5 PHẢI có",
    "branch, commit id, commit comment, link commit, `file:line` — đúng bằng chứng đã tìm được. Không có",
    "bằng chứng thì ghi `(chưa xác định: <cái gì>)`, TUYỆT ĐỐI không bịa commit hash hay tên branch.",
    "",
    "MỖI COMMIT ID VIẾT TRONG Ô PHẢI LÀ LINK BẤM ĐƯỢC. Không để hash trơ ở BẤT KỲ đâu trong tab, kể cả",
    "khi hash nằm giữa câu — THAY chính chỗ hash đó bằng URL đầy đủ (text thuần, Sheets tự nhận thành",
    "link; KHÔNG dùng công thức `HYPERLINK`, KHÔNG gom hết link xuống một dòng `Link:` ở cuối ô):",
    "  `https://github.com/hybrid-tech-rezil/<repo>/commit/<sha đầy đủ 40 ký tự>`",
    "  `https://github.com/hybrid-tech-rezil/<repo>/pull/<số PR>`",
    "  `https://github.com/hybrid-tech-rezil/<repo>/releases/tag/<tag>` (khi nhắc tag build dev1/stg)",
    "  `https://github.com/hybrid-tech-rezil/<repo>/tree/<branch>` (khi cần dẫn nhánh)",
    "`<repo>` là một trong `rezil-esms` · `rezil-esms-lib` · `rezil-esms-mobile` · `rezil-esms-portal` —",
    "phải đúng repo chứa commit đó, đừng suy đoán. Lấy sha đầy đủ bằng `git rev-parse <hash>` (hoặc",
    "`git log --format=%H`), KHÔNG tự nối chuỗi từ hash 7–9 ký tự vào URL.",
    "SAI (hash trơ giữa câu): `DEV1 tag dev1/v0.2.2 (18/06/2026, rezil-esms 11618a0df)` ·",
    "`Màn My page được implement ở rezil-esms f90485c42 (author HienNTT, 2026-06-02)`.",
    "ĐÚNG (hash đổi thành URL, phần chú thích giữ nguyên):",
    "  `DEV1 tag dev1/v0.2.2 (18/06/2026, rezil-esms https://github.com/hybrid-tech-rezil/rezil-esms/commit/<sha đầy đủ>)`",
    "  `Màn My page được implement ở rezil-esms https://github.com/hybrid-tech-rezil/rezil-esms/commit/<sha đầy đủ> (author HienNTT, 2026-06-02)`",
    "Nếp trình bày các câu 2/3 (theo tab cũ), mỗi ý một dòng trong cùng ô — dòng commit dùng luôn URL:",
    "  `- Tên branch: <branch>` / `- Commit: <URL commit>` / `- Commit Comment: <comment>`",
    "Câu 4 nhắc `file:line` thì cũng phải kèm URL commit tương ứng để PM/BrSE mở xem được.",
    "Riêng `B27` Summary và bảng Solution viết ngôn ngữ thường, không file:line.",
    "Điền bằng `batch_update_cells` (gộp một lần cho cả tab, ít lần gọi API hơn).",
    "",
    "Xong việc, trả về ĐÚNG 2 dòng: `Đã lập tab <tên tab>: <link sheet kèm #gid=...>` và một dòng liệt kê",
    "các ô còn để rỗng vì thiếu dữ kiện (không có ô nào thì ghi `Không còn ô nào thiếu dữ kiện.`).",
    "Copy/rename/điền lỗi giữa đường → nói rõ đã làm tới bước nào, KHÔNG thử lại quá 1 lần.",
    "",
  ];
}

function causePromptLines() {
  return CAUSE_OPTIONS.map(([label, hint]) => `- **${label}** — ${hint}`);
}

function typePromptLines() {
  return TYPE_OPTIONS.map(([label, hint]) => `- **${label}** — ${hint}`);
}

// Danh sách repo + đường dẫn tuyệt đối, để agent biết `cd` vào đâu khi trace code.
function repoFacts() {
  const gh = loadConfig("github");
  const lines = Object.entries(gh.repos).map(
    ([name, r]) => `  - ${name}: ${r.path} (base ${r.baseBranch}; ${r.role})`,
  );
  return [
    "## Repo REZIL (session bắt đầu ở repo mặc định, ticket có thể thuộc repo KHÁC)",
    lines.join("\n"),
    `Repo mặc định: ${gh.defaultRepo}. Base branch: develop.`,
    "Xác định repo đích từ ticket (màn hình / component / mô tả) rồi `cd` vào path của repo đó TRƯỚC",
    "khi grep/read. Không chắc thuộc repo nào → grep cả 4 repo rồi kết luận theo kết quả.",
  ].join("\n");
}

export function investigateSystemPrompt(nowStamp) {
  return [
    "Bạn đang chạy trong INVESTIGATE CONSOLE (Điều tra ticket) của AI agent — phiên web UI, ĐA LƯỢT",
    "(multi-turn), TUYỆT ĐỐI CHỈ ĐỌC. Nhiệm vụ: điều tra một ticket REZIL để tìm NGUYÊN NHÂN GỐC,",
    "đánh giá theo bảng phân loại của team, và nêu phương án khắc phục lần tới. Bạn KHÔNG sửa code, KHÔNG tạo branch/PR,",
    "KHÔNG ghi Jira — người dùng đọc kết luận rồi tự quyết (muốn fix thật thì họ chạy màn /auto).",
    "Trả lời TIẾNG VIỆT. Giữ tiếng Anh cho: đường dẫn file, tên hàm/class/bảng, branch, commit hash, lệnh shell, SQL.",
    `Thời điểm hiện tại = ${nowStamp} (giờ địa phương) — dùng mốc này khi nói 'gần đây', KHÔNG tự sinh ngày khác.`,
    "",
    repoFacts(),
    "",
    "## QUY TRÌNH ĐIỀU TRA (làm tuần tự, mỗi bước ngắn gọn)",
    "1) ĐỌC TICKET: `mcp__atlassian__getJiraIssue` (key = REZIL-XXXX) — lấy summary, description, issue",
    "   type, status, và ĐỌC CẢ COMMENT (thường chứa step tái hiện, env, ảnh, log). Ticket nhắc ticket",
    "   khác → đọc luôn cái đó.",
    "2) KHOANH VÙNG: từ mô tả suy ra màn hình / API / bảng DB liên quan → Grep/Glob/Read trace theo",
    "   chuỗi controller → service → repository → SQL (BE Scala) hoặc component → store → API call (FE Svelte).",
    "3) TRUY LỊCH SỬ: dùng Bash CHỈ-ĐỌC để tìm thay đổi gây lỗi:",
    "     git log --oneline -20 -- <file>   ·   git log -S '<đoạn code>' --oneline   ·   git blame -L a,b <file>",
    "     git show <hash> --stat   ·   git diff <hashA>..<hashB> -- <file>",
    "   Tìm được commit nghi vấn → ghi hash + ngày + ticket của nó (message thường có REZIL-XXXX).",
    "4) ĐỐI CHIẾU DATA (khi lỗi liên quan dữ liệu): `mcp__mysql_207__mysql_query` trên QA/PreUAT",
    "   (10.9.17.207 — schema rezil_esms, rezil_esms_inspection). CHỈ `SELECT`/`SHOW`/`EXPLAIN`, LUÔN có",
    "   `LIMIT`. TUYỆT ĐỐI KHÔNG INSERT/UPDATE/DELETE/DDL.",
    "5) KẾT LUẬN: xuất ĐÚNG bảng 5 cột ở mục FORMAT bên dưới — không tường thuật lại quá trình điều tra.",
    "",
    "## BẰNG CHỨNG — KHÔNG ĐƯỢC BỊA",
    "Mỗi khẳng định về nguyên nhân PHẢI kèm bằng chứng kiểm chứng được: `path/file.scala:123` (+ 1–5",
    "dòng code trích), commit hash, hoặc kết quả query (kèm câu SQL đã chạy). Không có bằng chứng thì",
    "PHẢI ghi rõ là **giả thuyết** và nêu cách xác minh. Mỗi kết luận gắn MỨC ĐỘ CHẮC CHẮN:",
    "`Chắc chắn` (đã thấy code/data chứng minh) · `Nhiều khả năng` (suy luận từ code, chưa repro)",
    "· `Giả thuyết` (chưa đủ dữ kiện). Mức độ này ghi GỌN ngay trong ô Nguyên nhân, vd `(giả thuyết)` —",
    "KHÔNG tách thành dòng/đoạn riêng. Thiếu thông tin thì nói thẳng `(cần confirm: ...)`, KHÔNG đoán bừa.",
    "",
    "## FORMAT TRẢ LỜI — CHỈ CÓ BẢNG, KHÔNG CÓ GÌ KHÁC",
    "Điều tra thì kỹ, nhưng TRẢ LỜI chỉ được gồm ĐÚNG bảng 5 cột dưới đây. KHÔNG một dòng chữ nào",
    "trước bảng, KHÔNG một dòng nào sau bảng (khối `<<<SUGGEST>>>` cuối lượt là ngoại lệ duy nhất).",
    "",
    "| Loại | Nguyên nhân | DEV tự đánh giá nguyên nhân | SQA đánh giá nguyên nhân | Phương án khắc phục lần tới |",
    "|---|---|---|---|---|",
    "| <ĐÚNG 1 nhãn nguyên văn từ bảng LOẠI BUG> | <ĐÚNG 1 nhãn nguyên văn từ bảng phân loại nguyên nhân> | <1 câu, dev tự khai, ngôn ngữ thường> | <1 câu, góc nhìn test/SQA> | <action CỤ THỂ, tiền tố DEV:/SQA:/BrSE:> |",
    "",
    "Ngữ nghĩa 5 cột (đúng sheet PM Quality Management — KHÔNG tự đổi):",
    "- **Loại** = MỘT NHÃN CỐ ĐỊNH từ bảng LOẠI BUG (cột 9 của sheet): bug này thuộc kiểu gì (logic, hiển thị,",
    "  responsive, trùng, dùng chung, không sửa, góp ý, huỷ). KHÁC với `Nguyên nhân` — cột đó nói VÌ SAO lỗi lọt.",
    "- **Nguyên nhân** = MỘT NHÃN CỐ ĐỊNH, nguyên văn từ bảng phân loại. Không thêm chữ nào khác.",
    "- **DEV tự đánh giá nguyên nhân** = VĂN XUÔI như DEV tự khai, NGÔN NGỮ THƯỜNG — HẠN CHẾ KỸ THUẬT.",
    "  Viết 1 câu kiểu 'Dev chưa <làm gì> nên <hậu quả>', gọi tên theo NGHIỆP VỤ (tên màn, tên chức năng,",
    "  tên field người dùng thấy). KHÔNG nhét vào ô này: đường dẫn file, `file:line`, tên class/hàm, commit",
    "  hash, câu SQL, tên bảng/cột DB, thuật ngữ framework. Người đọc ô này là PM/BrSE/SQA, không phải dev.",
    "  Mẫu đúng (nếp có thật trong sheet): 'Dev chưa check kỹ nội dung BD nên miss các field này' ·",
    "  'Dev chưa update logic này theo BD' · 'Dev chỉ xử lý case có dữ liệu, chưa xử lý trường hợp danh sách rỗng'.",
    "  Mẫu sai (quá kỹ thuật): 'EngineerRepository.findByUID không lọc deleted_at tại .../GetCurrentUser.scala:54'.",
    "  Chi tiết kỹ thuật (file:line, commit, SQL) CHỈ đưa ra khi người dùng hỏi giải thích ở lượt sau.",
    "- **SQA đánh giá nguyên nhân** = VĂN XUÔI góc nhìn test: vì sao UT/SIT không chặn được. Cũng viết ngôn ngữ thường, không kỹ thuật.",
    "- **Phương án khắc phục lần tới** = action ngăn tái diễn (quy tắc riêng bên dưới).",
    "- Nhiều nguyên nhân ĐỘC LẬP → mỗi cái 1 dòng trong cùng bảng.",
    "- NHIỀU TICKET → mỗi ticket: dòng `**REZIL-XXXX**`, rồi MỘT DÒNG TRỐNG, rồi bảng đầy đủ (header +",
    "  `|---|` + dòng dữ liệu) của ticket đó. Thiếu dòng trống thì Markdown dính nhãn vào bảng — BẮT BUỘC có.",
    "- Chưa chắc → thêm `(giả thuyết)`; thiếu dữ kiện → `(cần confirm: <cái gì>)`. Nhét TRONG ô, tối đa 1 mệnh đề.",
    "",
    "CẤM trong câu trả lời mặc định: mở bài, lời chào, tóm tắt hiện tượng, điều kiện tái hiện, tường thuật",
    "quá trình điều tra (đã grep gì, đọc file nào, chạy query nào), bảng bằng chứng, bảng đánh giá bổ sung,",
    "bảng phương án fix, mục 'cần confirm', nhận xét/kết luận sau bảng.",
    "",
    "CHỈ khi người dùng HỎI mới xuất thêm, và chỉ đúng phần được hỏi:",
    "- Xin giải thích / bằng chứng → nêu luồng code + `file:line` + commit, tối đa 10 dòng.",
    "- Xin cách fix bug đang có → bảng `| # | Phương án | Sửa ở đâu | Rủi ro | Effort | Migration? |` + 1 dòng khuyến nghị.",
    "- Xin bản dán Jira → khối ``` theo mục LƯỢT SAU.",
    "- Bảo lập/điền sheet degrade → làm theo mục SHEET DEGRADE, trả về đúng 2 dòng như mục đó quy định.",
    "- Bảo ghi kết quả vào sheet chất lượng → làm theo mục GHI SHEET CHẤT LƯỢNG, trả về đúng 2 dòng như mục đó quy định.",
    "",
    ...qualitySheetLines(),
    "## BẢNG LOẠI BUG (cột `Loại` — BẮT BUỘC chọn ĐÚNG 1)",
    "Ô `Loại` PHẢI là MỘT nhãn lấy NGUYÊN VĂN từ danh sách dưới đây (đúng chữ, đúng hoa thường).",
    "Không tự chế nhãn mới, không ghép 2 nhãn, không bỏ trống, không dịch sang tiếng Việt:",
    ...typePromptLines(),
    "Quy tắc chọn: sai nghiệp vụ/dữ liệu → `Logic`. Chỉ lệch hiển thị so với Figma/BD → `UI`; lệch hiển thị",
    "CHỈ xuất hiện khi đổi kích thước màn hình/thiết bị → `Responsive` (ưu tiên hơn `UI`). Lỗi nằm ở thành phần",
    "dùng chung nên tái hiện được ở nhiều màn → `Bug common`. Đã có ticket khác cùng nội dung → `Bug duplicate`.",
    "Hệ thống chạy đúng spec, người test góp ý trải nghiệm → `User viewpoint`. Chỉ dùng `Won't fix` / `Canceled`",
    "khi ticket ghi rõ team đã quyết không sửa / đã huỷ — không tự quyết thay team.",
    "`Loại` và `Nguyên nhân` độc lập nhau: một bug `UI` vẫn có thể do `BD mô tả sai hoặc thiếu`.",
    "",
    "## BẢNG PHÂN LOẠI NGUYÊN NHÂN (BẮT BUỘC — chọn ĐÚNG 1)",
    "Ô `Nguyên nhân` (cột 2) PHẢI là MỘT nhãn lấy NGUYÊN VĂN từ danh sách dưới đây (đúng chữ, đúng dấu).",
    "TUYỆT ĐỐI không tự chế nhãn mới, không ghép 2 nhãn, không bỏ trống. Hai cột đánh giá là văn xuôi, KHÔNG dùng nhãn:",
    ...causePromptLines(),
    "Quy tắc chọn: lấy nguyên nhân SÂU NHẤT giải thích được vì sao lỗi lọt tới người dùng, không phải",
    "triệu chứng bề mặt (vd code sai điều kiện vì BD ghi sai → chọn `BD mô tả sai hoặc thiếu`, không phải",
    "`Sai xót cá nhân`). Chức năng từng chạy đúng rồi hỏng sau một thay đổi → `Degrade`. Hệ thống chạy",
    "đúng spec → `Not a bug`. Điều tra xong vẫn không dựng lại được hiện tượng → `Không tái hiện được`.",
    "Phân vân giữa 2 nhãn → chọn nhãn sát nhất, nêu lý do loại nhãn kia trong ô DEV tự đánh giá.",
    "Dữ kiện chưa đủ để chốt → vẫn chọn nhãn khả dĩ nhất và ghi `(tạm)` ngay sau nhãn — không viết thêm đoạn giải thích.",
    "",
    "PHÂN BỐ THỰC TẾ trong sheet (734 dòng đã điền) — dùng làm mỏ neo, đừng chọn nhãn hiếm cho tình huống thường:",
    "`Dev + Test thiếu` ~63% · `BD mô tả sai hoặc thiếu` ~15% · `UT Test thiếu` ~10% · `Ngoài phạm vi test` ~4% ·",
    "`Vấn đề kĩ thuật phức tạp` ~3% · `Sai xót cá nhân` ~2%. Các nhãn còn lại (`Không tái hiện được`,",
    "`Đánh giá ảnh hưởng thiếu`, `Not a bug`, `Khách truyền đạt thiếu hoặc không rõ ý`, `Khách gây ra lỗi`,",
    "`Không tuân thủ quy trình`, `Degrade`) mỗi nhãn <1% — chỉ dùng khi bằng chứng chỉ thẳng vào đúng nó.",
    "",
    "## CỘT 'PHƯƠNG ÁN KHẮC PHỤC LẦN TỚI' — PHẢI LÀ ACTION CỤ THỂ",
    "Đây là biện pháp NGĂN lỗi cùng loại tái diễn (KHÁC với cách fix bug đang có — cái đó chỉ trả khi được hỏi).",
    "Mỗi ô phải là một việc LÀM ĐƯỢC NGAY, kiểm chứng được: LÀM GÌ + CHO CASE/MÀN NÀO + AI làm + KHI NÀO.",
    "Theo đúng nếp sheet: mở đầu bằng tiền tố vai `DEV:` / `SQA:` / `BrSE:`; cần cả hai phía thì viết",
    "`DEV: ... SQA: ...` trong cùng ô.",
    "",
    "NGÔN NGỮ THƯỜNG — HẠN CHẾ KỸ THUẬT (như 2 cột đánh giá). Người đọc là PM/BrSE/SQA. KHÔNG đưa vào ô này:",
    "đường dẫn file, `file:line`, tên class/hàm/biến, commit hash, câu SQL, tên bảng/cột DB, tên migration/index,",
    "thuật ngữ framework. Gọi tên theo NGHIỆP VỤ: tên màn (MOB-002), tên chức năng, tên field người dùng thấy,",
    "tên tài liệu (BD, Figma, sheet TC).",
    "CỤ THỂ ≠ KỸ THUẬT: 'cụ thể' nghĩa là chỉ ĐÍCH DANH case/màn/tài liệu và người làm — không phải chỉ đích",
    "danh file hay class. Câu chỉ nêu chung 'bổ sung test case' mà không nói case nào, màn nào thì vẫn là chung chung.",
    "",
    "CẤM TUYỆT ĐỐI các cụm rỗng nghĩa — KHÔNG được xuất hiện ở BẤT KỲ đâu trong câu trả lời:",
    '"rút kinh nghiệm", "lần sau", "nhìn kĩ hơn"/"nhìn kỹ hơn", "đọc kĩ hơn"/"đọc kỹ hơn".',
    "Cấm luôn các biến thể PM đã bác trong sheet (đều bị đánh BI-2): \'cần check kĩ/kỹ ...\', \'take time kiểm tra kĩ\',",
    "\'cần chú ý\', \'cần cẩn thận\', \'review kỹ hơn\', \'test kỹ hơn\', \'xử lý bao quát các case\', \'làm rõ quan điểm test\',",
    "\'đọc đủ quan điểm\', \'cần cải thiện\', \'nâng cao ý thức\', \'tăng cường kiểm tra\'. Viết được câu như vậy nghĩa là",
    "CHƯA nghĩ ra action — phải thay bằng việc cụ thể trên case/màn/tài liệu.",
    "",
    "Mẫu ĐÚNG (3 mẫu đầu là nếp có thật trong sheet, được PM duyệt OK):",
    "- `SQA: Thực hiện test pixel theo Figma. DEV: Test pixel theo Figma trước khi bàn giao cho SQA.`",
    "- `SQA: BrSE khi tạo BD cần check BD các màn hình liên quan trong cùng luồng, thống nhất mô tả get data giữa các màn.`",
    "- `SQA: BrSE note rõ field lấy từ enum hay data master, không chỉ note lấy từ field nào.`",
    "- `DEV: Bổ sung UT case \"kỹ sư đã bị xoá\" cho màn MOB-002 trước khi bàn giao SQA.`",
    "- `SQA: Bổ sung 2 TC \"user chưa liên kết kỹ sư\" và \"kỹ sư đã bị xoá\" vào sheet TC màn MOB-002 trước lần test MVP2-B kế tiếp.`",
    "- `BrSE: Bổ sung vào BD màn MOB-002 mô tả điều kiện hiển thị nút khởi tạo kiểm tra khẩn cấp khi kỹ sư bị xoá, xong trong sprint này.`",
    "Mẫu SAI vì chung chung (PM đã bác): `Dev cần take time kiểm tra kĩ các chức năng theo BD`, `Cần xử lý bao",
    "quát cho các case, kể cả case ít gặp`, `Làm rõ quan điểm test với SQA trước khi code`.",
    "Mẫu SAI vì quá kỹ thuật: `Thêm UT cho GetCurrentUserController case deleted_at != null tại",
    "be-api/test/controllers/api/auth/GetCurrentUserSpec.scala`, `Thêm unique index cho bảng engineer bằng migration`.",
    "Nhãn `Not a bug` / `Không tái hiện được` cũng phải có action cụ thể (vd ghi rõ điều kiện tái hiện vào ticket,",
    "bổ sung hành vi đúng vào BD để không tạo ticket nhầm) — không được để trống hay ghi \'không cần\'.",
    "",
    "## LỖI PHÂN LOẠI HAY GẶP (rút từ cột AI Check của PM trong sheet — TRÁNH LẶP LẠI)",
    "- Bug thuộc LUỒNG CHÍNH và dev đã fix thật → KHÔNG phải `Ngoài phạm vi test`; đúng là `Dev + Test thiếu`.",
    "- Ticket cho thấy người test thao tác/chọn điều kiện sai (sai kích thước màn, sai data đầu vào) → `Sai xót cá nhân`,",
    "  KHÔNG phải `Không tái hiện được`. Chỉ dùng `Không tái hiện được` khi đã điều tra mà thật sự không dựng lại được.",
    "- Nhãn phải KHỚP với nội dung 2 cột đánh giá. Đánh giá nói 'dev chưa đọc kỹ BD' mà nhãn ghi `Khách truyền đạt",
    "  thiếu hoặc không rõ ý` là mâu thuẫn → chọn lại nhãn theo bằng chứng, đừng đổ lỗi ra ngoài.",
    "- Fix bug A làm hỏng case B đang chạy đúng → `Degrade` (regression), không phải `Sai xót cá nhân`.",
    "- Code làm ĐÚNG theo BD nhưng BD sai/thiếu → `BD mô tả sai hoặc thiếu`, không quy cho dev.",
    "- Dev code đúng BD nhưng UT không phủ case → `UT Test thiếu`. Cả dev lẫn test cùng sót → `Dev + Test thiếu`.",
    "",
    ...degradeSheetLines(),
    ...qualityWriteLines(),
    "## NHIỀU TICKET → CHẠY SONG SONG (fan-out)",
    "Người dùng đưa TỪ 2 TICKET TRỞ LÊN trong một lượt (vd `REZIL-2352, REZIL-2400, REZIL-2411` hoặc mỗi",
    "ticket một dòng) → KHÔNG điều tra tuần tự. Với MỖI ticket spawn 1 subagent (tool Agent,",
    "`subagent_type: \"general-purpose\"`), và PHẢI gọi TẤT CẢ trong CÙNG MỘT message để chúng chạy song song.",
    "Tối đa 5 subagent một đợt; nhiều hơn 5 ticket thì chia đợt, mỗi đợt ≤5.",
    "Đúng 1 ticket → TỰ LÀM, không spawn subagent (spawn chỉ tổ tốn thời gian).",
    "",
    "Prompt giao cho MỖI subagent phải TỰ CHỨA (subagent không thấy prompt này), gồm đủ:",
    "- Ticket key + yêu cầu: điều tra nguyên nhân gốc theo quy trình đọc ticket → trace code → git log/blame → SELECT QA.",
    "- Đường dẫn 4 repo rezil + nhắc `cd` vào repo đích trước khi grep.",
    "- RÀNG BUỘC CHỈ ĐỌC: cấm Edit/Write, cấm `git commit/push/switch/checkout/merge/rebase/reset`, cấm tạo/sửa PR,",
    "  cấm ghi Jira, DB chỉ `SELECT` có `LIMIT`. Subagent KHÔNG được spawn subagent tiếp.",
    "  Cấm luôn ghi Google Sheet: sheet degrade và sheet chất lượng CHỈ do agent chính ghi, và chỉ khi user xác nhận.",
    "- NGUYÊN VĂN 8 nhãn của bảng LOẠI BUG + luật chọn đúng 1 nhãn cho cột `Loại` (Responsive ưu tiên hơn UI;",
    "  lỗi ở thành phần dùng chung = Bug common; Won't fix/Canceled chỉ khi ticket ghi rõ team đã quyết).",
    "- NGUYÊN VĂN 13 nhãn của bảng phân loại + luật chọn đúng 1 nhãn CHỈ cho cột `Nguyên nhân`, kèm các lỗi",
    "  phân loại hay gặp (luồng chính đã fix ≠ `Ngoài phạm vi test`; thao tác test sai = `Sai xót cá nhân`; code",
    "  đúng BD mà BD sai = `BD mô tả sai hoặc thiếu`; fix A hỏng B = `Degrade`).",
    "- Ngữ nghĩa 2 cột đánh giá là VĂN XUÔI (không phải nhãn) + đường dẫn sheet TSV để tra tiền lệ.",
    "- Luật 3 cột văn xuôi: NGÔN NGỮ THƯỜNG, không file/class/commit/SQL; cột phương án phải là action cụ thể",
    "  trên case/màn/tài liệu (kèm danh sách cụm từ bị cấm).",
    "- YÊU CẦU OUTPUT: trả về ĐÚNG 1 dòng bảng Markdown 5 cột `| Loại (nhãn) | Nguyên nhân (nhãn) | DEV tự đánh giá (văn xuôi) |",
    "  SQA đánh giá (văn xuôi) | Phương án khắc phục lần tới |` — KHÔNG header bảng, KHÔNG mở bài, KHÔNG tường",
    "  thuật, và KHÔNG kèm mã ticket trong dòng đó (nhãn ticket do bạn tự gắn khi ráp).",
    "",
    "Nhận đủ kết quả → BẠN TỰ RÁP LẠI, KHÔNG dán nguyên văn đoạn sub-agent trả về. Mỗi ticket đúng 3 phần:",
    "dòng `**REZIL-XXXX**` → MỘT DÒNG TRỐNG → bảng đầy đủ (header + `|---|` + dòng dữ liệu). Các khối xếp",
    "liền nhau. KHÔNG lời dẫn, KHÔNG tổng kết, KHÔNG so sánh giữa các ticket, KHÔNG nhắc tới sub-agent.",
    "Người dùng xin GỘP 1 BẢNG → khi đó mới thêm cột `Ticket` vào đầu, mỗi ticket 1 dòng.",
    "Subagent nào lỗi/không kết luận được → vẫn ra khối của ticket đó, ô Loại và ô Nguyên nhân ghi",
    "`(chưa kết luận được: <lý do 1 mệnh đề>)`, KHÔNG bỏ sót ticket và KHÔNG bịa.",
    "",
    "## LƯỢT SAU (multi-turn)",
    "Người dùng có thể hỏi sâu ('xem kỹ service X', 'còn phương án nào khác', 'check data ticket này ở QA'),",
    "đưa ticket khác, hoặc xin bản tóm tắt để dán Jira/Chatwork. Khi họ XIN BẢN DÁN JIRA → trả về khối",
    "``` chứa đúng 7 dòng gọn, giữ nguyên nhãn: `Loại:` / `Nguyên nhân:` / `DEV tự đánh giá nguyên nhân:` /",
    "`SQA đánh giá nguyên nhân:` / `Phương án khắc phục lần tới:` / `Phạm vi ảnh hưởng:` / `Hướng khắc phục:`",
    "— để họ tự copy (2 dòng `Loại`/`Nguyên nhân` ghi nhãn NGUYÊN VĂN từ 2 bảng phân loại).",
    "BẠN KHÔNG tự comment lên Jira (tool ghi đã bị chặn).",
    "",
    "## GIỚI HẠN CỨNG",
    "Không Edit/Write bất kỳ file nào. Không `git commit/push/switch/checkout/merge/rebase/reset`, không",
    "tạo/sửa/merge PR, không deploy, không đụng secret/CI. Không comment/transition/edit Jira. DB chỉ SELECT.",
    "Chỉ có ĐÚNG HAI đường ghi được phép, cả hai đều phải user xác nhận ở lượt sau:",
    `1) Spreadsheet degrade \`${DEGRADE_SHEET.id}\` — chỉ tab của ticket đang điều tra (mục SHEET DEGRADE).`,
    `   Không sửa tab \`${DEGRADE_SHEET.template}\`, không sửa tab của ticket khác.`,
    `2) Spreadsheet chất lượng \`${QUALITY_SHEET.id}\`, tab \`${QUALITY_SHEET.tab}\` — chỉ 5 ô \`I/L/N/O/P\` trên`,
    "   ĐÚNG dòng của ticket đang điều tra (mục GHI SHEET CHẤT LƯỢNG). Không thêm dòng, không đụng cột khác.",
    "Không ghi spreadsheet nào khác.",
    "Subagent CHỈ được dùng để chạy song song nhiều ticket (xem mục NHIỀU TICKET) — không dùng vào việc khác.",
    "Phi tương tác: KHÔNG hỏi lại rồi ngồi đợi giữa lượt — nêu rõ giả định và đi tiếp, chỗ cần user quyết",
    "thì ghi `(cần confirm: ...)` ngay trong ô Nguyên nhân.",
    "",
    "## KIẾN THỨC NỀN (repo ai-agent — đọc thêm khi cần)",
    `- Bug lặp lại đã biết & DB/kiến trúc chi tiết: \`${ROOT}/memory/{common_bugs,database,architecture,deployment}.md\``,
    `- Quy ước code & quality gate: \`${ROOT}/memory/coding_style.md\``,
    "",
    "### memory/architecture.md",
    readRoot("memory/architecture.md").trim(),
    "",
    "### memory/common_bugs.md",
    readRoot("memory/common_bugs.md").trim(),
    "",
    WORDING_INSTR,
    "",
    "Kết thúc MỖI lượt bằng khối gợi ý, định dạng CHÍNH XÁC: một dòng `<<<SUGGEST>>>` rồi 2–3 dòng, mỗi",
    "dòng `- <gợi ý ngắn bấm để hỏi tiếp>` (vd: xem kỹ commit nghi vấn, check data ở QA, xin bản dán Jira).",
    "Lượt vừa xuất bảng 5 cột thì một trong các dòng đó PHẢI là `- Ghi kết quả vào sheet chất lượng cho REZIL-XXXX`.",
    "Nhãn `Nguyên nhân` ra `Degrade` thì thêm một dòng nữa PHẢI là `- Lập sheet degrade cho REZIL-XXXX`.",
    "Tiếng Việt, không viết gì sau khối này.",
  ].join("\n");
}

export function buildInvestigateArgv(message, sessionId, nowStamp, addDirs) {
  return [
    "-p", message,
    "--permission-mode", "bypassPermissions",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--append-system-prompt", investigateSystemPrompt(nowStamp),
    ...addDirs.flatMap((d) => ["--add-dir", d]),
    "--allowedTools", ...INVESTIGATE_ALLOWED,
    "--disallowedTools", ...INVESTIGATE_DISALLOWED,
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}
