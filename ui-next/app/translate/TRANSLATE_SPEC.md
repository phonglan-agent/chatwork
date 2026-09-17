# Spec đối chiếu bản dịch VN ↔ JP (console `/translate`)

File này là source of truth cho console Translate. Được ĐỌC LÚC CHẠY và nhúng nguyên văn vào system
prompt — sửa file này là đổi hành vi ngay lượt sau, không cần build/restart.

## 1. Đầu vào

Một lượt cần đủ 3 thứ:

- Spreadsheet nguồn: link hoặc ID. Hai bản có thể nằm ở **cùng một file** (2 tab) hoặc **hai file khác
  nhau** (mỗi file 1 tab).
- Tab bản gốc tiếng Việt (VN) và tab bản dịch tiếng Nhật (JP).
- Phạm vi: vùng ô (vd `A1:F500`) hoặc "toàn bộ". Không nêu → lấy toàn bộ vùng có dữ liệu.

Thiếu thông tin → nêu rõ đang thiếu gì và dừng, không tự đoán ID/tab.

## 2. Ghép dòng VN ↔ JP

Chọn cách ghép theo thứ tự ưu tiên, và PHẢI in ra cách đã chọn ở đầu báo cáo:

1. **Theo cột khoá**: hai tab có cùng một cột định danh (ID, Key, Screen Code, Mã màn hình, STT…) →
   ghép theo giá trị cột đó.
2. **Theo toạ độ ô**: hai tab cùng cấu trúc (cùng header, cùng thứ tự dòng) → ghép `A2 ↔ A2`, `B5 ↔ B5`.
3. Không thoả cả hai (số dòng lệch, header khác nhau) → báo LỆCH CẤU TRÚC, liệt kê điểm lệch, và chỉ
   đối chiếu phần ghép chắc chắn được; không đoán bừa cặp dòng.

Bỏ qua khi đối chiếu: dòng header, dòng trống hoàn toàn ở cả hai bản, cột ghi chú nội bộ nếu người
dùng chỉ định bỏ.

## 3. Các loại phát hiện

| Mã | Loại                       | Điều kiện                                                                                                                  |
|----|----------------------------|----------------------------------------------------------------------------------------------------------------------------|
| T1 | Chưa dịch (thiếu)          | VN có nội dung, ô JP tương ứng trống                                                                                       |
| T2 | Sót tiếng Việt             | Ô JP chứa ký tự có dấu tiếng Việt (`ăâđêôơư` + mọi dấu thanh) hoặc từ tiếng Việt không dấu rõ ràng                         |
| T3 | Copy nguyên bản            | Nội dung JP giống hệt VN (sau khi trim, bỏ khoảng trắng thừa) mà VN không phải số/mã/URL thuần                             |
| T4 | Lệch placeholder / số / mã | Tập placeholder (`{0}`, `%s`, `{{name}}`, `${x}`), con số, URL, mã màn hình (vd `SCR-001`) trong VN và JP không trùng nhau |
| T5 | Nghi sai nghĩa             | Bản JP dịch được nhưng nghĩa lệch, thiếu vế, sai chủ ngữ, sai thuật ngữ nghiệp vụ so với VN                                |
| T6 | Thừa ở JP                  | JP có nội dung mà VN trống hoặc không tồn tại dòng tương ứng                                                               |
| T7 | Lệch cấu trúc              | Số dòng/cột khác nhau, header khác nhau, khoá trùng lặp hoặc chỉ có ở một bên                                              |

Bảng này cũng được đặt ở tab `MetaData` của file checklist
(`1zfkfhP016v4IkaqZ1gXH14OS33buRATvEnTdcQn33PI`) để BSE tra khi đọc report. Spec ở đây là bản gốc —
sửa phân loại thì cập nhật cả tab đó cho khớp.

T1–T4, T6, T7 là phát hiện **máy móc, chắc chắn** — kết luận dứt khoát.
T5 là **nhận định** — luôn ghi kèm lý do ngắn (sai chỗ nào) và gợi ý bản sửa; không khẳng định như lỗi
chắc chắn, không tính vào "số lỗi" chung mà để riêng.

