# 存證信函產生器

純前端、零第三方依賴的中華郵政存證信函排版工具。姓名、地址與信函正文只在目前瀏覽器頁面內處理，不會提交到伺服器。

- 線上版本：<https://iantaiwan.github.io/cunzheng-xinhan-generator/>
- 也可下載整個儲存庫，直接開啟 `index.html` 離線使用。

## 目前功能

- 依中華郵政存證信函用紙重建 A4 首頁版面。
- 每行 20 格、每頁 10 行，超過 200 字自動分頁。
- 支援正本、副本、加具正本與加具副本的列印份數。
- 寄件人、收件人及選填副本收件人資料。
- 姓名、地址、已填寫的郵遞區號、正文與份數的列印前驗證。
- 即時字數及頁數預估。
- 催告欠款、解除契約、退款、租賃及勞資爭議等一般草稿範本。
- 列印前自動重新產生，避免表單修改後誤印舊預覽。
- 使用瀏覽器原生列印功能輸出 PDF，不需上傳文件。
- 匯入既有存證信函並轉成文字：支援 Word（.docx）、ODF（.odt）、
  有文字圖層的 PDF、HTML 與純文字檔，可填回表單、下載 .txt 或直接複製。

## 使用方式

1. 開啟線上版本，或下載後開啟 `index.html`。
2. 填寫寄件人、收件人與信函正文；必要時選用草稿範本，
   或用「匯入既有存證信函」讀入舊檔後再修改。
3. 確認地址及姓名與交寄信封完全一致；若填寫郵遞區號，也請一併核對。
4. 按「產生預覽」檢查 A4 版面。
5. 按「驗證並列印／另存 PDF」。建議使用 A4、縮放 100%，並關閉瀏覽器頁首與頁尾。
6. 依需要備妥正副本及每份附件，逐份簽名或蓋章後至辦理存證信函的郵局交寄。

郵局核對正副本內容後，才會編列存證號碼、填寫證明資訊並加蓋郵戳，因此工具會保留這些欄位空白。

## 匯入既有存證信函

如果手邊已有排好版的存證信函，不必逐字重打。選擇檔案後，工具會判讀欄位與正文，
可以「填入表單」直接重新排版，或「下載 .txt」「複製文字」把內容帶到別處使用。

| 格式 | 支援情形 |
| --- | --- |
| Word `.docx`、ODF `.odt` | 支援。可讀出段落與 20 欄字格表格，並略過追蹤修訂的刪除文字 |
| PDF（有文字圖層） | 支援。涵蓋 FlateDecode 與 Type0/CID 字型的 ToUnicode 對照表 |
| HTML | 支援。本工具自己列印出的版面可完整還原 |
| 純文字 `.txt` | 支援 |
| 圖片、掃描的 PDF | 需另行安裝 OCR 引擎，見 [`vendor/README.md`](vendor/README.md) |

檔案只在目前瀏覽器頁面中解析，不會上傳；下載的 `.txt` 也是在本機產生。

### 匯入的可靠度

**自動判讀一定要逐字核對。** 姓名或地址只要一個字不同，就可能造成郵局退件或
日後爭議。填入表單的欄位會以虛線標示，提醒尚未核對。

已知的限制：

- 加密的 PDF、使用交叉參照物件串流（`/ObjStm`）的 PDF，以及沒有內嵌
  ToUnicode 對照表的子集化字型，都無法讀取；這些情況會明確報錯，不會輸出亂碼。
- 字格還原採「一列填滿 20 格代表軟換行」的規則。若原稿的段落長度剛好是 20 的
  倍數，該處的換行無法與軟換行區分——這是字格格式本身的先天限制。
- 掃描件的 OCR 一定會有錯字，只能當作重打的起點。

## 隱私設計

- 不使用 `fetch`、`XMLHttpRequest`、`WebSocket`、分析工具或 Cookie。
- 不使用 CDN，所有程式與樣式都在儲存庫內。
- Content Security Policy 禁止頁面主動建立網路連線。
- 不使用 `localStorage` 或其他瀏覽器永久儲存空間。
- 匯入的檔案完全在瀏覽器內解析，解壓縮使用瀏覽器原生的 `DecompressionStream`。
- 選用的 OCR 引擎只從同源的 `vendor/` 動態載入，CSP 仍維持 `script-src 'self'`。
- 上述每一項都有自動測試把關（`tests/privacy.test.js`），不只是文件宣稱。
- 線上版本仍需從 GitHub Pages 下載靜態檔案；若希望連頁面請求都不留下，請下載後離線使用。

