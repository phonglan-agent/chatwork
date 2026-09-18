# AGENT_RULES

## Allowed

- Read Jira
- Read repository
- Create branch (`git switch -c <branch>` **before** the first edit — never edit/commit on `develop`)
- Edit code
- Run tests
- Build
- Commit (verify `git branch --show-current` ≠ `develop`/`main` first)
- Push — always `git push -u origin HEAD`; a bare `git push` on a branch with no upstream can land on `develop`
- Force-push your own branch (feature/fix, `release/*`) or a tag when needed
- Create PR
- Update Jira

## Forbidden

- Merge PR
- Deploy production
- Force-push `develop` / `main` (protected branches)
- Delete branches
- Rotate secrets
- Modify CI/CD without approval

## Failure Policy

If build/test fails:
- Stop.
- Report.
- Do not create PR.

## Chống degrade (áp cho MỌI thay đổi code, mọi route của UI agent)

Degrade = chức năng đang chạy đúng bị hỏng vì một thay đổi sau đó. Đây là nhóm lỗi tốn nhiều công
nhất vì build/test/typecheck vẫn pass. Rule dưới đây rút từ case đã dính, không phải quy tắc chung.

### Case đã dính (đọc trước khi sửa loại code tương ứng)

| Case | Điều đã xảy ra | Rule sinh ra |
|---|---|---|
| REZIL-2814, REZIL-3046 | Resolve conflict lấy nguyên một bên → mất `style=` / attribute; build + typecheck pass, chỉ hỏng hiển thị | 3, 5, 6 |
| REZIL-2669, REZIL-2335 | Re-apply code cũ thành vô hiệu vì component sinh selector đã không còn được render | 6 |
| REZIL-2303 | Sửa `diffFields` + cascade category làm mất giá trị field phụ thuộc ở luồng khác | 1, 2, 7 |
| REZIL-2128 | Thao tác chỉ upload/xoá file vẫn bump `updated_at` — side effect ngoài phạm vi thay đổi | 2, 7 |
| REZIL-2311, REZIL-2109, REZIL-2174 | Đổi query / permission check ở endpoint list làm sai kết quả cho role khác | 1, 6 |
| REZIL-2172 | Service worker cache-first `version.json` → admin 500 sau mỗi lần build | 1, 6 |

### Rule

1. **Xác định phạm vi ảnh hưởng TRƯỚC khi sửa.** Grep hết nơi dùng hàm / field / enum / component /
   query / index sắp sửa. Code dùng chung (util, shared component, repository, permission check, DTO,
   migration) → liệt kê các luồng khác đang gọi và ảnh hưởng dự kiến, rồi mới sửa.
2. **Sửa theo hướng cộng thêm.** Thêm nhánh điều kiện cho case mới thay vì đổi hành vi mặc định; giữ
   nguyên signature, giá trị mặc định, kiểu trả về, tính nullable. Buộc đổi hợp đồng dùng chung thì
   cập nhật HẾT caller trong cùng lần sửa.
3. **Không xoá thứ chưa hiểu.** `style=` / `class:` / attribute, guard `if`, normalize blank↔null,
   filter soft-delete, `ORDER BY`, try-catch phần lớn là dấu vết của bug đã fix. Thấy có vẻ dư →
   `git log -S '<đoạn code>'` / `git blame` xem commit nào thêm và vì sao; không tra được thì giữ lại.
4. **Không mở rộng scope.** Không refactor / rename / format lại phần ngoài chỗ cần sửa — formatter
   chạy toàn file là nguồn degrade khó thấy. Code cần dọn → ghi nhận, đề xuất thay đổi riêng.
5. **Đọc lại toàn bộ diff trước khi commit.** `git diff` từng hunk, mỗi dòng `-` phải là chủ ý. Hunk
   không giải thích được (editor / format / merge tự sinh) → hoàn nguyên đúng hunk đó rồi mới commit.
