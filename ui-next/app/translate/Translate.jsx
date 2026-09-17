"use client";

import AgentConsole from "../_components/AgentConsole";

// Console đối chiếu bản dịch: Basic Design bản tiếng Việt ↔ bản tiếng Nhật trên Google Sheet.
// Quy tắc nằm nguyên trong spec app/translate/TRANSLATE_SPEC.md — agent đọc spec lúc chạy (xem
// /api/translate + lib/translate.js): ghép dòng theo Spec-ID hoặc toạ độ ô, phân loại lỗi T1 chưa
// dịch · T2 sót tiếng Việt · T3 copy nguyên bản · T4 lệch placeholder/số · T5 nghi sai nghĩa ·
// T6 thừa ở JP · T7 lệch cấu trúc. Mặc định chỉ đọc; ghi tab Translate-Check khi được yêu cầu.
const EXAMPLES = [
  "So tab MOB-001 Login của cặp mobile: JP đã dịch hết chưa?",
  "Cặp web, tab LOGIN-001 Login — liệt kê ô còn sót tiếng Việt",
  "Cặp mobile: so danh sách tab hai file, tab nào chỉ có ở một bên",
  "Cặp batch, tab BATCH-001 - Submit Inspection to Client: JP đã dịch hết chưa?",
  "Cặp testcase, tab MOB-014 Site List: bản JP dịch thiếu/sai chỗ nào?",
  "Cặp masterdata: enum nào lệch giữa hai file (thiếu dòng, khác Japanese text)?",
  "Cặp portal: soát cả file, in bảng kế hoạch trước rồi soát từng lô 3 tab",
  "Liệt kê các tab đã soát của cặp portal",
  "Ghi report các điểm lệch vừa tìm được vào tab ChecklistAI",
];

const config = {
  apiPath: "/api/translate",
  sessionsPath: "/api/sessions",
  storageKey: "translate:console",
  accent: "green",
  icon: "🈳",
  title: "Translate",
  badge: "BD VN ↔ JP",
  renderMarkdown: true,
  examples: EXAMPLES,
  emptyText:
    "Chọn cặp file (`web` = BD Web, `mobile` = BD Mobile, `batch` = BD Batch/Sync MVP2, `portal` = BD Customer Portal, `testcase` = test case SQA, `offline` = bảng Online/Offline, `masterdata` = enum/master data, `address` = master địa chỉ/khu vực — hoặc dán link Sheet khác) và tab cần soát. Claude đọc hai bản qua MCP gsheets-rezil rồi đối chiếu theo spec app/translate/TRANSLATE_SPEC.md: ghép dòng theo cột Spec-ID (hoặc theo toạ độ ô khi hai tab cùng layout), rồi phân loại T1 chưa dịch · T2 sót tiếng Việt · T3 copy nguyên bản VN · T4 lệch placeholder/số/mã · T5 nghi sai nghĩa · T6 thừa ở JP · T7 lệch cấu trúc. Báo cáo viết cho BSE: tỉ lệ đã dịch + bảng 6 cột `Ô VN | Ô JP | Loại | Nội dung VN | Nội dung JP | Cần sửa`, địa chỉ ô ghi đủ `<tab>!<ô>` và trích nguyên văn hai bản để mở Sheet sửa thẳng. Soát cả file thì lượt đầu in bảng kế hoạch, sau đó chạy từng lô 3–5 tab. Tab đã soát được nhớ lại (ui-next/data/translate-scan-state.json) nên lần sau tự bỏ qua — trừ khi bạn chỉ đích danh tab đó hoặc nói \"soát lại\". Field name, Spec-ID, link Figma không tính là chưa dịch. Mặc định chỉ đọc; nói \"ghi report\" thì Claude append vào file checklist chung, tab ChecklistAI — mỗi dòng một điểm lệch kèm link tới đúng tab VN/JP, cột Update để FALSE cho BSE tick.",
  placeholder: "Vd: cặp mobile, tab MOB-001 Login — JP đã dịch hết chưa?",
  editToggle: false,
  // Một lượt đọc 2 tab BD dài vài phút, hay xem trên điện thoại qua ngrok → route chạy
  // killOnDisconnect:false + job-lock theo runId nên bật reconnect (giống /kloc).
  reconnect: true,
  // /api/translate chạy cwd = ROOT (repo ai-agent) chứ không phải repo rezil → thư mục .jsonl do
  // `console` quyết định (xem ROOT_CWD_CONSOLES trong lib/sessions.js).
  params: { project: "rezil", console: "translate" },
  nav: [{ href: "/chat?project=rezil", label: "💬 Chat" }, { href: "/", label: "⌂ Home" }],
};

export default function Translate() {
  return <AgentConsole config={config} />;
}
