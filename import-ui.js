(function initImportUi() {
  'use strict';

  const Importer = window.CunzhengImport;
  const Ocr = window.CunzhengOcr;
  const App = window.CunzhengApp;

  const fileInput = document.getElementById('importFile');
  const status = document.getElementById('importStatus');
  const panel = document.getElementById('importResult');
  const notesList = document.getElementById('importNotes');
  const output = document.getElementById('importText');
  const applyButton = document.getElementById('importApply');
  const downloadButton = document.getElementById('importDownload');
  const copyButton = document.getElementById('importCopy');

  const FIELD_LABELS = {
    senderName: '寄件人姓名', senderPostalCode: '寄件人郵遞區號', senderAddr: '寄件人地址',
    recvName: '收件人姓名', recvPostalCode: '收件人郵遞區號', recvAddr: '收件人地址',
    ccName: '副本收件人姓名', ccPostalCode: '副本收件人郵遞區號', ccAddr: '副本收件人地址',
    copyCount: '副本份數', attachCount: '附件張數',
    extraOriginal: '加具正本份數', extraCopy: '加具副本份數'
  };

  let lastResult = null;

  function setStatus(text) {
    status.textContent = text;
  }

  function renderNotes(notes) {
    notesList.replaceChildren();
    notes.forEach(note => {
      const item = document.createElement('li');
      item.textContent = note;
      notesList.appendChild(item);
    });
  }

  function showResult(result, filename) {
    lastResult = result;
    output.value = Importer.toPlainTextFile(result);

    const recognised = Object.keys(FIELD_LABELS)
      .filter(key => result.fields[key] !== '' && result.fields[key] !== null && result.fields[key] !== undefined);

    renderNotes([
      `來源：${filename}（判讀為${result.kindLabel}）`,
      `判讀出 ${recognised.length} 個欄位、正文 ${result.content.length} 字。`,
      ...result.notes,
      '所有自動判讀的內容都必須逐字核對，姓名或地址有誤會造成郵局退件。'
    ]);

    panel.hidden = false;
    setStatus('匯入完成，請核對下方內容。');
  }

  function fail(error) {
    lastResult = null;
    panel.hidden = true;
    renderNotes([]);
    setStatus(`匯入失敗：${error && error.message ? error.message : '未知錯誤'}`);
  }

  async function handleFile(file) {
    if (!file) return;
    setStatus(`正在讀取「${file.name}」…`);
    panel.hidden = true;
    try {
      const result = await Importer.importFile(file, {
        onProgress: ratio => setStatus(`OCR 辨識中… ${Math.round(ratio * 100)}%`)
      });
      showResult(result, file.name);
    } catch (error) {
      fail(error);
    }
  }

  function applyToForm() {
    if (!lastResult) return;
    const values = { ...lastResult.fields };
    const applied = App.setFormValues(values);
    App.setContent(lastResult.content);

    const names = applied.map(id => FIELD_LABELS[id] || id);
    App.notice(
      applied.length > 0
        ? `已填入 ${applied.length} 個欄位（${names.join('、')}）與正文，請逐項核對後再產生預覽。`
        : '已填入正文；未能判讀任何欄位，請自行填寫。'
    );
    setStatus('已填入表單，欄位以虛線標示為待核對。');
  }

  function downloadText() {
    if (!lastResult) return;
    // 全程在瀏覽器內產生檔案，不經過任何伺服器。
    const blob = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'cunzheng-letter.txt';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // 立即 revoke 會讓部分瀏覽器來不及取得檔名甚至中斷下載，因此延後釋放。
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setStatus('已產生 .txt 檔。');
  }

  async function copyText() {
    if (!lastResult) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(output.value);
      } else {
        // file:// 或非安全內容下 Clipboard API 不可用，退回選取複製
        output.focus();
        output.select();
        if (!document.execCommand('copy')) throw new Error('複製指令被拒絕');
      }
      setStatus('已複製到剪貼簿。');
    } catch {
      output.focus();
      output.select();
      setStatus('無法自動複製，文字已選取，請按 Ctrl+C（macOS 為 ⌘+C）。');
    }
  }

  fileInput.addEventListener('change', event => {
    const [file] = event.target.files || [];
    handleFile(file);
    // 清空以便重新選擇同一個檔案時仍會觸發
    event.target.value = '';
  });

  applyButton.addEventListener('click', applyToForm);
  downloadButton.addEventListener('click', downloadText);
  copyButton.addEventListener('click', copyText);

  if (!Ocr.isRegistered()) {
    const hint = document.getElementById('importOcrHint');
    if (hint) hint.textContent = '圖片與掃描件需要另行安裝 OCR 引擎，詳見 vendor/README.md。';
  }
}());
