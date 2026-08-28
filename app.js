(function initApp() {
  'use strict';

  const Logic = window.CunzhengLogic;
  const form = document.getElementById('letterForm');
  const pagesRoot = document.getElementById('pages');
  const validationSummary = document.getElementById('validationSummary');
  const editorStatus = document.getElementById('editorStatus');
  const dirtyNotice = document.getElementById('dirtyNotice');
  const contentStats = document.getElementById('contentStats');
  const contentInput = document.getElementById('content');
  const templateSelect = document.getElementById('template');
  const printButton = document.getElementById('printButton');

  const ROW_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const TRACKED_FIELD_IDS = [
    'senderName', 'senderPostalCode', 'senderAddr',
    'recvName', 'recvPostalCode', 'recvAddr',
    'ccName', 'ccPostalCode', 'ccAddr',
    'copyCount', 'attachCount', 'extraOriginal', 'extraCopy', 'content'
  ];

  const TEMPLATES = Object.freeze({
    debt: `主旨：催告返還欠款\n\n一、台端於[借款日期]向本人借款新臺幣[金額]元，雙方約定於[清償日期]前返還，惟迄今尚未清償。\n二、請台端於收受本函後[天數]日內，將前述款項匯至[付款方式或帳戶資訊]。\n三、逾期仍未清償時，本人將依法主張權利，相關費用及責任並由台端負擔。`,
    termination: `主旨：解除契約通知\n\n一、本人與台端於[簽約日期]就[契約名稱或標的]成立契約。\n二、因[具體違約事實]，本人曾於[催告日期]催告台端於期限內履行，惟期限屆滿仍未改善。\n三、本人爰以本函通知解除前述契約，並請於[日期]前返還[款項、物品或文件]。`,
    refund: `主旨：請求退款\n\n一、本人於[交易日期]向台端購買[商品或服務]，已支付新臺幣[金額]元。\n二、因[退款事由及相關事實]，本人已於[聯絡日期]提出退款要求，迄今仍未處理。\n三、請於收受本函後[天數]日內退還新臺幣[金額]元，並以[退款方式]辦理。`,
    lease: `主旨：終止租賃契約通知\n\n一、雙方就坐落於[租賃標的地址]之房屋訂有租賃契約，租期自[起日]至[迄日]。\n二、依契約第[條次]條及[終止事由]，本人以本函通知於[終止日期]終止租賃關係。\n三、請於前述日期前完成點交、返還鑰匙及結清應付款項。`,
    labor: `主旨：勞資爭議事項通知\n\n一、本人自[到職日期]起任職於台端，擔任[職務]。\n二、就[薪資、加班費、資遣費或其他事項]，截至[日期]尚有新臺幣[金額]元未獲給付。\n三、請於收受本函後[天數]日內依法給付並提供相關明細；逾期未處理，本人將循勞資爭議調解或其他法定程序處理。`
  });

  let lastRenderedSignature = '';

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

  function signatureFor(data) {
    return JSON.stringify(data);
  }

  function addRequiredError(errors, data, key, id, label) {
    if (!data[key]) errors.push({ id, message: `請填寫${label}。` });
  }

  function validateData(data) {
    const errors = [];
    const warnings = [];

    addRequiredError(errors, data, 'senderName', 'senderName', '寄件人姓名或名稱');
    addRequiredError(errors, data, 'senderPostalCode', 'senderPostalCode', '寄件人郵遞區號');
    addRequiredError(errors, data, 'senderAddr', 'senderAddr', '寄件人詳細地址');
    addRequiredError(errors, data, 'recvName', 'recvName', '收件人姓名或名稱');
    addRequiredError(errors, data, 'recvPostalCode', 'recvPostalCode', '收件人郵遞區號');
    addRequiredError(errors, data, 'recvAddr', 'recvAddr', '收件人詳細地址');

    if (data.senderPostalCode && !Logic.isPostalCode(data.senderPostalCode)) {
      errors.push({ id: 'senderPostalCode', message: '寄件人郵遞區號須為 3、5 或 6 碼數字。' });
    }
    if (data.recvPostalCode && !Logic.isPostalCode(data.recvPostalCode)) {
      errors.push({ id: 'recvPostalCode', message: '收件人郵遞區號須為 3、5 或 6 碼數字。' });
    }

    const hasAnyCc = Boolean(data.ccName || data.ccPostalCode || data.ccAddr);
    if (hasAnyCc) {
      addRequiredError(errors, data, 'ccName', 'ccName', '副本收件人姓名或名稱');
      addRequiredError(errors, data, 'ccPostalCode', 'ccPostalCode', '副本收件人郵遞區號');
      addRequiredError(errors, data, 'ccAddr', 'ccAddr', '副本收件人詳細地址');
      if (data.ccPostalCode && !Logic.isPostalCode(data.ccPostalCode)) {
        errors.push({ id: 'ccPostalCode', message: '副本收件人郵遞區號須為 3、5 或 6 碼數字。' });
      }
    }

    if (!data.content.trim()) {
      errors.push({ id: 'content', message: '請填寫信函正文。' });
    }
    if (data.content.length > 5000) {
      errors.push({ id: 'content', message: '信函正文不得超過 5,000 個字元。' });
    }

    const copyCount = Logic.parseBoundedInteger(data.copyCountRaw, 1, 10);
    const attachCount = Logic.parseBoundedInteger(data.attachCountRaw, 0, 100);
    const extraOriginal = Logic.parseBoundedInteger(data.extraOriginalRaw, 0, 20);
    const extraCopy = Logic.parseBoundedInteger(data.extraCopyRaw, 0, 20);

    if (copyCount === null) errors.push({ id: 'copyCount', message: '副本份數須為 1 至 10 的整數。' });
    if (attachCount === null) errors.push({ id: 'attachCount', message: '附件張數須為 0 至 100 的整數。' });
    if (extraOriginal === null) errors.push({ id: 'extraOriginal', message: '加具正本份數須為 0 至 20 的整數。' });
    if (extraCopy === null) errors.push({ id: 'extraCopy', message: '加具副本份數須為 0 至 20 的整數。' });

    if (copyCount !== null && extraOriginal !== null && extraCopy !== null && 1 + copyCount + extraOriginal + extraCopy > 20) {
      errors.push({ id: 'copyCount', message: '本次列印的正副本合計不得超過 20 份。' });
    }

    if (/\[[^\]]+\]/.test(data.content)) {
      warnings.push('正文仍含有中括號範本欄位，請確認已全部替換。');
    }

    return {
      errors,
      warnings,
      normalized: {
        ...data,
        copyCount: copyCount ?? 0,
        attachCount: attachCount ?? 0,
        extraOriginal: extraOriginal ?? 0,
        extraCopy: extraCopy ?? 0
      }
    };
  }

  function clearValidationState() {
    TRACKED_FIELD_IDS.forEach(id => {
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

  function addressText(postalCode, address) {
    return [postalCode, address].filter(Boolean).join('　');
  }

  function buildPartyRow(index, label, name, postalCode, address, requiresSeal) {
    const seal = requiresSeal ? '　（印）' : '';
    return `<div class="party-row">
      <div class="party-row__label">${index}、${label}</div>
      <div class="party-row__content">
        <div>姓名：${Logic.escapeHtml(name)}${seal}</div>
        <div>詳細地址：${Logic.escapeHtml(addressText(postalCode, address))}</div>
      </div>
    </div>`;
  }

  function buildOfficialHeader(data) {
    return `<div class="official-header">
      <div class="document-box">
        <div class="document-box__office">　　　　郵局</div>
        <div class="document-box__number"><span>存證信函第</span><span>　　　　　號</span></div>
      </div>
      <div class="parties-box">
        <div class="organization-note">〈寄件人如為機關、團體、學校、公司、商號請加蓋單位圖章及法定代理人簽名或蓋章〉</div>
        ${buildPartyRow('一', '寄件人', data.senderName, data.senderPostalCode, data.senderAddr, true)}
        ${buildPartyRow('二', '收件人', data.recvName, data.recvPostalCode, data.recvAddr, false)}
        ${buildPartyRow('三', '副本收件人', data.ccName, data.ccPostalCode, data.ccAddr, false)}
        <div class="overflow-note">（本欄姓名、地址不敷填寫時，請另紙聯記）</div>
      </div>
    </div>`;
  }

  function buildGrid(pageRows) {
    let html = '<table class="official-grid"><thead><tr><th class="axis-cell"><span class="axis-cell__grid">格</span><span class="axis-cell__row">行</span></th>';
    for (let column = 1; column <= Logic.COLS_PER_ROW; column += 1) {
      html += `<th>${column}</th>`;
    }
    html += '</tr></thead><tbody>';
    pageRows.forEach((row, rowIndex) => {
      html += `<tr><td class="row-label">${ROW_LABELS[rowIndex]}</td>`;
      row.forEach(character => {
        html += `<td>${Logic.escapeHtml(character)}</td>`;
      });
      html += '</tr>';
    });
    return `${html}</tbody></table>`;
  }

  function buildLowerSection(data, totalPages) {
    return `<div class="official-lower">
      <div class="lower-left">
        <div class="fee-cert">
          <div class="fee-lines">
            <div>本存證信函共 ${totalPages} 頁，正本 1 份，存證費　　　元，</div>
            <div>副本 ${data.copyCount} 份，存證費　　　元，</div>
            <div>附件 ${data.attachCount} 張，存證費　　　元，</div>
            <div>加具正本 ${data.extraOriginal} 份，存證費　　　元，</div>
            <div class="fee-lines__wide">加具副本 ${data.extraCopy} 份，存證費　　　元，合計　　　元。</div>
          </div>
          <div class="cert-line">
            <span>經　　　　郵局　　　年　　月　　日證明　本內容完全相同</span>
            <span>郵戳　　經辦員　　主管　　（印）</span>
          </div>
        </div>
        <div class="notes-box">
          <div class="notes-label"><span>備</span><span>註</span></div>
          <div class="notes-content">
            <p>一、存證信函需送交郵局辦理證明手續後始有效，自交寄之日起由郵局保存之副本，於三年期滿後銷燬之。</p>
            <p>二、在　頁　行第　格下塗改增刪　字　印（如有修改應填註本欄並蓋用寄件人印章，但塗改增刪每頁至多不得逾二十字）。</p>
            <p>三、每件一式三份，用不脫色筆或打字機複寫，或書寫後複印、影印，每格限書一字，色澤明顯、字跡端正。</p>
          </div>
        </div>
      </div>
      <div class="postage-box">
        <div class="postage-box__top"><span>黏</span><span>貼</span></div>
        <div class="postage-box__middle">郵票或郵資券</div>
        <div class="postage-box__bottom"><span>處</span><span></span></div>
      </div>
    </div>`;
  }

  function buildPage(data, pageRows, totalPages, copyLabel) {
    const copyCharacters = Logic.splitGraphemes(copyLabel).map(character => `<span>${Logic.escapeHtml(character)}</span>`).join('');
    return `<article class="print-page" aria-label="${Logic.escapeHtml(copyLabel)}存證信函">
      <div class="official-form">
        <div class="official-title">郵局存證信函用紙</div>
        <div class="copy-mark" aria-hidden="true">${copyCharacters}</div>
        ${buildOfficialHeader(data)}
        ${buildGrid(pageRows)}
        ${buildLowerSection(data, totalPages)}
        <div class="seam-row"><span>騎縫郵戳</span><span>騎縫郵戳</span></div>
      </div>
    </article>`;
  }

  function renderPages(data) {
    const contentPages = Logic.paginateContent(data.content);
    const copySets = ['正本'];

    for (let index = 0; index < data.copyCount; index += 1) copySets.push('副本');
    for (let index = 0; index < data.extraOriginal; index += 1) copySets.push('正本');
    for (let index = 0; index < data.extraCopy; index += 1) copySets.push('副本');

    let html = '';
    copySets.forEach(copyLabel => {
      contentPages.forEach(pageRows => {
        html += buildPage(data, pageRows, contentPages.length, copyLabel);
      });
    });
    pagesRoot.innerHTML = html;
    return { pageCount: contentPages.length, copySetCount: copySets.length };
  }

  function generatePreview(options = {}) {
    const { focusOnError = true } = options;
    const data = getFormData();
    const validation = validateData(data);
    showValidationErrors(validation.errors, focusOnError);

    if (validation.errors.length > 0) {
      document.body.classList.add('print-blocked');
      editorStatus.textContent = '資料尚未通過檢查，未更新預覽。';
      return false;
    }

    const result = renderPages(validation.normalized);
    lastRenderedSignature = signatureFor(data);
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
    const currentSignature = signatureFor(getFormData());
    dirtyNotice.hidden = currentSignature === lastRenderedSignature;
  }

  function printDocument() {
    if (!generatePreview({ focusOnError: true })) return;
    requestAnimationFrame(() => window.print());
  }

  function applyTemplate() {
    const selected = templateSelect.value;
    if (!selected || !TEMPLATES[selected]) return;

    if (contentInput.value.trim() && !window.confirm('套用範本會取代目前正文，確定繼續嗎？')) {
      templateSelect.value = '';
      return;
    }

    contentInput.value = TEMPLATES[selected];
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
    generatePreview({ focusOnError: false });
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('print-blocked');
  });

  pagesRoot.innerHTML = '<div class="empty-preview no-print">填妥資料後按「產生預覽」，此處會顯示正式 A4 版面。</div>';
  updateContentStats();
}());
