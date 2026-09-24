# Prompt: Transition & Assign

## Goal
Chuyển status và/hoặc gán (assign) một ticket Jira cho ai đó — an toàn, đúng người, đúng trạng thái.

## Input
- Jira ticket key (REZIL-XXXX)
- Action: transition status / assign / cả hai
- Target status (nếu transition) — ví dụ `In Progress`, `Done`
- Assignee (nếu assign) — tên / email / account ID của người nhận

## Config
- Site `rezil-electrical.atlassian.net`, project `REZIL`, cloudId `171f4fa5-5402-4666-93b8-1be1f987006a`

## Quick-reference (cache 2026-07-23 — sample 100 ticket updated gần nhất; nếu thiếu thì resolve động)

**Statuses** (name — category): `To Do` (To Do) · `In Progress` (In Progress) · `IN REVIEW` (In Progress) · `FEEDBACK` (In Progress) · `Resolved` (In Progress) · `Closed` (Done)

**Members** (displayName → accountId → xưng hô khi comment/feedback; user = HTV - NghiaDV):
| displayName | accountId | Xưng hô (gọi / xưng) |
|---|---|---|
| HTV - NghiaDV | `712020:45fde756-10a1-407a-b5a3-c31e5ce014e2` | — (chính user) |
| HTV - MinhLK | `6073a74053cc0200695d7ff5` | anh / em |
| HTV - DatHM | `712020:27f63fec-e3be-4ae0-8d05-d449fed3c687` | em / anh |
| HTV - NamNP | `712020:412def16-f6a4-43d6-8ae0-a061731a526d` | em / anh |
| HTV - SonNV | `712020:41b7cbae-dc6b-499c-976e-2ac46c32ae98` | em / anh |
| HTV - NgocTTB | `712020:660743d0-8595-4d65-b2e3-0681e1ff41c1` | chị / em |
| HTV - YenLTB | `712020:8f7cfa81-453f-4aa7-832f-5d97172583f8` | chị / em |
| HTV - SiDD | `712020:9b1c636d-33f3-4ba9-9658-3486bfba985f` | anh / em |
| HTV - HuyenNT | `712020:9d25e9b9-705b-4a73-b4b1-6d965cc91224` | em / anh |
| HTV - AnhNDT | `712020:aed7a985-148f-4900-881b-fbf52b6c3339` | em / anh |
| HTV - HoaNT | `712020:cd69c28a-cf31-42c4-ae82-7e5efb9dd4a5` | chị / em |
| HTV - ManhLD | `712020:e6064957-b50b-45dc-9d3b-d475294d81ce` | em / anh |
| HTJ - BieuNV | `5ca17b9ea8d493261b3bb0c3` | anh / em |
| HTJ - AnhTT | `712020:d08565e9-e4d3-452f-8ea4-3be1311d4cf3` | anh / em |
| HTV - ChienLN | `712020:b21d9ebd-d643-4cc5-aebf-51f626297086` | anh / em |
| HTJ - TungDLT | `712020:bccf916f-a778-405e-90cf-57d4a49f4427` | em / anh |
| Nguyen Thuy Quynh（クイン） | `712020:b8540266-92a7-4f9b-a189-8c7e232a9181` | chị / em |

**Labels** (quét toàn bộ 309 ticket có label — count | label):
- Deploy/env: `staging-deployed` (75) · `dev1-deployed` (44) · `dev1-ready` (18) · `staging-ready` (3)
- Phase/sprint: `MVP2` (53) · `MVP2-B-Remaining` (33) · `RoC_Sprint_6` (18)
- Type: `Technical-Stuff` (52)
- Theo màn (ad-hoc, JP): `管理画面6画面③（マスター画面）9/9` (9) · `管理画面8画面①6/8` (5) · `管理画面5画面②` (4) · `管理画面8画面①（マスター画面）2/8` (2)

> **Xưng hô**: khi viết comment/feedback/lời nhắn gửi 1 người (Jira, PR, chat), gọi và xưng đúng cột *Xưng hô* — VD MinhLK (anh / em): "anh check giúp em…"; DatHM (em / anh): "em check giúp anh…". Người chưa có trong bảng → **KHÔNG đoán** anh/chị/em, viết câu trung tính không đại từ (hoặc hỏi user). Template cố định (`templates/jira_comment.md`, `Đã deploy DEV1/STG`) giữ nguyên, không chèn xưng hô.

> Tên/status/label không có trong bảng → **KHÔNG đoán**, dùng `lookupJiraAccountId` / `getTransitionsForJiraIssue` (label thì tra ticket tương tự hoặc hỏi user) để resolve động.

## Steps
1. **Read** current ticket state: status hiện tại, assignee hiện tại (`getJiraIssue`).
2. **Resolve assignee** (nếu assign): tra bảng Quick-reference trước → lấy accountId. Không có trong bảng thì `lookupJiraAccountId` từ tên/email. Nếu ra >1 kết quả hoặc không khớp rõ → **STOP & hỏi user** chọn đúng người, KHÔNG tự đoán.
3. **Resolve transition** (nếu transition): status hợp lệ xem bảng Quick-reference; luôn `getTransitionsForJiraIssue` để lấy transition ID hợp lệ từ status hiện tại. Nếu target status không nằm trong danh sách transition → STOP, báo các option hợp lệ.
4. **CONFIRM trước khi ghi**: liệt kê rõ `từ → đến` (status) và assignee mới `A → B`, chờ user xác nhận (theo hard rule: transition/assign là action ghi Jira).
5. **Execute**:
   - Assign: `editJiraIssue` field `assignee` = accountId (hoặc `transitionJiraIssue` kèm field nếu workflow yêu cầu).
   - Transition: `transitionJiraIssue` với transition ID đã resolve.
6. **KHÔNG** thêm comment/prose ngoài yêu cầu — chỉ transition + assign. Nếu user muốn kèm comment → theo `prompts/update_jira.md`.

## Output
- Xác nhận: status `cũ → mới`, assignee `cũ → mới` + ticket link
