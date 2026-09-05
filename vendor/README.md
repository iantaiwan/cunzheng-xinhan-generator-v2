# vendor/ — 選用的 OCR 引擎

這個資料夾預設是空的。**不放任何東西，工具的其他功能都正常運作**；
只有「掃描件／圖片匯入」需要 OCR 引擎。

## 為什麼不內建

離線中文 OCR 需要 wasm 執行檔與繁體中文語言模型，合計約 10MB 以上。
內建會讓儲存庫肥大；而從 CDN 載入則會違反本工具「零外部依賴、不主動連網」
的核心設計，也必須放寬 Content Security Policy。

折衷方式是：引擎由你自行放入本資料夾，工具在你實際按下「以 OCR 匯入」時
才從**同源**動態載入。CSP 仍維持 `script-src 'self'`，全程不連外網。

## 安裝步驟

1. 下載 [tesseract.js](https://github.com/naptha/tesseract.js) 的瀏覽器版檔案
   （`tesseract.min.js`、`worker.min.js`、`tesseract-core.wasm.js`）。
2. 下載繁體中文語言模型 `chi_tra.traineddata.gz`
   （來自 [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)）。
3. 把上述檔案全部放進這個資料夾。
4. 把下方的 `ocr-engine.js` 範本存成 `vendor/ocr-engine.js`。

安裝完成後重新整理頁面，「以 OCR 匯入」就會啟用。

## `ocr-engine.js` 範本

引擎只需要實作一個 `recognize(blob, options)` 函式並註冊：

```js
(function registerTesseractEngine() {
  'use strict';

  // tesseract.min.js 必須先載入，才會有全域的 Tesseract
  const script = document.createElement('script');
  script.src = 'vendor/tesseract.min.js';
  script.addEventListener('load', () => {
    window.CunzhengOcr.register({
      name: 'tesseract.js',
      async recognize(blob, options) {
        const worker = await Tesseract.createWorker(options.lang || 'chi_tra', 1, {
          workerPath: 'vendor/worker.min.js',
          corePath: 'vendor/tesseract-core.wasm.js',
          langPath: 'vendor/',            // 讀本機的 chi_tra.traineddata.gz
          logger: message => {
            if (message.status === 'recognizing text') options.onProgress(message.progress);
          }
        });
        try {
          const { data } = await worker.recognize(blob);
          return data.text;
        } finally {
          await worker.terminate();
        }
      }
    });
  });
  document.head.appendChild(script);
}());
```

## 注意事項

- OCR 只是辨識，**一定會有錯字**。存證信函的姓名、地址與金額只要一個字不同
  就可能造成退件或爭議，匯入後務必逐字核對。
- 掃描解析度建議 300 dpi 以上，並確保頁面擺正。
- 語言模型有 `tessdata_fast`（小、快）與 `tessdata_best`（大、準）兩種，
  可依需求選擇。
