"use client";

import AgentConsole from "../_components/AgentConsole";

// Console điều tra ticket (read-only). Cùng khung chat với /report & /rebase; agent đọc ticket qua
// MCP, trace code 4 repo rezil (grep + git log/blame), SELECT data QA — rồi trả ĐÚNG bảng 5 cột
// (Loại · Nguyên nhân · DEV tự đánh giá · SQA đánh giá · Phương án khắc phục lần tới), không tường thuật.
// Nhiều ticket trong 1 lượt → fan-out 1 subagent/ticket chạy song song. Xem /api/investigate +
// lib/investigate.js.
const EXAMPLES = [
  "REZIL-2352",
  "REZIL-2352, REZIL-2400, REZIL-2411",
  "Điều tra REZIL-2352 — vì sao số liệu màn EQUIP-003 lệch?",
  "REZIL-2400: lỗi này do commit nào gây ra? (git log/blame)",
  "Check data ở QA xem ticket này có bản ghi hỏng không",
  "Cho mình bản dán Jira của kết luận vừa rồi",
  "Bug cùng màn EQUIP-003 trước đây phân loại nguyên nhân thế nào?",
  "Còn phương án khắc phục nào ít rủi ro hơn không?",
  "Lập sheet degrade cho REZIL-2974",
  "Ghi kết quả vào sheet chất lượng cho REZIL-2352",
];

const config = {
  apiPath: "/api/investigate",
  storageKey: "investigate:console",
  accent: "blue",
  icon: "🔍",
  title: "Điều tra ticket",
  badge: "root cause · read-only",
  renderMarkdown: true,
  examples: EXAMPLES,
  emptyText:
    "Nhập REZIL-xxxx (nhiều ticket thì ngăn bằng dấu phẩy — mỗi ticket 1 subagent chạy SONG SONG, tối đa 5/đợt). Claude đọc ticket + comment, trace code 4 repo rezil, soi git log/blame, SELECT data QA — rồi trả về DUY NHẤT bảng 5 cột của sheet PM Quality Management: Loại (1 trong 8 nhãn: Logic/UI/Responsive/Bug duplicate/Bug common/Won't fix/User viewpoint/Canceled) · Nguyên nhân (1 trong 13 nhãn của team) · DEV tự đánh giá · SQA đánh giá · Phương án khắc phục lần tới (action cụ thể, cấm chung chung). Không giải thích gì thêm — cần giải thích / cách fix / bản dán Jira thì hỏi ở lượt sau. Xong bảng sẽ có gợi ý “Ghi kết quả vào sheet chất lượng cho REZIL-xxxx” — bấm thì mới điền 5 ô (Loại, Nguyên nhân, 2 cột đánh giá, Phương án) vào đúng dòng ticket ở tab Investigation, không đụng cột/dòng khác và không ghi đè ô đã có chữ. Nguyên nhân ra Degrade thì có thêm gợi ý “Lập sheet degrade” — bấm mới copy tab Template V1 trong sheet Degrade Investigation Ticket và điền theo kết quả điều tra. CHỈ ĐỌC (trừ 2 sheet nói trên): không sửa code, không tạo PR, không ghi Jira — fix thật thì qua màn Auto.",
  placeholder: "Vd: REZIL-2352 · hoặc nhiều ticket: REZIL-2352, REZIL-2400",
  editToggle: false,
  nav: [{ href: "/auto", label: "⚙️ Auto" }, { href: "/", label: "⌂ Home" }],
};

export default function Investigate() {
  return <AgentConsole config={config} />;
}