## 重要限制

- 本工具只協助排版，範本也只是一般草稿，均不構成法律意見。
- 請替換範本內全部中括號欄位，並依個案事實與契約內容修改。
- 正式受理與法律效果仍以中華郵政現場審核、最新規章及個案情況為準。
- 如涉及重大金額、時效、契約解除、勞資或其他重要爭議，建議交由律師確認正文。

## 官方依據

- [中華郵政：自製存證信函格式說明與官方檔案](https://www.post.gov.tw/post/internet/Customer_service/index.jsp?ID=1610075122269&defaultAllOpen=1&sn=44FB8431-081E-41A6-AC7A-0E64CFECBD2C)
- [中華郵政：郵務營業規章第 112 至 120 條](https://www.post.gov.tw/post/internet/Law/index.jsp?ID=170301&ch_class_id=31)
- [中華郵政：國內函件資費](https://www.post.gov.tw/post/APP/a_mail/index.jsp?ID=12102)

本專案最後核對上述資料日期：2026-08-28。

## 開發與測試

不需安裝套件。使用 Node.js 內建測試工具即可執行邏輯測試：

```bash
node --test tests/*.test.js
```

測試涵蓋：

| 檔案 | 涵蓋範圍 |
| --- | --- |
| `logic.test.js` | 分頁邊界、強制換行、Unicode grapheme、郵遞區號、整數範圍、HTML escaping |
| `validation.test.js` | 必填、份數上下界、正副本合計上限、副本收件人連動、範本提醒 |
| `render.test.js` | 官方版面回歸（golden fixtures）、份數序列、逸出行為 |
| `zip.test.js` | ZIP 讀取、CRC32 校驗、損毀與截斷處理、XML 掃描器 |
| `importers.test.js` | `.docx`／`.odt` 抽取、字格辨識、欄位判讀 |
| `pdf.test.js` | PDF 內容串流、ToUnicode CMap、文字運算子、實際列印檔整合測試 |
| `dispatcher.test.js` | 格式判斷、大小上限、文字檔輸出、OCR 引擎介面 |
| `roundtrip.test.js` | 列印後再匯入，正文與所有欄位必須完全還原 |
| `privacy.test.js` | 禁用網路與永久儲存 API、CSP 指令、指令碼載入順序 |

`tests/fixtures/` 收錄重構前的實際渲染結果，作為版面回歸防護；
細節見 [`tests/fixtures/README.md`](tests/fixtures/README.md)。

Pull request 也會透過 GitHub Actions 自動執行語法檢查與全部測試。

## 架構

程式碼以模組拆分，與 DOM 無關的邏輯都可獨立測試：

| 模組 | 職責 |
| --- | --- |
| `logic.js` | 分頁、字元切分、驗證原語 |
| `validation.js` | 表單驗證、份數邊界、草稿範本 |
| `render.js` | 官方版面 HTML 產生 |
| `importers/zip.js` | ZIP 容器讀取與校驗 |
| `importers/xml-scan.js` | 不建構 DOM 的 XML 掃描 |
| `importers/ooxml.js` | `.docx`／`.odt` 文字抽取 |
| `importers/pdf-text.js` | PDF 文字圖層抽取 |
| `importers/html-letter.js` | HTML 版面讀取 |
| `importers/letter-parser.js` | 欄位與正文判讀、字格還原 |
| `importers/ocr.js` | 可插拔的 OCR 引擎介面 |
| `importers/index.js` | 依檔案內容派發到對應匯入路徑 |
| `app.js` | 表單的 DOM 讀寫與事件綁定 |
| `import-ui.js` | 匯入介面的 DOM 綁定 |

## 技術

- 原生 HTML、CSS、JavaScript
- 無框架、無套件管理器、無外部執行期依賴
- 解壓縮使用瀏覽器原生的 `DecompressionStream`
- 瀏覽器原生列印與 PDF 輸出

## 授權

[MIT License](LICENSE)
