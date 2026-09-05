'use strict';

// 「資料不離開瀏覽器」是本工具的核心承諾，因此用測試把它釘住，
// 而不是只寫在 README 裡。任何一次不小心引入網路或永久儲存都會讓 CI 變紅。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function sourceFiles() {
  return fs.readdirSync(ROOT)
    .filter(name => /\.(js|html|css)$/.test(name))
    .map(name => ({ name, text: fs.readFileSync(path.join(ROOT, name), 'utf8') }));
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

  // 模組必須在使用它們的 app.js 之前載入
  assert.ok(scripts.indexOf('app.js') === scripts.length - 1, 'app.js 必須最後載入');
});
