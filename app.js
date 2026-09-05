(function initApp() {
  'use strict';

  const Logic = window.CunzhengLogic;
  const Validation = window.CunzhengValidation;
  const Render = window.CunzhengRender;

  const form = document.getElementById('letterForm');
  const pagesRoot = document.getElementById('pages');
  const validationSummary = document.getElementById('validationSummary');
  const editorStatus = document.getElementById('editorStatus');
  const dirtyNotice = document.getElementById('dirtyNotice');
  const contentStats = document.getElementById('contentStats');
  const contentInput = document.getElementById('content');
  const templateSelect = document.getElementById('template');
  const printButton = document.getElementById('printButton');

  let lastRenderedSignature = '';
  // printDocument() 已自行驗證並重繪，beforeprint 不需要再做一次。
  let skipNextBeforePrint = false;

  function readValue(id) {
    return document.getElementById(id).value.trim();
  }

  function getFormData() {
    return {
      senderName: readValue('senderName'),
      senderPostalCode: readValue('senderPostalCode'),
      senderAddr: readValue('senderAddr'),
      recvName: readValue('recvName'),
      recvPostalCode: readValue('recvPostalCode'),
      recvAddr: readValue('recvAddr'),
      ccName: readValue('ccName'),
      ccPostalCode: readValue('ccPostalCode'),
      ccAddr: readValue('ccAddr'),
      copyCountRaw: readValue('copyCount'),
      attachCountRaw: readValue('attachCount'),
      extraOriginalRaw: readValue('extraOriginal'),
      extraCopyRaw: readValue('extraCopy'),
      content: contentInput.value
    };
  }

  function clearValidationState() {
    Validation.FIELD_IDS.forEach(id => {
      document.getElementById(id).removeAttribute('aria-invalid');
    });
    validationSummary.hidden = true;
    validationSummary.replaceChildren();
  }

  function showValidationErrors(errors, focusFirst) {
    clearValidationState();
    if (errors.length === 0) return;

    const title = document.createElement('strong');
    title.textContent = `請先修正 ${errors.length} 個欄位：`;
    const list = document.createElement('ul');

    errors.forEach(error => {
      const field = document.getElementById(error.id);
      field.setAttribute('aria-invalid', 'true');
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${error.id}`;
      link.textContent = error.message;
      link.addEventListener('click', event => {
        event.preventDefault();
        field.focus();
      });
      item.appendChild(link);
      list.appendChild(item);
    });

    validationSummary.append(title, list);
    validationSummary.hidden = false;
    if (focusFirst) validationSummary.focus();
  }

  function generatePreview(options = {}) {
    const { focusOnError = true } = options;
    const data = getFormData();
    const validation = Validation.validateData(data);
    showValidationErrors(validation.errors, focusOnError);

    if (validation.errors.length > 0) {
      document.body.classList.add('print-blocked');
      editorStatus.textContent = '資料尚未通過檢查，未更新預覽。';
      return false;
    }

    const result = Render.buildDocument(validation.normalized);
    pagesRoot.innerHTML = result.html;

    lastRenderedSignature = Validation.signatureFor(data);
    dirtyNotice.hidden = true;
    document.body.classList.remove('print-blocked');
    clearValidationState();

    const warningText = validation.warnings.length > 0 ? ` ${validation.warnings.join(' ')}` : '';
    editorStatus.textContent = `已產生 ${result.copySetCount} 份、共 ${result.copySetCount * result.pageCount} 張 A4 預覽。${warningText}`;
    return true;
  }

  function updateContentStats() {
    const count = Logic.countCharacters(contentInput.value);
    const pageCount = Logic.countPages(contentInput.value);
    contentStats.textContent = `${count.toLocaleString('zh-TW')} 字・預估 ${pageCount} 頁`;
  }

  function markPreviewDirty() {
    updateContentStats();
    if (!lastRenderedSignature) return;
    dirtyNotice.hidden = Validation.signatureFor(getFormData()) === lastRenderedSignature;
  }

  function printDocument() {
    if (!generatePreview({ focusOnError: true })) return;
    skipNextBeforePrint = true;
    requestAnimationFrame(() => window.print());
  }

  function applyTemplate() {
    const selected = templateSelect.value;
    if (!selected || !Validation.TEMPLATES[selected]) return;

    // 無論套用或取消都把下拉選單歸零，讓同一個範本可以重複套用。
    templateSelect.value = '';

    if (contentInput.value.trim() && !window.confirm('套用範本會取代目前正文，確定繼續嗎？')) return;

    contentInput.value = Validation.TEMPLATES[selected];
    markPreviewDirty();
    editorStatus.textContent = '已帶入範本草稿；請替換所有中括號欄位。';
    contentInput.focus();
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    generatePreview({ focusOnError: true });
  });

  form.addEventListener('input', markPreviewDirty);
  templateSelect.addEventListener('change', applyTemplate);
  printButton.addEventListener('click', printDocument);

  window.addEventListener('beforeprint', () => {
    // 使用者直接按 Ctrl+P 時仍需驗證並重繪，避免印出過期或未通過檢查的內容。
    if (skipNextBeforePrint) {
      skipNextBeforePrint = false;
      return;
    }
    generatePreview({ focusOnError: false });
  });
  window.addEventListener('afterprint', () => {
    skipNextBeforePrint = false;
    document.body.classList.remove('print-blocked');
  });

  // 提供給匯入模組的最小接縫：只暴露「填入欄位」與「顯示訊息」，
  // 不讓外部模組碰到內部狀態或直接操作預覽。
  window.CunzhengApp = Object.freeze({
    /**
     * 把判讀出來的欄位填入表單，並標記為待人工核對。
     * @param {Record<string, string|number|null>} values
     * @returns {string[]} 實際被填入的欄位 id
     */
    setFormValues(values) {
      const applied = [];
      Object.entries(values || {}).forEach(([id, value]) => {
        if (!Validation.FIELD_IDS.includes(id)) return;
        if (value === null || value === undefined || value === '') return;
        const field = document.getElementById(id);
        if (!field) return;
        field.value = String(value);
        field.dataset.imported = 'true';
        applied.push(id);
      });
      updateContentStats();
      markPreviewDirty();
      return applied;
    },

    setContent(text) {
      contentInput.value = String(text ?? '');
      contentInput.dataset.imported = 'true';
      updateContentStats();
      markPreviewDirty();
    },

    clearImportedMarks() {
      Validation.FIELD_IDS.forEach(id => {
        const field = document.getElementById(id);
        if (field) delete field.dataset.imported;
      });
    },

    notice(text) {
      editorStatus.textContent = String(text ?? '');
    }
  });

  // 使用者手動改過的欄位就不再標示為「匯入待核對」
  form.addEventListener('input', event => {
    if (event.target && event.target.dataset) delete event.target.dataset.imported;
  });

  pagesRoot.innerHTML = '<div class="empty-preview no-print">填妥資料後按「產生預覽」，此處會顯示正式 A4 版面。</div>';
  updateContentStats();
}());