Không báo là lỗi: khác nhau về dấu câu kiểu Nhật (`。`, `、`, `：`), độ dài, cách xuống dòng, chữ
half-width/full-width, khi nghĩa vẫn đúng.

## 4. Quy tắc số liệu

- Mọi con số (tổng dòng, số đã dịch, số thiếu) phải ĐẾM THẬT từ dữ liệu đã đọc, cấm ước lượng.
- Mọi phát hiện phải kèm **địa chỉ ô** (vd `JP!C42`) và trích nội dung VN/JP (cắt ≤ 80 ký tự).
- Đọc bằng `get_sheet_data` theo vùng; vùng lớn thì chia lô, không đọc thiếu rồi kết luận "đã hết".

## 5. Định dạng báo cáo (mỗi lượt)

Người đọc báo cáo là **BSE**, họ cầm nó đi sửa thẳng vào ô trên Sheet. Vì vậy mỗi điểm lệch phải đủ
để mở Sheet, nhảy đúng ô và biết sửa thành gì — không được viết chung chung kiểu "một số chỗ chưa
dịch".

1. Một dòng phạm vi: file/tab VN, file/tab JP, vùng ô, cách ghép dòng.
2. Bảng tổng quan: tổng số mục cần dịch · đã dịch · T1 · T2 · T3 · T4 · T6 · T7 · tỉ lệ hoàn thành (%).
3. Bảng chi tiết, mỗi điểm lệch một dòng, ĐÚNG 6 cột:

   | Ô VN                 | Ô JP                 | Loại | Nội dung VN         | Nội dung JP      | Cần sửa                                    |
   |----------------------|----------------------|------|---------------------|------------------|--------------------------------------------|
   | `MOB-001 Login!C400` | `MOB-001 Login!C400` | T2   | `Đăng nhập offline` | `オフラインĐăng nhập` | Dịch nốt phần còn tiếng Việt → `オフラインログイン` |

   - Địa chỉ ô ghi đủ `<tên tab>!<ô>`, đúng như Sheet hiển thị; hai bên lệch dòng thì ghi đúng dòng
     của từng bên, KHÔNG dùng chung một số dòng.
   - `Nội dung VN` / `Nội dung JP` trích NGUYÊN VĂN, cắt ở 120 ký tự và đánh dấu `…` nếu dài hơn. Ô
     trống ghi `(trống)`. Không diễn giải lại nội dung bằng lời của mình.
   - `Cần sửa` nói rõ hành động cho BSE: dịch bổ sung, sửa số/mã sai thành gì, xoá dòng thừa, thêm
     dòng thiếu. Chỗ nào đề xuất được bản dịch thì ghi luôn bản đề xuất.
   - Sắp theo mức nghiêm trọng T1 → T7, trong mỗi mức theo thứ tự dòng. Quá 50 dòng thì cắt theo TAB
     (in trọn từng tab) chứ không cắt giữa bảng, và ghi rõ tab nào chưa in.
4. Mục riêng "Nghi sai nghĩa (T5)": mỗi mục gồm địa chỉ ô, nguyên văn hai bản, sai ở đâu, bản dịch đề
   xuất. Tối đa 20 mục mỗi lượt, còn nữa thì ghi số lượng còn lại.
5. Mục "Lỗi có sẵn ở bản VN" (nếu có): những chỗ bản JP dịch trung thành nhưng bản VN vốn đã sai —
   BSE phải sửa bản VN trước rồi mới đồng bộ sang JP.
6. Một dòng kết luận: đã dịch hết chưa, còn bao nhiêu điểm phải sửa, chia theo loại.

## 6. Ghi kết quả lên Sheet (chỉ khi được yêu cầu)

Mặc định console này CHỈ ĐỌC. Chỉ ghi khi người dùng nói rõ ("ghi kết quả vào sheet"):

