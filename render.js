(function initCunzhengRender(root, factory) {
  const logic = (typeof module === 'object' && module.exports)
    ? require('./logic.js')
    : root.CunzhengLogic;
  const api = factory(logic);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengRender = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createRender(Logic) {
  'use strict';

  const ROW_LABELS = Object.freeze(['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']);

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

  // 依份數決定每一份的標示：正本 1 份固定在前，其後依序為副本、加具正本、加具副本。
  function buildCopySets(data) {
    const copySets = ['正本'];
    for (let index = 0; index < data.copyCount; index += 1) copySets.push('副本');
    for (let index = 0; index < data.extraOriginal; index += 1) copySets.push('正本');
    for (let index = 0; index < data.extraCopy; index += 1) copySets.push('副本');
    return copySets;
  }

  function buildDocument(data) {
    const contentPages = Logic.paginateContent(data.content);
    const copySets = buildCopySets(data);

    let html = '';
    copySets.forEach(copyLabel => {
      contentPages.forEach(pageRows => {
        html += buildPage(data, pageRows, contentPages.length, copyLabel);
      });
    });

    return { html, pageCount: contentPages.length, copySetCount: copySets.length };
  }

  return Object.freeze({
    ROW_LABELS,
    addressText,
    buildCopySets,
    buildDocument,
    buildGrid,
    buildLowerSection,
    buildOfficialHeader,
    buildPage,
    buildPartyRow
  });
}));
