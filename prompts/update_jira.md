# Prompt: Update Jira

## Goal
Update a Jira ticket with progress, a comment, or a status transition.

## Input
- Jira ticket key (REZIL-XXXX)
- Action: comment / transition / edit field

## Config
- Site `rezil-electrical.atlassian.net`, project `REZIL` (see config/jira.json)

## Steps
1. Read current ticket state (status, assignee, links).
2. Add comment using **EXACTLY** `templates/jira_comment.md` — chỉ điền `{{pr_link}}` (PR URL, dạng markdown link `[url](url)` để Jira render click được) và `{{scope}}` (screen code / phạm vi), DROP các dòng `#` ghi chú. KHÔNG thêm root cause / mô tả fix / next step / prose ngoài template.
3. If transitioning status: confirm the target status is valid and intended **before** applying.
4. Keep comments factual; no timeline promises.
5. Comment tự do gửi 1 người (user yêu cầu nhắn/hỏi/phản hồi feedback, không phải comment PR ở bước 2): xưng hô theo cột *Xưng hô* ở `prompts/transition_assign.md` §Members — VD MinhLK "anh check giúp em…", DatHM "em check giúp anh…". Người chưa có trong bảng → không đoán anh/chị/em, viết trung tính.

## Output
- Confirmation of update + ticket link