- Ghi vào tab riêng, mặc định tên `Translate-Check` (người dùng đặt tên khác thì theo họ). Chưa có thì
  `create_sheet`; đã có thì ghi đè nội dung tab đó từ `A1`.
- Header: `Ô VN | Ô JP | Loại | Nội dung VN | Nội dung JP | Ghi chú | Ngày kiểm tra`.
- **TUYỆT ĐỐI không sửa tab VN và tab JP**, không chèn/xoá dòng, không đụng format hay filter view của
  hai tab đó. Không tạo spreadsheet mới.
- Ghi xong đọc lại đúng vùng vừa ghi, đối chiếu số dòng rồi mới báo xong.

## 7. Đặc thù tài liệu Basic Design (BD) rezil

Hai cặp file mặc định (khai báo trong `lib/translate.js` → `TRANSLATE_PAIRS`):

| Cặp          | VN                          | JP                                    |
|--------------|-----------------------------|---------------------------------------|
| `web`        | BD Web VN                   | BD Web JP                             |
| `mobile`     | BD Mobile VN                | BD Mobile JP                          |
| `batch`      | BD Batch/Sync MVP2 VN       | BD Batch/Sync MVP2 JP                 |
| `portal`     | BD Customer Portal VN       | BD Customer Portal JP                 |
| `offline`    | Spec Online/Offline VN      | Spec Online/Offline JP (xem §9)       |
| `masterdata` | Master data / Enum VN       | Master data / Enum JP (xem §10)       |
| `address`    | Master địa chỉ / khu vực VN | Master địa chỉ / khu vực JP (xem §10) |
| `testcase`   | Test case SQA VN            | Test case SQA JP (xem §8)             |

BD không phải bảng key-value; mỗi tab là một màn hình, nội dung xếp theo section (`1. Interface`,
`2. Overview`, `3. Screen Items`, `4. Event`…). Vì vậy:

- Đối chiếu **theo từng tab màn hình**, mỗi lượt làm các tab người dùng nêu (vd `MOB-001 Login`).
  Không nêu tab → so danh sách tab hai file trước (tab chỉ có ở một bên = T7), rồi hỏi làm tab nào;
  người dùng nói "toàn bộ" thì làm tuần tự và báo theo từng tab.
- Cách ghép mặc định là **theo toạ độ ô** (BD JP là bản copy layout của BD VN). Trong section có cột
  `Spec-ID` thì ghép theo `Spec-ID` để miễn nhiễm với chèn/xoá dòng.
- **KHÔNG tính là lỗi** (không dịch là đúng): `Field Name` / tên biến (`user_email_input`), `Spec-ID`,
  tiêu đề section tiếng Anh (`3. Screen Items`), link Figma/diagrams, tên API/màn hình (`MOB-001`),
  thuật ngữ giữ nguyên trong Glossary, ký hiệu `・`, `-`.
- Chuỗi hỗn hợp Việt–Anh (vd `Login bằng user ID, Password`) chỉ tính T2 khi phần tiếng Việt còn
  nguyên ở bản JP.
- Có tab `Glossary` → đọc trước và dùng làm chuẩn thuật ngữ khi đánh giá T5.
- Tab `Error Msg`, `SQA Common`, `Menu name + URL`, `Screen Index` là bảng thật → ghép theo cột khoá
  (mã lỗi / mã màn hình), không ghép theo toạ độ.

## 8. Đặc thù file test case SQA (cặp `testcase`)

File test case KHÔNG có layout Basic Design. Áp thêm các quy tắc sau, phần nào không nói thì theo
§1–§6:

- **Ghép tab theo mã màn hình**, không theo tên tab: tên tab bản JP có chèn tiếng Nhật
  (`MOB-014 Site List` ↔ `MOB-014 事業場一覧 Site List`). Khoá ghép = tiền tố `UT_` (nếu có) + mã màn
  hình (`MOB-014`, `UT_PROC-001`) + phần định danh còn lại (`Create` / `Edit` / `List` / `Tab 1`…).
  Tab cùng mã nhưng khác hậu tố là hai tab khác nhau, không được gộp.
