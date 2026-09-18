// Console Translate: đối chiếu tài liệu Basic Design bản tiếng Việt với bản tiếng Nhật trên Google
// Sheet — bản JP đã dịch hết chưa, chỗ nào còn sót tiếng Việt, lệch placeholder, nghi sai nghĩa.
//
// Toàn bộ QUY TẮC nằm trong spec `ui-next/app/translate/TRANSLATE_SPEC.md` — file đó là source of
// truth, được ĐỌC LÚC CHẠY và nhúng nguyên văn vào system prompt. Sửa spec là đổi hành vi ngay lượt
// sau, không cần build/restart (giống lib/kloc.js, lib/evidence.js).
//
// Mặc định CHỈ ĐỌC. Chỉ khi người dùng yêu cầu rõ thì mới ghi kết quả ra tab riêng
// (`Translate-Check`) của file JP; tab VN/JP gốc thì tuyệt đối không sửa.
import fs from "fs";
import path from "path";
import { ROOT } from "./config.js";
import { WORDING_INSTR } from "./claude.js";

// Spec nằm cạnh màn /translate. Đọc lúc chạy để sửa spec là có hiệu lực ngay.
export const SPEC_REL = "ui-next/app/translate/TRANSLATE_SPEC.md";

// Hai cặp BD mặc định. Người dùng đưa link khác thì theo link đó — đây chỉ là default để không phải
// dán ID mỗi lượt. ID lấy từ URL Google Sheet (phần giữa /d/ và /edit).
export const TRANSLATE_PAIRS = {
  web: {
    label: "BD Web",
    vn: "1ABO6soPFhw9zFUUFgCnqEDSscw7ihmXosa_ETEmOoO8",
    jp: "1Ue5vSA2T_iwWMX1ooYNqPw4HENn3LarHpsAa9bHyriU",
  },
  mobile: {
    label: "BD Mobile",
    vn: "15cDzvbNfkzFGCMNSGGeFc3lSmCai4iqh-TsnliCSUPU",
    jp: "14JnuKAD0kjetvOHzrURIlaEGsheOE8VRxnwv4hggrXE",
  },
  batch: {
    label: "BD Batch/Sync (MVP2)",
    vn: "1pJa_jb1GZhn-7ll-QiCH-Tt5B2yz1J22cwUb3qFXp3o",
    jp: "1EzvDCAu_vGQEgMMMlZqxDXVK70fLXE9Pa2akZhSB-qw",
  },
  portal: {
    label: "BD Customer Portal",
    vn: "1ACd_lJU6kZat3cu7w6sErv1TngR24MpNT3uRo5BpVQ4",
    jp: "1MimGJrwSo19TWmPYtMdYhzr0WuzMQO1waopGbMdlvmI",
  },
  // Bảng ma trận hành vi Online/Offline (mobile) — không phải BD, xem spec §9.
  offline: {
    label: "Spec Online/Offline",
    vn: "1a1xSYSnqE6jTCKeEu8RFISP_gDoyJ1KndpfSJ5yoYKc",
    jp: "1koLDBXdekvUPde60EKT-M63j85dGI6LoC7Pr-kClg6U",
  },
  // Danh mục enum/master data — cột `Japanese text` vốn đã tiếng Nhật ở CẢ HAI bản, nên đây là đối
  // chiếu ĐỒNG BỘ dữ liệu chứ không phải đối chiếu bản dịch. Xem spec §10.
  masterdata: {
    label: "Master data / Enum",
    vn: "1cG3GlJAgWOVOu9aE_nAw0_Gv80A-PvlnFSwDbwV14Xw",
    jp: "1CazkNxfGmWGGsljhoIYNc9JaNxbkxQJu7o6YRcKxLOc",
  },
  // Bảng địa chỉ/khu vực Nhật (エリア・都道府県・市区郡) — nội dung tiếng Nhật ở CẢ HAI bản như
  // `masterdata`, nên cũng là đối chiếu đồng bộ dữ liệu. Xem spec §10.
  address: {
    label: "Master địa chỉ / khu vực",
    vn: "1FwWjODrzfHIKEazZBKyRxNjFYgb37Av4vcZqtAGMkZY",
    jp: "19qQFrUrv55m_ehHwVNO6b0mNZWGxwEHxZnEbsqG01Hk",
  },
  // File test case SQA — KHÔNG phải Basic Design: layout bảng TC (header dòng 12), tên tab có kèm
  // tiếng Nhật nên phải ghép tab theo mã màn hình. Xem spec §8.
  testcase: {
    label: "Test case SQA",
    vn: "1YJa5iFt74z_bw0GfWy2CObK7JldkHfBbXRLDRwaQ86w",
    jp: "1XQ9nJEEYIzzgOE12vDMAGYx03ne6NRk_tKtEdewERVA",
  },
};

