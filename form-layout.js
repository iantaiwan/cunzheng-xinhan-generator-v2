(function initFormLayout(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengFormLayout = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createFormLayout() {
  'use strict';

  /*
   * 所有座標取自中華郵政「存證信函新格式10206.pdf」第 1 頁（595 × 842 pt），
   * 原點在左上角，單位 pt。底圖 assets/official-form.svg 即為同一頁轉出的向量圖，
   * 因此只要依這些座標疊字，輸出就與官方用紙一致。
   */
  const PAGE = Object.freeze({ width: 595, height: 842 });

  // 格子區：11 條橫線（10 行）、21 條直線（行號欄右緣 + 20 格）
  const GRID_ROW_LINES = Object.freeze([
    255.6, 289.6, 323.6, 357.6, 391.6, 425.6, 459.6, 493.6, 527.6, 561.6, 595.7
  ]);
  const GRID_COL_LINES = Object.freeze([
    89.4, 113.0, 136.8, 160.4, 184.2, 207.8, 231.6, 255.2, 279.0, 302.6, 326.4,
    350.0, 373.8, 397.4, 421.2, 444.8, 468.6, 492.4, 516.1, 539.9, 563.6
  ]);
  // 官方 ODT 範本格子段落預設字級 14pt
  const GRID_FONT_SIZE = 14;

  /*
   * 表頭填寫欄（座標取自官方 PDF 的標籤文字與表頭右框 x=563.5）：
   *   x       ：標籤「姓名」「詳細地址：」右緣
   *   right   ：可填寫的右界（寄件人姓名停在「印」字前，其餘到右框內側）
   *   anchorY ：同列標籤的垂直中心，填入文字第一行以此對齊
   *   bottom  ：多行時往下延伸的界線（不超過下一個標籤）
   */
  const FIELDS = Object.freeze({
    senderName: Object.freeze({ x: 324.5, right: 510, anchorY: 98.45, bottom: 117, maxSize: 11, minSize: 6, maxLines: 1 }),
    senderAddr: Object.freeze({ x: 344.4, right: 560, anchorY: 123.6, bottom: 137.5, maxSize: 10.5, minSize: 5.5, maxLines: 2 }),
    recvName: Object.freeze({ x: 326.4, right: 560, anchorY: 144.2, bottom: 161.3, maxSize: 11, minSize: 6, maxLines: 1 }),
    recvAddr: Object.freeze({ x: 344.4, right: 560, anchorY: 167.6, bottom: 181, maxSize: 10.5, minSize: 5.5, maxLines: 2 }),
    ccName: Object.freeze({ x: 326.4, right: 560, anchorY: 187.4, bottom: 196.5, maxSize: 11, minSize: 6, maxLines: 1 }),
    ccAddr: Object.freeze({ x: 344.4, right: 560, anchorY: 203.0, bottom: 209.8, maxSize: 10.5, minSize: 5.5, maxLines: 2 })
  });
  const LINE_HEIGHT = 1.15;

  // 表尾份數：數字置中於兩個標籤之間的空白處
  const COUNTS = Object.freeze({
    pageCount: Object.freeze({ x: 125.2, y: 598.9, width: 40, height: 9.8 }),
    originalCount: Object.freeze({ x: 205.2, y: 598.9, width: 40, height: 9.8 }),
    copyCount: Object.freeze({ x: 205.2, y: 609.0, width: 40, height: 9.8 }),
    attachCount: Object.freeze({ x: 205.2, y: 619.0, width: 40, height: 9.8 }),
    extraOriginal: Object.freeze({ x: 205.2, y: 628.9, width: 40, height: 9.8 }),
    extraCopy: Object.freeze({ x: 205.2, y: 639.0, width: 40, height: 9.8 })
  });
  const COUNT_FONT_SIZE = 10;

  // 左上「副 正 本」：以圓圈標示本頁為正本或副本
  const COPY_MARKS = Object.freeze({
    正本: Object.freeze({ cx: 50.9, cy: 94.5, r: 8.5 }),
    副本: Object.freeze({ cx: 33.6, cy: 94.5, r: 8.5 })
  });

  function cellBox(rowIndex, colIndex) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= GRID_ROW_LINES.length - 1) {
      throw new RangeError(`rowIndex 超出範圍：${rowIndex}`);
    }
    if (!Number.isInteger(colIndex) || colIndex < 0 || colIndex >= GRID_COL_LINES.length - 1) {
      throw new RangeError(`colIndex 超出範圍：${colIndex}`);
    }
    const x = GRID_COL_LINES[colIndex];
    const y = GRID_ROW_LINES[rowIndex];
    return {
      x,
      y,
      width: GRID_COL_LINES[colIndex + 1] - x,
      height: GRID_ROW_LINES[rowIndex + 1] - y
    };
  }

  // 估算字寬（em）：ASCII 約半形，其餘（中文、全形符號）視為一格
  function charWidthEm(character) {
    const code = character.codePointAt(0);
    if (code <= 0x7e) return 0.55;
    if (code >= 0xff61 && code <= 0xff9f) return 0.55;
    return 1;
  }

  function measureEm(characters) {
    return characters.reduce((sum, character) => sum + charWidthEm(character), 0);
  }

  function wrapToWidth(characters, maxEm) {
    const lines = [];
    let current = [];
    let width = 0;
    characters.forEach(character => {
      const w = charWidthEm(character);
      if (current.length > 0 && width + w > maxEm) {
        lines.push(current.join(''));
        current = [];
        width = 0;
      }
      current.push(character);
      width += w;
    });
    if (current.length > 0) lines.push(current.join(''));
    return lines;
  }

  /*
   * 在固定框內找出能完整放下文字的最大字級（0.25pt 一級遞減）。
   * box.height 可為數字，或依字級回傳可用高度的函式。
   * 回傳 { fontSize, lines, fits }；若最小字級仍放不下，fits 為 false，並以最小字級截斷換行。
   */
  function fitText(text, box) {
    const characters = Array.from(String(text ?? ''));
    if (characters.length === 0) return { fontSize: box.maxSize, lines: [], fits: true };
    const heightFor = typeof box.height === 'function' ? box.height : () => box.height;
    for (let size = box.maxSize; size >= box.minSize - 1e-9; size -= 0.25) {
      const lines = wrapToWidth(characters, box.width / size);
      if (lines.length <= box.maxLines && lines.length * size * LINE_HEIGHT <= heightFor(size) + 1e-9) {
        return { fontSize: Math.round(size * 100) / 100, lines, fits: true };
      }
    }
    const lines = wrapToWidth(characters, box.width / box.minSize).slice(0, box.maxLines);
    return { fontSize: box.minSize, lines, fits: false };
  }

  // 第一行行框的上緣：讓該行垂直中心落在 anchorY（與官方標籤對齊）
  function fieldTop(field, fontSize) {
    return field.anchorY - (fontSize * LINE_HEIGHT) / 2;
  }

  // 欄位在最大字級時可能佔用的範圍（供重疊檢查）
  function fieldRegion(field) {
    const y = fieldTop(field, field.maxSize);
    return { x: field.x, y, width: field.right - field.x, height: field.bottom - y };
  }

  /*
   * 表頭欄位排版：回傳 { fontSize, lines, fits, x, y, width, height }，
   * x/y/width/height 為實際放置的框（pt）。
   */
  function fitField(field, text) {
    const width = field.right - field.x;
    const fitted = fitText(text, {
      width,
      maxSize: field.maxSize,
      minSize: field.minSize,
      maxLines: field.maxLines,
      height: size => field.bottom - fieldTop(field, size)
    });
    const y = fieldTop(field, fitted.fontSize);
    return { ...fitted, x: field.x, y, width, height: field.bottom - y };
  }

  return Object.freeze({
    PAGE,
    GRID_ROW_LINES,
    GRID_COL_LINES,
    GRID_FONT_SIZE,
    FIELDS,
    COUNTS,
    COUNT_FONT_SIZE,
    COPY_MARKS,
    LINE_HEIGHT,
    cellBox,
    fieldRegion,
    fieldTop,
    fitField,
    fitText,
    measureEm
  });
}));