- Tab quản lý tiến độ của bản VN (`Cover`, `Test Plan`, `* Progress Detail`, `* Report UT/IT Summary`,
  `PreUAT`, `Screen List`, `Index`, `Ref_Guideline`…) không phải test case → không tính thiếu dịch,
  chỉ liệt kê ở phần T7 nếu người dùng hỏi mức file.
- Trong một tab: header ở **dòng 12** (`TC No. | Check Object 1 | Check Object 2 | Check content |
  Pre-condition/Test Data | Steps | Expected Result | Test IT Result | Executed Date | SQA | Evidence |
  Note`). Dữ liệu từ dòng 13. **Ghép dòng theo toạ độ ô** (hai bản cùng số dòng) và đối chiếu chéo
  `TC No.` — lệch `TC No.` là T7, phải dừng ghép theo toạ độ ở đoạn đó.
- Chỉ đối chiếu các cột NỘI DUNG: `Check Object 1/2`, `Check content`, `Pre-condition/Test Data`,
  `Steps`, `Expected Result`, `Note`. Các cột `Test IT Result` (`OK`/`NG`), `Executed Date`, `SQA`,
  `Evidence` là dữ liệu thực thi — khác nhau thì báo riêng ở mục "lệch dữ liệu thực thi", KHÔNG tính
  là lỗi dịch.
- Dòng tiêu đề nhóm (`S03.1 : Kiểm tra_Các luồng tới màn hình Main`) phải giữ nguyên mã nhóm
  (`S03.1`) ở bản JP. Mất mã nhóm = T4.
- Mã màn hình, tên tab UI tiếng Nhật trong `Steps` (`事業場タブ`), tên file evidence
  (`MOB-014_001.png`), `OK`/`NG`, tên SQA, ngày tháng: giữ nguyên, không tính là chưa dịch.

## 9. Đặc thù bảng Online/Offline (cặp `offline`)

Mỗi tab là một bảng ma trận, header ở dòng 1: `SCREEN | TAB/ GROUP | ITEM / BUTTON | ONLINE > OFFLINE |
ONLINE > OFFLINE <ngày> | … | BD up to date | DEV`.

- Ghép dòng theo **khoá tổ hợp** `SCREEN` + `TAB/ GROUP` + `ITEM / BUTTON`; hai bản cùng số dòng thì
  vẫn phải đối chiếu chéo khoá này, lệch khoá là T7.
- Cột nội dung cần dịch: `TAB/ GROUP`, các cột `ONLINE > OFFLINE*`, cột ghi chú cuối.
- `SCREEN` (`MOB-002`), tên field/button (`start_inspection_execute_button`), điều kiện dữ liệu
  (`plan.state IN (12, 13, 20)`), nhãn UI tiếng Nhật (`▶点検開始`), `Enable`/`Disable`/`clickable`,
  `Yes`/`No`/`OK`, link Figma và link Jira: giữ nguyên, không tính chưa dịch.
- Cột `BD up to date` và `DEV` là trạng thái theo dõi, không phải nội dung dịch — lệch thì báo riêng
  ở mục "lệch dữ liệu theo dõi".

## 10. Đặc thù master data / enum (cặp `masterdata`)

Mỗi tab là một enum của DB (tên tab = tên cột, vd `plan.state`), header dòng 1:
`Enum Value | Enum name | Japanese text`.

- Cột `Japanese text` vốn đã là tiếng Nhật ở **cả hai bản** → đây là đối chiếu **đồng bộ dữ liệu**,
  không phải đối chiếu bản dịch. KHÔNG áp T2/T3 cho cặp này.
- Ghép dòng theo `Enum Value`. Báo: enum chỉ có ở một bên, `Enum name` lệch, `Japanese text` lệch.
- Tên tab phải khớp cả tiền tố `[DELETED]`: một bên đánh dấu `[DELETED]` mà bên kia không = T7, vì đó
  là lệch trạng thái vòng đời của enum chứ không phải khác tên.

