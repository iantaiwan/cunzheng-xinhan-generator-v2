# 版面基準檔（golden fixtures）

`*.html` 是**重構前**的 `app.js` 在 Chromium 中實際產生的 `#pages` DOM，
由 `_input.json` 的四組輸入渲染而成：

| 檔案 | 涵蓋情境 |
| --- | --- |
| `basic.html` | 單頁、含郵遞區號、無副本 |
| `multipage.html` | 201 字跨頁、郵遞區號留白 |
| `withCopies.html` | 副本 2 份 + 加具正副本各 1 份、含副本收件人、使用者換行 |
| `escaping.html` | 姓名／地址／正文含 `< > & " '` 的逸出行為 |

這些檔案的用途是**格式回歸防護**：`tests/render.test.js` 會比對 `render.js`
的輸出，任何改動只要讓官方版面產生差異就會讓測試失敗。

## 為什麼比對前要正規化

fixture 是瀏覽器序列化後的結果。瀏覽器在**文字節點**中會把 `&quot;` 與
`&#039;` 還原成 `"` 與 `'`（兩者語意相同），因此 `render.js` 的原始字串與
fixture 在這兩個字元上會有寫法差異。測試在比對前對雙方套用同一組還原規則，
這只是比對用的正規化，不是安全性判準——逸出行為由 `render.test.js` 中的
專門測試把關。

## 如何重新產生

**只有在確定要變更官方版面時才重新產生。** 這些檔案的價值在於它們記錄了
變更前的樣子；隨手覆蓋等於讓防護失效。需要更新時，請用瀏覽器開啟
`index.html`，依 `_input.json` 填入資料、按「產生預覽」，再把
`document.getElementById('pages').innerHTML` 存回對應檔案，並在 commit
訊息中說明版面為何改變。
