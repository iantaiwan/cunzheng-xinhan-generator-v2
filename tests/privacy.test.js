'use strict';

// 「資料不離開瀏覽器」是本工具的核心承諾，因此用測試把它釘住，
// 而不是只寫在 README 裡。任何一次不小心引入網路或永久儲存都會讓 CI 變紅。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// 根目錄與 importers/ 的所有原始碼都要受同一套規則約束。
function sourceFiles() {
  const files = fs.readdirSync(ROOT)
    .filter(name => /\.(js|html|css)$/.test(name))
    .map(name => ({ name, full: path.join(ROOT, name) }));

  const importersDir = path.join(ROOT, 'importers');
  if (fs.existsSync(importersDir)) {
    fs.readdirSync(importersDir)
      .filter(name => name.endsWith('.js'))
      .forEach(name => files.push({ name: `importers/${name}`, full: path.join(importersDir, name) }));
  }

  return files.map(file => ({ name: file.name, text: fs.readFileSync(file.full, 'utf8') }));
}

const FORBIDDEN_APIS = [
  { pattern: /\bfetch\s*\(/, label: 'fetch()' },
  { pattern: /\bXMLHttpRequest\b/, label: 'XMLHttpRequest' },
  { pattern: /\bWebSocket\b/, label: 'WebSocket' },
  { pattern: /\bEventSource\b/, label: 'EventSource' },
  { pattern: /navigator\s*\.\s*sendBeacon/, label: 'navigator.sendBeacon' },
  { pattern: /\blocalStorage\b/, label: 'localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
  { pattern: /\bindexedDB\b/i, label: 'indexedDB' },
  { pattern: /document\s*\.\s*cookie/, label: 'document.cookie' }
];

test('原始碼不含任何網路或永久儲存 API', () => {
  sourceFiles().forEach(({ name, text }) => {
    FORBIDDEN_APIS.forEach(({ pattern, label }) => {
      assert.ok(!pattern.test(text), `${name} 出現 ${label}，違反「資料留在本機」的設計`);
    });
  });
});

test('沒有引用任何外部網域的指令碼、樣式或字型', () => {
  sourceFiles().forEach(({ name, text }) => {
    const externalRefs = [...text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/g)]
      .map(match => match[1])
      .filter(value => /^(?:https?:)?\/\//.test(value));

    // 說明文字中的官方連結是給使用者點的超連結，不會被瀏覽器自動載入；
    // 只有會觸發自動下載的 script/link/img 標籤才需要禁止。
    const autoLoaded = externalRefs.filter(url => {
      const tagPattern = new RegExp(`<(script|link|img|iframe|source)\\b[^>]*(?:src|href)\\s*=\\s*["']${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
      return tagPattern.test(text);
    });

    assert.deepEqual(autoLoaded, [], `${name} 會自動載入外部資源：${autoLoaded.join(', ')}`);
  });

  const css = fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8');
  assert.ok(!/url\(\s*["']?(?:https?:)?\/\//.test(css), 'styles.css 引用了外部 url()');
  assert.ok(!/@import/.test(css), 'styles.css 使用了 @import');
});

test('index.html 仍保留封鎖外連的 Content Security Policy', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const match = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i);
  assert.ok(match, '找不到 CSP meta 標籤');

  const directives = Object.fromEntries(
    match[1].split(';').map(part => part.trim()).filter(Boolean)
      .map(part => {
        const [name, ...values] = part.split(/\s+/);
        return [name, values.join(' ')];
      })
  );

  assert.equal(directives['connect-src'], "'none'", 'connect-src 必須為 none');
  assert.equal(directives['object-src'], "'none'");
  assert.equal(directives['frame-src'], "'none'");
  assert.equal(directives['base-uri'], "'none'");
  assert.equal(directives['form-action'], "'none'");
  assert.equal(directives['script-src'], "'self'", 'script-src 必須限制在本機檔案');
  assert.equal(directives['default-src'], "'self'");
});

test('index.html 載入的每個指令碼都存在於儲存庫中', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.length > 0, '沒有找到任何指令碼');
  scripts.forEach(src => {
    assert.ok(fs.existsSync(path.join(ROOT, src)), `index.html 參照了不存在的檔案 ${src}`);
  });

  // 每個模組都必須排在使用它的模組之前，否則全域相依會在載入時就壞掉
  const order = name => scripts.indexOf(name);
  ['logic.js', 'validation.js', 'render.js', 'importers/index.js']
    .forEach(dependency => {
      assert.ok(order(dependency) !== -1, `index.html 未載入 ${dependency}`);
      assert.ok(order(dependency) < order('app.js'), `${dependency} 必須排在 app.js 之前`);
    });
  ['importers/zip.js', 'importers/xml-scan.js', 'importers/ooxml.js',
    'importers/pdf-text.js', 'importers/html-letter.js', 'importers/letter-parser.js',
    'importers/ocr.js']
    .forEach(dependency => {
      assert.ok(order(dependency) !== -1, `index.html 未載入 ${dependency}`);
      assert.ok(order(dependency) < order('importers/index.js'), `${dependency} 必須排在 importers/index.js 之前`);
    });
  assert.ok(order('app.js') < order('import-ui.js'), 'import-ui.js 依賴 app.js 建立的接縫，必須排在其後');
});

test('OCR 引擎只從同源的 vendor/ 載入，不使用任何外部網址', () => {
  const ocr = fs.readFileSync(path.join(ROOT, 'importers/ocr.js'), 'utf8');
  const entry = ocr.match(/VENDOR_ENTRY\s*=\s*'([^']+)'/);
  assert.ok(entry, '找不到 OCR 引擎進入點');
  assert.ok(!/^(?:https?:)?\/\//.test(entry[1]), 'OCR 引擎進入點必須是同源相對路徑');
  assert.equal(entry[1], 'vendor/ocr-engine.js');

  // 預設不得有任何 OCR 引擎被打包進儲存庫
  const vendorDir = path.join(ROOT, 'vendor');
  const shipped = fs.existsSync(vendorDir)
    ? fs.readdirSync(vendorDir).filter(name => name.endsWith('.js'))
    : [];
  assert.deepEqual(shipped, [], 'vendor/ 不應納入任何引擎程式碼');
});