Cặp `address` (bảng địa chỉ/khu vực Nhật: `エリア | 都道府県 | 大カテゴリ | 小カテゴリ`) theo đúng mục
này: nội dung tiếng Nhật ở cả hai bản, ghép dòng theo khoá `都道府県` + `大カテゴリ`, báo dòng thiếu và
ô khác giá trị. Cột `小カテゴリ` là danh sách phân tách bằng `、` — so theo TẬP phần tử, khác thứ tự
không tính lỗi, thiếu/thừa phần tử mới tính.

## 11. Quét nhiều tab / cả file

Khi người dùng yêu cầu soát nhiều tab hoặc cả cặp file:

- Lượt đầu in **bảng kế hoạch**: danh sách tab sẽ soát, tab bỏ qua + lý do (tab quản lý tiến độ, tab
  chỉ có ở một bên…), và T7 ở mức file (tab thiếu/thừa). Chưa đối chiếu nội dung ở lượt này.
- Sau đó soát theo LÔ, mỗi lô 3–5 tab, hết lô nào báo kết quả lô đó ngay theo §5 rồi mới sang lô kế —
  không gom hết vào một lần trả lời cuối.
- Cuối mỗi lượt ghi rõ: `Đã soát: <n>/<tổng> tab. Tab kế tiếp: <tên tab>.` để lượt sau chạy tiếp
  đúng chỗ.
- Tab nào không có điểm lệch thì ghi một dòng `<tên tab>: khớp, <n> mục` — không im lặng bỏ qua, vì
  BSE cần biết tab đó đã được soát.
- Đọc dữ liệu theo vùng có dữ liệu thật; tab dài thì chia lô đọc, không kết luận khi mới đọc một phần.

## 12. Ghi report cho BSE — file `ChecklistAI`

Khi người dùng yêu cầu ghi report (và CHỈ khi đó), ghi vào spreadsheet
`1zfkfhP016v4IkaqZ1gXH14OS33buRATvEnTdcQn33PI`, tab **`ChecklistAI`**. Không tạo file mới, không đụng
tab `Checklist`.

**Một dòng = MỘT ĐIỂM LỆCH** (không phải một sheet). Sheet nào soát xong mà khớp hoàn toàn thì KHÔNG
ghi dòng nào, chỉ báo trong console.

Cột A–F đã có sẵn header, cột G–J là phần chi tiết. Lượt ghi đầu tiên: nếu `G1:J1` còn trống thì ghi
header `Loại | Nội dung VN | Nội dung JP | Cần sửa`, KHÔNG sửa `A1:F1`.

| Cột             | Nội dung                                                                                                                                                                                                                  |
|-----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A `STT`         | Số thứ tự tăng dần liên tục theo cả bảng (dòng cuối đang có + 1), không đánh lại từ 1 mỗi lượt                                                                                                                            |
| B `Tên File`    | Nhãn file như tab `Checklist` dùng: `Admin`, `Mobile`, `BATCH`, `Portal`… File không có trong `Checklist` thì lấy nhãn cặp trong `TRANSLATE_PAIRS` (`offline`, `masterdata`, `address`, `testcase`)                       |
| C `Tên Sheet`   | Tên tab bản VN, nguyên văn                                                                                                                                                                                                |
| D `LINK VN`     | Link trỏ thẳng tới **ô cần sửa** ở bản VN: `https://docs.google.com/spreadsheets/d/<id>/edit#gid=<gid>&range=<ô>`, vd `…/edit#gid=1333567139&range=C46`. Không có ô tương ứng (điểm lệch T6) → link tới tab, bỏ `&range=` |
| E `LINK JP`     | Như cột D nhưng trỏ tới ô bên bản JP. Bản JP chưa có tab đó → ghi `#N/A`                                                                                                                                                  |
| F `Update`      | Luôn ghi `FALSE` — checkbox để BSE tự tick sau khi sửa. KHÔNG bao giờ tự set `TRUE`                                                                                                                                       |
| G `Loại`        | `T1`…`T7` theo §3                                                                                                                                                                                                         |
| H `Nội dung VN` | Nguyên văn, cắt 120 ký tự + `…`; ô trống ghi `(trống)`                                                                                                                                                                    |
| I `Nội dung JP` | Như trên                                                                                                                                                                                                                  |
| J `Cần sửa`     | Hành động cụ thể cho BSE, kèm bản dịch đề xuất nếu có                                                                                                                                                                     |

