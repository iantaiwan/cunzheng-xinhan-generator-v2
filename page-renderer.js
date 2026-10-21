(function initPageRenderer(root) {
  'use strict';

  /*
   * 以官方用紙向量圖為底，依 form-layout.js 的座標疊上資料。
   * 位置與字級一律以 pt 換算成「頁寬比例」（--pt 變數），螢幕預覽與列印尺寸一致。
   * 只用 DOM API 與 element.style 設定，不產生內嵌 style 屬性，符合 CSP style-src 'self'。
   */
  const BACKGROUND_SRC = 'assets/official-form.svg';

  function createRenderer(layout, splitGraphemes) {
    function pt(value) {
      return `calc(var(--pt) * ${value})`;
    }

    function placeBox(element, box) {
      element.style.left = pt(box.x);
      element.style.top = pt(box.y);
      element.style.width = pt(box.width);
      element.style.height = pt(box.height);
    }

    function textBox(doc, className, box, text, fontSize) {
      const element = doc.createElement('div');
      element.className = `form-text ${className}`;
      placeBox(element, box);
      element.style.fontSize = pt(fontSize);
      element.textContent = text;
      return element;
    }

    function fieldBox(doc, key, text, warnings) {
      const box = layout.FIELDS[key];
      const fitted = layout.fitText(text, box);
      if (!fitted.fits) warnings.add(key);
      const element = doc.createElement('div');
      element.className = 'form-text form-field';
      placeBox(element, box);
      element.style.fontSize = pt(fitted.fontSize);
      fitted.lines.forEach(line => {
        const span = doc.createElement('span');
        span.textContent = line;
        element.appendChild(span);
      });
      return element;
    }

    function addressText(postalCode, address) {
      return [postalCode, address].filter(Boolean).join(' ');
    }

    function copyMark(doc, copyLabel) {
      const mark = layout.COPY_MARKS[copyLabel];
      if (!mark) return null;
      const element = doc.createElement('div');
      element.className = 'copy-ring';
      element.setAttribute('aria-hidden', 'true');
      placeBox(element, { x: mark.cx - mark.r, y: mark.cy - mark.r, width: mark.r * 2, height: mark.r * 2 });
      return element;
    }

    function buildPage(doc, data, pageRows, totalPages, copyLabel, warnings) {
      const page = doc.createElement('article');
      page.className = 'print-page';
      page.setAttribute('aria-label', `${copyLabel}存證信函`);

      const background = doc.createElement('img');
      background.className = 'form-background';
      background.src = BACKGROUND_SRC;
      background.alt = '';
      page.appendChild(background);

      const ring = copyMark(doc, copyLabel);
      if (ring) page.appendChild(ring);

      page.appendChild(fieldBox(doc, 'senderName', data.senderName ? `${data.senderName}` : '', warnings));
      page.appendChild(fieldBox(doc, 'senderAddr', addressText(data.senderPostalCode, data.senderAddr), warnings));
      page.appendChild(fieldBox(doc, 'recvName', data.recvName, warnings));
      page.appendChild(fieldBox(doc, 'recvAddr', addressText(data.recvPostalCode, data.recvAddr), warnings));
      page.appendChild(fieldBox(doc, 'ccName', data.ccName, warnings));
      page.appendChild(fieldBox(doc, 'ccAddr', addressText(data.ccPostalCode, data.ccAddr), warnings));

      pageRows.forEach((row, rowIndex) => {
        row.forEach((character, colIndex) => {
          if (!character) return;
          page.appendChild(textBox(doc, 'grid-char', layout.cellBox(rowIndex, colIndex), character, layout.GRID_FONT_SIZE));
        });
      });

      const counts = {
        pageCount: totalPages,
        originalCount: 1,
        copyCount: data.copyCount,
        attachCount: data.attachCount,
        extraOriginal: data.extraOriginal,
        extraCopy: data.extraCopy
      };
      Object.entries(counts).forEach(([key, value]) => {
        page.appendChild(textBox(doc, 'count-text', layout.COUNTS[key], String(value), layout.COUNT_FONT_SIZE));
      });

      return page;
    }

    /*
     * 回傳 { fragment, warnings }；warnings 為放不下（已縮到最小字級）的欄位鍵名。
     */
    function renderAll(doc, data, contentPages, copyLabels) {
      const fragment = doc.createDocumentFragment();
      const warnings = new Set();
      copyLabels.forEach(copyLabel => {
        contentPages.forEach(pageRows => {
          fragment.appendChild(buildPage(doc, data, pageRows, contentPages.length, copyLabel, warnings));
        });
      });
      return { fragment, warnings: Array.from(warnings) };
    }

    return Object.freeze({ renderAll, splitGraphemes });
  }

  root.CunzhengPageRenderer = Object.freeze({ createRenderer, BACKGROUND_SRC });
}(typeof globalThis !== 'undefined' ? globalThis : this));