// File report chung cho BSE: tab `ChecklistAI` (mỗi dòng = 1 điểm lệch), tab `Checklist` là nguồn tra
// deep link (gid) của từng sheet VN/JP. Quy tắc ghi ở spec §12.
export const REPORT_SHEET_ID = "1zfkfhP016v4IkaqZ1gXH14OS33buRATvEnTdcQn33PI";
export const REPORT_TAB = "ChecklistAI";

// Trạng thái "tab nào đã soát" — file JSON local, ghi/đọc qua script (Write/Edit bị chặn ở console
// này nên script là đường ghi duy nhất). Xem spec §13.
export const STATE_SCRIPT = "ui-next/scripts/translate-state.mjs";

// Service account của MCP gsheets-rezil. File nào chưa share cho địa chỉ này thì API trả 403 —
// prompt yêu cầu agent báo đúng câu này thay vì đoán nội dung.
export const SERVICE_ACCOUNT = "rezil-agent@rezil-agent.iam.gserviceaccount.com";

export function readSpec() {
  try {
    return fs.readFileSync(path.join(ROOT, SPEC_REL), "utf8").trim();
  } catch {
    return ""; // thiếu spec → agent phải dừng và báo (xem prompt)
  }
}

// Chỉ cần đọc spec (Read/Grep/Glob) + đọc/ghi sheet qua MCP gsheets-rezil. Bash mở để chạy `node -e`
// đếm/so chuỗi khi dữ liệu dài — không dùng để sửa file (Write/Edit bị chặn bên dưới).
export const TRANSLATE_ALLOWED = [
  "Read", "Grep", "Glob", "Bash", "TodoWrite",
  "mcp__gsheets-rezil__list_sheets",
  "mcp__gsheets-rezil__get_sheet_data",
  "mcp__gsheets-rezil__get_multiple_sheet_data",
  "mcp__gsheets-rezil__get_sheet_formulas",
  "mcp__gsheets-rezil__find_in_spreadsheet",
  "mcp__gsheets-rezil__list_spreadsheets",
  "mcp__gsheets-rezil__search_spreadsheets",
  "mcp__gsheets-rezil__create_sheet",
  "mcp__gsheets-rezil__update_cells",
  "mcp__gsheets-rezil__batch_update_cells",
];

// Console này chỉ đọc sheet (và ghi 1 tab kết quả khi được yêu cầu). Chặn mọi đường ghi khác: sửa
// code, đụng git/PR, xoá tab, đổi tên tab, tạo spreadsheet mới.
export const TRANSLATE_DISALLOWED = [
  // Một lượt = đọc 2 tab + so sánh, gọn trong một context; sub-agent chỉ thêm lượt gọi model.
  "Agent",
  "Write",
  "Edit",
  "NotebookEdit",
  "AskUserQuestion",
  "mcp__gsheets-rezil__batch_update",
  "mcp__gsheets-rezil__create_spreadsheet",
  "mcp__gsheets-rezil__rename_sheet",
  "mcp__gsheets-rezil__copy_sheet",
  "mcp__gsheets-rezil__share_spreadsheet",
  "mcp__gsheets-rezil__add_rows",
  "mcp__gsheets-rezil__add_columns",
  "mcp__gsheets-rezil__add_chart",
  "Bash(git commit:*)",
  "Bash(git push:*)",
  "Bash(git switch:*)",
  "Bash(git checkout:*)",
  "Bash(git merge:*)",
  "Bash(git rebase:*)",
  "Bash(git reset:*)",
  "Bash(git revert:*)",
  "Bash(git tag:*)",
  "Bash(gh pr create:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh release:*)",
  "Bash(rm:*)",
  "Bash(sudo:*)",
];