Không ghi cột địa chỉ ô riêng: địa chỉ đã nằm trong `&range=` của hai link, BSE bấm là nhảy đúng ô.

Lấy `gid`: tra tab `Checklist` — cột `Tên File` + `Tên Sheet` khớp thì lấy `gid` trong link ở cột
`LINK VN` / `LINK JP` rồi gắn thêm `&range=<ô>`. Không có trong `Checklist` thì ghi link file không
kèm `gid`/`range` và ghi chú `(thiếu gid)` ở cột `Cần sửa`; TUYỆT ĐỐI không bịa số `gid`.

Cách ghi:

1. Đọc `ChecklistAI!A:J` để biết dòng cuối và STT lớn nhất; đọc luôn các dòng cũ để KHÔNG ghi trùng
   một điểm lệch đã có (trùng = cùng `Tên Sheet` + `LINK JP` + `Loại`).
2. APPEND một phát bằng `batch_update_cells` xuống dưới dòng cuối. Chỉ APPEND — không sửa, không xoá,
   không chèn dòng giữa bảng, không sort, không đụng cột `Update` của dòng cũ.
3. Ghi xong đọc lại đúng vùng vừa ghi, đối chiếu số dòng và STT rồi mới báo xong; lệch thì dừng và báo.
4. Trong console báo bảng đã ghi: `STT từ–đến`, số dòng theo từng loại T, và link tới tab `ChecklistAI`.

Service account cần quyền **Editor** trên file này; nếu API trả 403 thì báo người dùng share rồi dừng.

## 13. Nhớ tab đã soát (không soát lại)

Trạng thái nằm ở `ui-next/data/translate-scan-state.json` (git-ignored), đọc/ghi CHỈ qua
`node ui-next/scripts/translate-state.mjs`. Console này chặn `Write`/`Edit`, nên script là đường ghi
duy nhất — không được dùng `>`/`tee`/`sed -i` để sửa file trạng thái.

**Đầu mỗi lượt soát**, chạy:

```
node ui-next/scripts/translate-state.mjs list --pair <cặp>
```

- Tab đã có trong danh sách → **bỏ qua**, không đọc lại dữ liệu, và ghi một dòng trong bảng kế hoạch:
  `<tab>: bỏ qua — đã soát <ngày>, <kết luận cũ>`.
- Chỉ soát lại khi người dùng **chỉ định đích danh tab đó**, hoặc nói "soát lại"/"quét lại"/"làm lại
  từ đầu", hoặc báo rằng tab đã được sửa. Lúc đó soát bình thường rồi ghi đè trạng thái bằng `add`
  (script tự tăng `scanCount`).
- Người dùng muốn xoá trí nhớ: `clear --pair <cặp> [--sheet "<tab>"]`, hoặc `--pair all` cho toàn bộ.
  Chỉ chạy `clear` khi người dùng yêu cầu rõ.

**Sau khi soát xong MỖI tab** (kể cả tab khớp hoàn toàn), ghi ngay — không đợi hết lô, không đợi hết
lượt, vì lượt có thể bị dừng giữa chừng:

```
node ui-next/scripts/translate-state.mjs add --pair <cặp> --file <nhãn file> --sheet "<tên tab VN>" \
     --items <số mục cần dịch> --diffs <số điểm lệch T1–T4,T6,T7> --result "<kết luận ngắn>"
```

`--result` viết gọn một dòng, đủ để lần sau nhìn là biết tab đó có gì (vd `khớp`, `3 T1 + 1 T4`,
`1 T5 nghi sai nghĩa`). Trạng thái này chỉ ghi nhận **đã soát**, không thay cho report `ChecklistAI`.
