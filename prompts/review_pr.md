# Prompt: Review PR

## Mục tiêu
Review diff để tìm lỗi đúng/sai, degrade và lệch convention. Kết quả chỉ mang tính tham khảo — người
review quyết định và merge. Dùng cho cả review PR của người khác lẫn agent tự review trước khi mở PR
(Fix-Bug bước review, Feature Phase 15).

## Đầu vào
- PR link / branch + repo
- Ticket REZIL-XXXX (nếu có) — đọc trước để biết phạm vi mong muốn

## Cách đọc diff
1. Lấy diff theo merge-base: `git fetch origin && git diff origin/develop...HEAD` (3 chấm). Không so với
   đầu nhánh `develop` — sẽ lẫn commit của người khác.
2. Liệt kê file thay đổi (`git diff --stat`) và đối chiếu với phạm vi ticket trước khi đọc chi tiết.
3. Đọc cả đoạn code xung quanh mỗi hunk (hàm chứa nó, caller, hàm được gọi), không chỉ đọc dòng đổi.

## Mức độ nghiêm trọng

| Mức | Khi nào dùng |
|---|---|
| **Blocking** | Sai logic, degrade chức năng đang chạy, lỗ hổng bảo mật, sai dữ liệu / migration, lệch API contract |
| **Should-fix** | Sai convention của repo, thiếu case biên có khả năng xảy ra, thiếu evidence cho thay đổi UI / quyền |
| **Nit** | Đặt tên, chính tả, comment. Tối đa 5 mục; bỏ lỗi formatter/linter đã bắt |

## Bằng chứng cho mỗi lỗi (bắt buộc)
- Mỗi lỗi gồm: `file:line` · vấn đề · **kịch bản lỗi** (input / state nào → output sai) · đề xuất sửa.
- Chưa kiểm chứng được (chưa grep caller, chưa đọc hàm được gọi, chưa xem schema) → ghi **"Cần xác minh"**,
  không xếp vào Blocking.
- Không bịa API / field / rule nghiệp vụ. Không chắc hành vi mong muốn → hỏi, không kết luận là lỗi.

## Checklist

### 1. Phạm vi
- [ ] Không có file thừa (file debug, lockfile, file generate ngoài ý muốn)
- [ ] Không format lại cả file, không rename / refactor ngoài chỗ cần sửa
- [ ] Không đụng component / code dùng chung khi chưa confirm (rule "Hạn chế sửa component chung" trong
      `~/.claude/agents/dev-master.md`)

### 2. Degrade (xem `AGENT_RULES.md` §Chống degrade)
- [ ] Mỗi dòng `-` là chủ ý. Guard `if`, `style=` / attribute, filter soft-delete, `ORDER BY`, normalize
      blank↔null, try-catch bị xoá → tra `git log -S '<đoạn code>'`; không rõ lý do thì báo Blocking
      (REZIL-2814, REZIL-3046)
- [ ] Code dùng chung (util, shared component, repository, permission check, DTO) → đã grep và liệt kê caller,
      signature / giá trị mặc định / nullable giữ nguyên hoặc đã sửa hết caller (REZIL-2303)
- [ ] Đổi query / permission ở endpoint list → đúng với ≥2 role và dữ liệu rỗng (REZIL-2311, REZIL-2109)

### 3. Tính đúng
- [ ] null / rỗng / blank↔null; danh sách rỗng; bản ghi đã soft-delete
- [ ] Nhánh lỗi của `EitherT` / `Future` được xử lý, không nuốt lỗi
- [ ] Điều kiện biên (off-by-one, timezone, định dạng ngày / số điện thoại)
- [ ] Thao tác đồng thời / gọi lặp (double submit, race khi update)

### 4. Database
- [ ] Query mới có index khớp `WHERE + ORDER BY` (REZIL-2312, REZIL-2178)
- [ ] Không bump `updated_at` ngoài phạm vi thao tác (REZIL-2128)
- [ ] Mọi đường mutation đều ghi `entity_change_history` (REZIL-2150)
- [ ] Migration chạy lại được / không phá dữ liệu cũ; có flag nếu cần sửa `rezil-esms-lib`

### 5. Convention (xem `memory/coding_style.md`)
- **BE**: không `var` / `return` / `while` / `asInstanceOf` (scalafix); lỗi qua `EitherT`; DI Guice
  `@Inject()`; model request ở `model/reads/`, response ở `model/writes/<domain>/`
- **FE**: text qua key i18n, không hardcode; gọi API qua Aspida, không `fetch` tay; component đúng tầng
  `atoms|molecules|organisms`; Svelte 5 theo cú pháp đang dùng trong file xung quanh
- Không thêm comment vô nghĩa, không null-check phòng hờ

### 6. API contract
- [ ] OpenAPI ↔ BE ↔ FE ↔ Aspida đồng bộ; đổi OpenAPI thì đã regen Aspida và sửa caller cũ

### 7. Bảo mật
- [ ] Endpoint mới / sửa có kiểm tra quyền
- [ ] Không log secret, token, PII; không có credential trong diff
- [ ] `./semgrep-rules/scan.sh` sạch

### 8. Cache / deploy
- [ ] Metadata version (`version.json`) đi network-first trong service worker (REZIL-2172)

### 9. PR có resolve conflict
- [ ] Áp checklist `AGENT_RULES.md` §Rebase mục C — hunk conflict không lấy nguyên một bên

### 10. Kiểm chứng
- [ ] BE `sbt scalafmtCheckAll "scalafix --check"` + `sbt compile`; FE `npm run check` + `npm run build` —
      đã chạy thật, không suy đoán
- [ ] Thay đổi UI có evidence trên màn hình thật; thay đổi quyền / query có kết quả với ≥2 role

## Tránh báo lỗi thừa
- Không đề xuất refactor ngoài phạm vi — đưa vào mục riêng **"Gợi ý ngoài scope"**, không xếp mức.
- Không đòi null-check phòng hờ cho giá trị đã được đảm bảo không null.
- Không báo lại lỗi formatter / linter đã bắt.
- Không lặp một lỗi ở nhiều chỗ — gom thành một mục, liệt kê các `file:line`.

## Đầu ra (tiếng Việt)

```
### Blocking
| file:line | Vấn đề | Kịch bản lỗi | Đề xuất sửa |

### Should-fix
| file:line | Vấn đề | Kịch bản lỗi | Đề xuất sửa |

### Nit
- file:line — ...

### Cần xác minh
- file:line — điều chưa kiểm chứng + cách kiểm

### Gợi ý ngoài scope
- file:line — ...

### Kết luận
approve-with-comments | request-changes (tham khảo) — 1-2 câu lý do
Checklist đã chạy: <build/check/semgrep: PASS/FAIL/chưa chạy>
```

Mục không có lỗi thì ghi "Không có".

## Không được làm
- Không merge, không approve PR thay người review.
- Không post comment lên GitHub / Jira khi chưa được confirm.
- Không tự sửa code trong lúc review — chỉ báo lỗi (trừ khi được yêu cầu sửa).
