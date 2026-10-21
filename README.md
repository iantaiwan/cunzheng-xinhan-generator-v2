# 存證信函產生器

純前端、零第三方依賴的中華郵政存證信函排版工具。姓名、地址與信函正文只在目前瀏覽器頁面內處理，不會提交到伺服器。

- 線上版本：<https://iantaiwan.github.io/cunzheng-xinhan-generator-v2/>
- 也可下載整個儲存庫，直接開啟 `index.html` 離線使用。

## 目前功能

- 以中華郵政官方存證信函用紙（10206 版）向量圖為底圖，資料依官方座標疊印，版面與官方用紙一致。
- 正本頁圈選「正」、副本頁圈選「副」；表尾自動填入頁數與各類份數。
- 地址過長時自動縮小字級並換行；縮到最小仍放不下會提示另紙聯記。
- 字型依郵局官方存證信函用紙：官方 PDF 中文為標楷體，官方 ODT 範本格子為中文「標楷體」、英數「Times New Roman」、14pt，本工具照此設定。中文依序採用 Windows 標楷體（DFKai-SB）、macOS Kaiti TC／BiauKai、Linux 全字庫正楷體（TW-Kai）或文鼎 AR PL UKai；英數採用 Times New Roman，Linux 以字寬相容的 Liberation Serif／Tinos 代替。裝置未安裝楷書字型時（例如多數 Android 手機）會改用系統襯線字型，建議改用電腦列印。
- 每行 20 格、每頁 10 行，超過 200 字自動分頁。
- 支援正本、副本、加具正本與加具副本的列印份數。
- 寄件人、收件人及選填副本收件人資料。
- 姓名、地址、已填寫的郵遞區號、正文與份數的列印前驗證。
- 即時字數及頁數預估。
- 催告欠款、解除契約、退款、租賃及勞資爭議等一般草稿範本。
- 列印前自動重新產生，避免表單修改後誤印舊預覽。
- 使用瀏覽器原生列印功能輸出 PDF，不需上傳文件。

## 使用方式

1. 開啟線上版本，或下載後開啟 `index.html`。
2. 填寫寄件人、收件人與信函正文；必要時選用草稿範本。
3. 確認地址及姓名與交寄信封完全一致；若填寫郵遞區號，也請一併核對。
4. 按「產生預覽」檢查 A4 版面。
5. 按「驗證並列印／另存 PDF」。紙張選 A4、縮放 100%。頁面已設為零邊界，Chrome／Edge 不會印出網址、日期與頁碼；其他瀏覽器（如 Safari）若仍出現，請在列印設定關閉「頁首與頁尾」。
6. 依需要備妥正副本及每份附件，逐份簽名或蓋章後至辦理存證信函的郵局交寄。

郵局核對正副本內容後，才會編列存證號碼、填寫證明資訊並加蓋郵戳，因此工具會保留這些欄位空白。

## 隱私設計

- 不使用 `fetch`、`XMLHttpRequest`、`WebSocket`、分析工具或 Cookie。
- 不使用 CDN，所有程式與樣式都在儲存庫內。
- Content Security Policy 禁止頁面主動建立網路連線。
- 不使用 `localStorage` 或其他瀏覽器永久儲存空間。
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

### 程式結構

| 檔案 | 職責 |
|------|------|
| `logic.js` | 分頁、字數、驗證等純邏輯（無 DOM） |
| `form-layout.js` | 官方用紙座標與文字縮放計算（純資料與純函式，無 DOM） |
| `page-renderer.js` | 以底圖加座標產生頁面 DOM（不使用內嵌 style 屬性，符合 CSP） |
| `app.js` | 表單、驗證流程與事件 |
| `assets/official-form.svg` | 官方用紙第 1 頁轉出的向量底圖 |
| `tests/fixtures/official-10206.pdf` | 官方用紙原檔，作為視覺驗證基準 |

### 單元測試

不需安裝套件，使用 Node.js 內建測試工具：

```bash
node --test tests/logic.test.js tests/form-layout.test.js
```

### 列印版面視覺驗證

以官方 PDF 為基準，獨立檢查底圖一致性、每個字是否落在官方格子內、表頭與表尾位置、頁數與紙張尺寸。需要 Python 3、Playwright（含 Chromium）、pdfplumber、pypdf、Pillow 與 poppler-utils：

```bash
python3 tests/visual_check.py
```

### 重新產生底圖

官方用紙改版時，換掉 `tests/fixtures/official-10206.pdf` 後：

```bash
pdftocairo -svg -f 1 -l 1 tests/fixtures/official-10206.pdf form.svg
npx svgo --precision 2 --multipass -i form.svg -o assets/official-form.svg
```

並依新版 PDF 重新量測 `form-layout.js` 的座標，再跑上述兩項測試。