6. **Build/test pass không phải bằng chứng không degrade.** Degrade dạng hiển thị, nhãn i18n, quyền,
   thứ tự sort, cache đều pass compiler. Đổi UI → verify trên DOM/màn hình thật; đổi query/permission
   → chạy lại với ≥2 role và cả trường hợp dữ liệu rỗng; đổi API → kiểm caller cũ.
7. **Regression tối thiểu, nêu kết quả khi báo hoàn thành:** luồng vừa sửa + các luồng lân cận dùng
   chung code đó (list/detail/create/update), dữ liệu rỗng hoặc null, bản ghi đã soft-delete, và luồng
   history/audit nếu thay đổi chạm đường mutation.
8. **Không đủ dữ kiện để chắc là không degrade → dừng và báo** (flow tự động: khối `⛔ NEED-INFO:`),
   không đoán rồi sửa tiếp.

### Checklist trước khi mở PR

- [ ] Đã liệt kê caller / luồng khác dùng chung code vừa sửa
- [ ] Diff đọc lại từng hunk, không có dòng `-` ngoài chủ ý, không có format lại ngoài scope
- [ ] Build + test + typecheck pass
- [ ] Thay đổi UI: verify trên DOM/màn hình thật · thay đổi query/quyền: verify ≥2 role + dữ liệu rỗng
- [ ] Liệt kê các luồng lân cận đã test lại (regression tối thiểu)

> Prompt tương ứng cho agent: `NO_DEGRADE_SAFETY` trong `ui-next/lib/claude.js`, được nạp vào mọi flow
> có quyền sửa code (auto REZIL/feature, chat chế độ sửa code, rebase console, release console).

## Rebase & tích hợp code (rezil-esms / rezil-esms-lib / rezil-esms-mobile / rezil-esms-portal)

Rút ra từ điều tra REZIL-3046: nhánh `feature/mvp2-b` sống ~2 tháng, bị force-push nhiều lần
→ mất 9 vùng code ở 5 mốc rebase. Không lần nào compiler/typecheck báo lỗi.

### A. Trước khi rebase

1. **Không rebase nhánh dài / nhánh nhiều người cùng làm.** Nhánh có >1 người commit hoặc
   sống >1 tuần → dùng `git merge develop` thay vì rebase. Rebase chỉ dùng cho nhánh cá nhân,
   ngắn ngày, chưa ai pull.
2. **Ghi lại tip cũ trước khi rebase** để verify sau: `git rev-parse HEAD > /tmp/old_tip`
   (hoặc `git branch backup/<tên>-$(date +%m%d)` — rẻ và cứu được nhiều lần).
3. **Rebase định kỳ, đừng dồn.** 242 commit replay 1 lượt là điều kiện chắc chắn sót hunk.
   Nhánh dài thì đồng bộ base theo nhịp cố định (2–3 ngày/lần).
4. TUYỆT ĐỐI KHÔNG force-push `develop` / `main`. Force-push nhánh của mình thì được.

### B. Khi resolve conflict — luật quan trọng nhất

1. **Conflict rơi vào CÙNG 1 DÒNG mà hai bên sửa HAI KHÍA CẠNH khác nhau → PHẢI GHÉP TAY.**
   Cấm `git checkout --ours/--theirs`, cấm lấy nguyên khối một bên.

   Ví dụ thật (REZIL-2814, mất code không có cảnh báo):
   ```
   bên A đổi nội dung : {siteLocationName || 'ー'}  →  {siteLocationName ?? ''}
   bên B thêm style   : <td style="word-break: break-all;">
   resolve lấy bản A  : <td>{siteLocationName ?? ''}</td>          ← MẤT style của B
   bản ĐÚNG           : <td style="word-break: break-all;">{siteLocationName ?? ''}</td>
   ```
   Dạng hay mất nhất: `style=`, `class:`, attribute, CSS override, i18n label — build pass,
   typecheck pass, chỉ hỏng hiển thị.

2. **Đừng tin "commit của mình mới hơn thì an toàn".** Rebase replay theo THỨ TỰ NHÁNH,
   KHÔNG theo author-date. Commit viết trước vẫn có thể replay sau và thắng diff.
   Chính người chạy rebase cũng tự mất code của mình theo cách này.