export function translateSystemPrompt(nowStamp) {
  const spec = readSpec();
  const pairs = Object.entries(TRANSLATE_PAIRS)
    .map(([k, p]) => `- \`${k}\` (${p.label}): VN \`${p.vn}\` · JP \`${p.jp}\``)
    .join("\n");
  return [
    `Bây giờ là ${nowStamp} (Asia/Ho_Chi_Minh). KHÔNG tự sinh ngày/giờ khác.`,
    "",
    "# VAI TRÒ",
    "Bạn đối chiếu tài liệu Basic Design của dự án REZIL giữa bản tiếng Việt (VN) và bản tiếng Nhật",
    "(JP) trên Google Sheet, trả lời hai câu hỏi: (1) đã dịch hết từ VN sang JP chưa, (2) phần đã dịch",
    "có sai sót gì. Làm theo ĐÚNG spec",
    `\`${SPEC_REL}\` nhúng nguyên văn bên dưới — cách ghép dòng, các loại lỗi T1–T7, định dạng báo cáo`,
    "lấy từ đó, KHÔNG tự chế.",
    "",
    "Cặp file mặc định:",
    pairs,
    "",
    spec
      ? "# SPEC (nguyên văn, tuân thủ tuyệt đối)\n\n" + spec
      : `# SPEC KHÔNG ĐỌC ĐƯỢC\nKhông đọc được \`${ROOT}/${SPEC_REL}\`. DỪNG LẠI, báo người dùng đường dẫn thiếu, KHÔNG tự suy diễn quy trình.`,
    "",
    "# CÁCH LÀM VIỆC Ở CONSOLE NÀY",
    "- Người dùng nêu cặp file (`web`/`mobile`, hoặc dán link) + tab cần đối chiếu. Đưa link mới thì",
    "  dùng link đó, không lấy default.",
    `- ĐẦU mỗi lượt soát: chạy \`node ${STATE_SCRIPT} list --pair <cặp>\` để biết tab nào đã soát rồi,`,
    "  và SAU mỗi tab soát xong thì ghi lại bằng `add` — theo spec §13.",
    "- Dữ liệu phải ĐỌC THẬT từ sheet qua MCP. Cấm suy đoán nội dung ô, cấm bịa địa chỉ ô, cấm kết",
    "  luận 'đã dịch hết' khi chưa đọc hết vùng.",
    "- Mỗi phát hiện phải neo bằng địa chỉ ô thật (vd `MOB-001 Login!C42`) và trích nội dung hai bản.",
    "- Không tường thuật từng lệnh MCP; báo theo đúng định dạng spec §5.",
    "",
    "# GIỚI HẠN CỨNG",
    "- Mặc định CHỈ ĐỌC. Chỉ ghi khi người dùng nói rõ 'ghi report' / 'ghi kết quả vào sheet'. Khi đó",
    `  ghi vào file report chung \`${REPORT_SHEET_ID}\`, tab \`${REPORT_TAB}\` theo spec §12 — mỗi điểm`,
    "  lệch một dòng. Người dùng chỉ định file/tab khác thì theo họ (spec §6).",
    "- TUYỆT ĐỐI không sửa nội dung tab VN và tab JP gốc, không tự dịch hộ rồi ghi vào bản JP, không",
    "  xoá/đổi tên/copy tab, không tạo spreadsheet mới, không đổi quyền share (đã chặn ở tool).",
    "- KHÔNG sửa file nào trong repo (Write/Edit đã bị chặn). Cũng không dùng Bash (`>`, `tee`,",
    "  `sed -i`) để ghi đè file nhằm lách giới hạn này.",
    `- Sheet trả lỗi 403 'caller does not have permission' → báo người dùng share file cho service`,
    `  account \`${SERVICE_ACCOUNT}\` (quyền Viewer là đủ để đối chiếu; cần Editor nếu muốn ghi tab kết`,
    "  quả), rồi DỪNG. Không đoán nội dung file không đọc được.",
    "- Phi tương tác: không hỏi lại rồi ngồi đợi giữa lượt — nêu giả định và đi tiếp; chỗ buộc người",
    "  dùng quyết thì làm xong phần còn lại rồi ghi rõ `(cần confirm: ...)` ở cuối.",
    "",
    WORDING_INSTR,
    "",
    "Kết thúc MỖI lượt bằng khối gợi ý, định dạng CHÍNH XÁC: một dòng `<<<SUGGEST>>>` rồi 2–3 dòng,",
    "mỗi dòng `- <gợi ý ngắn bấm để làm tiếp>` (vd: đối chiếu tab kế tiếp, xem chi tiết các mục nghi",
    "sai nghĩa, ghi kết quả vào tab Translate-Check). Tiếng Việt, không viết gì sau khối này.",
  ].join("\n");
}

export function buildTranslateArgv(message, sessionId, nowStamp, addDirs) {
  return [
    "-p", message,
    "--permission-mode", "bypassPermissions",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--append-system-prompt", translateSystemPrompt(nowStamp),
    ...addDirs.flatMap((d) => ["--add-dir", d]),
    "--allowedTools", ...TRANSLATE_ALLOWED,
    "--disallowedTools", ...TRANSLATE_DISALLOWED,
    ...(sessionId ? ["--resume", sessionId] : []),
  ];
}
