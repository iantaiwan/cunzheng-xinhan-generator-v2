(function initCunzhengLetterParser(root, factory) {
  const logic = (typeof module === 'object' && module.exports)
    ? require('../logic.js')
    : root.CunzhengLogic;
  const api = factory(logic);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.CunzhengLetterParser = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createLetterParser(Logic) {
  'use strict';

  // 把抽取出來的區塊還原成「欄位 + 正文」。
  //
  // 兩條路徑：
  //   1. 文件含 20 欄字格表格（官方範本與本工具的輸出）→ 逐列還原正文。
  //   2. 純段落（純文字檔、自行排版的文件）→ 濾掉官方樣板文字後當作正文。
  //
  // 所有自動判讀的欄位都會回報在 `found` 與 `notes`，讓介面標示「待人工核對」，
  // 因為姓名或地址判讀錯誤會直接造成郵局退件。

  const ROW_LABELS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  const GRID_WIDTH = 20;
  const MIN_GRID_CELLS = 15;

  const FIELD_KEYS = Object.freeze([
    'senderName', 'senderPostalCode', 'senderAddr',
    'recvName', 'recvPostalCode', 'recvAddr',
    'ccName', 'ccPostalCode', 'ccAddr'
  ]);

  const COUNT_KEYS = Object.freeze(['copyCount', 'attachCount', 'extraOriginal', 'extraCopy']);

  // 官方用紙上的固定文字，還原正文時必須濾除。
  const BOILERPLATE = [
    /郵局存證信函用紙/,
    /存證信函第\s*號/,
    /寄件人如為機關.*?蓋章/,
    /本欄姓名.*?另紙聯記/,
    /本存證信函共.*?頁/,
    /存證信函需送交郵局辦理證明手續/,
    /塗改增刪每頁至多不得逾二十字/,
    /每件一式三份/,
    /黏\s*貼|郵票或郵資券/,
    /騎縫郵戳/,
    /經辦員.*?主管/,
    /^備\s*註$/,
    /^格$|^行$/,
    /^正本$|^副本$/,
    /^\s*（?印）?\s*$/
  ];

  const COUNT_PATTERNS = Object.freeze({
    copyCount: /副本\s*(\d+)\s*份/,
    attachCount: /附件\s*(\d+)\s*張/,
    extraOriginal: /加具正本\s*(\d+)\s*份/,
    extraCopy: /加具副本\s*(\d+)\s*份/
  });

  function normalizeSpaces(text) {
    return String(text ?? '').replace(/[　\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  }

  function isBoilerplate(text) {
    const trimmed = normalizeSpaces(text);
    if (trimmed === '') return false;
    return BOILERPLATE.some(pattern => pattern.test(trimmed));
  }

  /** 表格列是否為字格：夠寬，且非空儲存格幾乎都只有一個字。 */
  function isGridRow(cells) {
    if (!Array.isArray(cells) || cells.length < MIN_GRID_CELLS) return false;
    const filled = cells.filter(cell => String(cell ?? '').trim() !== '');
    if (filled.length === 0) return true; // 空白字格列
    const singles = filled.filter(cell => Logic.splitGraphemes(String(cell).trim()).length === 1);
    return singles.length / filled.length >= 0.8;
  }

  /** 欄號表頭列（格／行、1..20）不是內容，必須跳過。 */
  function isGridHeaderRow(cells) {
    const values = cells.map(cell => String(cell ?? '').trim()).filter(Boolean);
    if (values.length < MIN_GRID_CELLS) return false;
    const numeric = values.filter(value => /^\d{1,2}$/.test(value));
    return numeric.length >= MIN_GRID_CELLS;
  }

  /** 去掉列標籤欄，回傳這一列實際承載的 20 格。 */
  function gridRowToLine(cells) {
    let working = cells.slice();
    if (working.length > GRID_WIDTH) {
      const first = String(working[0] ?? '').trim();
      if (first === '' || ROW_LABELS.includes(first)) working = working.slice(1);
    }
    working = working.slice(0, GRID_WIDTH);
    while (working.length > 0 && String(working[working.length - 1] ?? '').trim() === '') working.pop();
    return working.map(cell => String(cell ?? '')).join('');
  }

  function splitPostalCode(address) {
    const text = normalizeSpaces(address);
    // 先整段取出開頭的數字，再交給共用的郵遞區號驗證。
    // 若直接用 /^\d{3}(\d{2,3})?/ 比對，「1234 臺北市」會被切成 123 + 「4 臺北市」。
    const match = text.match(/^(\d+)\s+(.+)$/);
    if (match && Logic.isPostalCode(match[1])) {
      return { postalCode: match[1], address: match[2].trim() };
    }
    return { postalCode: '', address: text };
  }

  function cleanName(name) {
    return normalizeSpaces(name).replace(/[（(]\s*印\s*[）)]\s*$/, '').trim();
  }

  function detectParty(text) {
    // 「副本收件人」含有「收件人」，順序不可對調。
    if (/副本收件人/.test(text)) return 'cc';
    if (/寄件人/.test(text)) return 'sender';
    if (/收件人/.test(text)) return 'recv';
    return null;
  }

  const PARTY_PREFIX = { sender: 'sender', recv: 'recv', cc: 'cc' };

  function assign(fields, found, party, kind, value) {
    if (!party || !value) return;
    const prefix = PARTY_PREFIX[party];
    if (kind === 'name') {
      const name = cleanName(value);
      if (!name || found[`${prefix}Name`]) return;
      fields[`${prefix}Name`] = name;
      found[`${prefix}Name`] = true;
    } else {
      const parsed = splitPostalCode(value);
      if (!parsed.address || found[`${prefix}Addr`]) return;
      fields[`${prefix}Addr`] = parsed.address;
      found[`${prefix}Addr`] = true;
      if (parsed.postalCode) {
        fields[`${prefix}PostalCode`] = parsed.postalCode;
        found[`${prefix}PostalCode`] = true;
      }
    }
  }

  function extractFields(lines) {
    const fields = {};
    const found = {};
    FIELD_KEYS.forEach(key => { fields[key] = ''; found[key] = false; });
    COUNT_KEYS.forEach(key => { fields[key] = null; found[key] = false; });

    let currentParty = null;

    lines.forEach(rawLine => {
      const line = normalizeSpaces(rawLine);
      if (!line) return;

      // 份數寫在費用欄，該行本身屬於官方樣板，因此必須先讀完再濾除。
      Object.entries(COUNT_PATTERNS).forEach(([key, pattern]) => {
        if (found[key]) return;
        const match = line.match(pattern);
        if (match) {
          fields[key] = Number.parseInt(match[1], 10);
          found[key] = true;
        }
      });

      // 官方用紙的注意事項也含有「寄件人」三個字，若不先濾除會被誤判成姓名。
      if (isBoilerplate(line)) return;

      // 同一行就寫完的形式：「寄件人姓名：王小明」
      const inlineName = line.match(/(寄件人|副本收件人|收件人)\s*[:：]?\s*姓名\s*[:：]\s*(.+)$/);
      if (inlineName) {
        assign(fields, found, detectParty(inlineName[1]), 'name', inlineName[2]);
        currentParty = detectParty(inlineName[1]);
        return;
      }
      const inlineAddr = line.match(/(寄件人|副本收件人|收件人)\s*[:：]?\s*(?:詳細)?地址\s*[:：]\s*(.+)$/);
      if (inlineAddr) {
        assign(fields, found, detectParty(inlineAddr[1]), 'address', inlineAddr[2]);
        currentParty = detectParty(inlineAddr[1]);
        return;
      }

      const party = detectParty(line);
      if (party) {
        currentParty = party;
        // 「一、寄件人」之後可能同一行就接姓名
        const trailing = line.replace(/^[一二三四五六七八九十\d]+\s*[、.．]?\s*/, '')
          .replace(/(副本收件人|寄件人|收件人)\s*[:：]?\s*/, '').trim();
        if (trailing && !/^[（(〈［【]/.test(trailing)) assign(fields, found, party, 'name', trailing);
        return;
      }

      const nameMatch = line.match(/^姓名(?:或名稱)?\s*[:：]\s*(.*)$/);
      if (nameMatch) { assign(fields, found, currentParty, 'name', nameMatch[1]); return; }

      const addrMatch = line.match(/^(?:詳細)?地址\s*[:：]\s*(.*)$/);
      if (addrMatch) { assign(fields, found, currentParty, 'address', addrMatch[1]); return; }
    });

    return { fields, found };
  }

  function contentFromParagraphs(lines) {
    const kept = [];
    lines.forEach(rawLine => {
      const line = String(rawLine ?? '');
      const trimmed = normalizeSpaces(line);
      if (isBoilerplate(trimmed)) return;
      // 欄位行不屬於正文，分行與同行兩種寫法都要排除
      if (/^(?:姓名(?:或名稱)?|(?:詳細)?地址)\s*[:：]/.test(trimmed)) return;
      if (/^(?:寄件人|副本收件人|收件人)\s*[:：]?\s*(?:姓名(?:或名稱)?|(?:詳細)?地址)\s*[:：]/.test(trimmed)) return;
      if (/^[一二三四五六七八九十\d]+\s*[、.．]?\s*(寄件人|收件人|副本收件人)\s*$/.test(trimmed)) return;
      if (/^(寄件人|收件人|副本收件人)\s*[:：]?\s*$/.test(trimmed)) return;
      kept.push(line.replace(/\s+$/, ''));
    });
    while (kept.length > 0 && kept[0].trim() === '') kept.shift();
    while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
    return kept.join('\n');
  }

  /**
   * 把字格列還原成原始段落。
   *
   * 排版時只有在段落長度超過 20 格才會折到下一列，因此「剛好填滿 20 格」
   * 代表軟換行、要與下一列接續；未滿 20 格代表使用者當初真的按了 Enter。
   * 依此規則還原是無損的，唯一的例外是使用者輸入的段落長度剛好是 20 的倍數
   * —— 這在字格格式中本來就無法與軟換行區分，屬於格式本身的先天限制。
   */
  function joinWrappedLines(rows) {
    const lines = [];
    let buffer = '';
    rows.forEach(row => {
      buffer += row;
      if (Logic.splitGraphemes(row).length === GRID_WIDTH) return;
      lines.push(buffer);
      buffer = '';
    });
    if (buffer !== '') lines.push(buffer);
    return lines;
  }

  function contentFromGrid(gridLines) {
    const lines = joinWrappedLines(gridLines);
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    return lines.join('\n');
  }

  /**
   * @param {Array<{kind: 'paragraph'|'row', text?: string, cells?: string[]}>} blocks
   * @returns {{content: string, fields: object, found: object, notes: string[], source: string, gridRows: number}}
   */
  function parseLetter(blocks) {
    const paragraphLines = [];
    const gridLines = [];
    let gridRows = 0;

    (Array.isArray(blocks) ? blocks : []).forEach(block => {
      if (block.kind === 'row') {
        if (isGridHeaderRow(block.cells)) return;
        if (isGridRow(block.cells)) {
          gridRows += 1;
          gridLines.push(gridRowToLine(block.cells));
          return;
        }
        // 一般表格：把儲存格當成獨立文字行，讓欄位判讀仍有機會命中
        block.cells.forEach(cell => paragraphLines.push(String(cell ?? '')));
        return;
      }
      String(block.text ?? '').split('\n').forEach(line => paragraphLines.push(line));
    });

    const { fields, found } = extractFields(paragraphLines);
    const useGrid = gridRows > 0;
    const content = useGrid ? contentFromGrid(gridLines) : contentFromParagraphs(paragraphLines);

    const notes = [];
    if (useGrid) {
      notes.push(`偵測到 ${gridRows} 列字格，已依每列 20 格還原正文。`);
    } else {
      notes.push('文件中沒有字格表格，已改用段落文字作為正文。');
    }

    FIELD_KEYS.forEach(key => {
      if (key.endsWith('PostalCode') && fields[key] && !Logic.isOptionalPostalCode(fields[key])) {
        notes.push(`判讀到的郵遞區號「${fields[key]}」格式不符，已捨棄。`);
        fields[key] = '';
        found[key] = false;
      }
    });

    const missing = ['senderName', 'senderAddr', 'recvName', 'recvAddr'].filter(key => !found[key]);
    if (missing.length > 0) notes.push(`未能判讀 ${missing.length} 個必填欄位，請自行填寫。`);
    if (!content.trim()) notes.push('未能從檔案中取得正文，請確認檔案內容或改用純文字檔。');

    return { content, fields, found, notes, source: useGrid ? 'grid' : 'paragraphs', gridRows };
  }

  /** 純文字檔的入口：先切成段落區塊，再走同一套判讀。 */
  function parsePlainText(text) {
    const blocks = String(text ?? '')
      .split(/\r\n?|\n/)
      .map(line => ({ kind: 'paragraph', text: line }));
    return parseLetter(blocks);
  }

  return Object.freeze({
    COUNT_KEYS,
    FIELD_KEYS,
    GRID_WIDTH,
    cleanName,
    contentFromParagraphs,
    extractFields,
    gridRowToLine,
    isBoilerplate,
    isGridHeaderRow,
    isGridRow,
    joinWrappedLines,
    parseLetter,
    parsePlainText,
    splitPostalCode
  });
}));