3. Conflict ở file bị nhiều người sửa (FE Svelte page lớn, controller dùng chung) → resolve
   xong phải đọc lại toàn bộ vùng conflict, không chỉ vùng git đánh dấu.

### C. Sau khi rebase — bắt buộc verify, không được bỏ

1. Range-diff để xem có commit nào bị drop:
   ```bash
   OLD=<tip cũ>; NEW=HEAD; MB=$(git merge-base $OLD $NEW)
   git range-diff $MB..$OLD $MB..$NEW
   ```
   - `=` byte-identical → sạch, bỏ qua
   - `<` bị DROP HẲN → điều tra ngay (trừ khi commit đó đã vào develop qua PR riêng)
   - `!` bị viết lại → PHẢI đọc hunk thật, KHÔNG đoán (xem C.3)

2. Quét riêng dạng "mất attribute/style" — compiler không bắt được:
   ```bash
   git diff $OLD $NEW | grep -E '^-.*(style=|class:|word-break|text-align|aria-)'
   ```
   Mỗi dòng `-` phải có dòng `+` tương ứng chứa lại attribute đó.

3. Nếu nghi mất mà không chắc: **đếm signature tại từng tip**, đừng suy luận từ range-diff.
   ```bash
   git reflog show origin/<branch> --date=iso | awk '{print $1}' > /tmp/t
   git reflog show origin/<branch> --date=iso | grep -oE '\{[^}]+\}' | tr -d '{}' > /tmp/d
   paste /tmp/t /tmp/d | tac > /tmp/chrono          # cũ → mới
   while read rev dt; do
     n=$(git show "$rev:<path/to/file>" 2>/dev/null | grep -cE '<signature>')
     echo "$rev $dt count=$n"
   done < /tmp/chrono                                # count tụt về 0 ở đâu = mốc gây mất
   ```
   Kết quả nhị phân (còn/mất), không phụ thuộc cách đọc diff. Range-diff chỉ dùng SAU đó
   để biết mốc đó viết lại bao nhiêu commit và committer là ai (= người đã chạy rebase).

4. **Không tin phân tích static** khi khôi phục code UI. Re-apply nguyên văn code cũ có thể là
   NO-OP nếu vùng xung quanh đã redesign. Case REZIL-2669/2335: 4 selector gốc khớp **0 phần tử**
   trên DOM vì component sinh ra chúng đã thành orphan. Grep "class còn trong repo" là chưa đủ —
   phải kiểm tra component có được RENDER không, và verify bằng DOM thật
   (`document.querySelectorAll(...).length` + `getComputedStyle(...)`).

### D. Quy tắc git chung

1. Tạo branch TRƯỚC khi sửa file: sync base xong → `git switch -c <branch>` ngay.
   Không sửa/commit khi HEAD còn ở `develop`/`main`.
2. Trước mỗi commit: `git branch --show-current`, xác nhận khác base.
3. Push lần đầu: `git push -u origin HEAD`. KHÔNG `git push` trống, KHÔNG `git push origin`.
4. Sau push: `git rev-parse --abbrev-ref --symbolic-full-name @{u}` phải ra `origin/<branch>`.
   Nếu ra `origin/develop` → dừng, báo lại, không push tiếp.
5. Lỡ commit trên base (chưa push): `git switch -c <branch>` mang commit sang, rồi
   `git branch -f <base> origin/<base>`. KHÔNG dùng `git reset --hard`.
6. Lỡ push lên base: DỪNG NGAY, báo người dùng. Không tự revert/force-push base.

### E. Checklist ngắn (dán vào PR description khi có rebase)

- [ ] Đã ghi lại tip cũ / tạo backup branch trước rebase
- [ ] `git range-diff` — không có commit `<` bất thường, đã đọc hunk mọi commit `!`
- [ ] Đã grep dòng `-` mất `style=` / `class:` / attribute, mỗi dòng đều có `+` bù lại
- [ ] Build + typecheck pass (`npm run check` / `sbt compile`)
- [ ] Với thay đổi UI: đã verify trên DOM thật, không chỉ đọc code
