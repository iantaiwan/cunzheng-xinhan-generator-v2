'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Layout = require('../form-layout.js');

function inside(box, page) {
  return box.x >= 0 && box.y >= 0 && box.x + box.width <= page.width && box.y + box.height <= page.height;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test('格子為 10 行 × 20 格，且線座標嚴格遞增', () => {
  assert.equal(Layout.GRID_ROW_LINES.length - 1, 10);
  assert.equal(Layout.GRID_COL_LINES.length - 1, 20);
  for (const lines of [Layout.GRID_ROW_LINES, Layout.GRID_COL_LINES]) {
    for (let i = 1; i < lines.length; i += 1) assert.ok(lines[i] > lines[i - 1]);
  }
});

test('每格尺寸與官方用紙一致（行高約 34pt、格寬約 23.7pt）', () => {
  for (let r = 0; r < 10; r += 1) {
    for (let c = 0; c < 20; c += 1) {
      const box = Layout.cellBox(r, c);
      assert.ok(Math.abs(box.height - 34) < 0.2, `第${r + 1}行高度 ${box.height}`);
      assert.ok(Math.abs(box.width - 23.71) < 0.3, `第${c + 1}格寬度 ${box.width}`);
      assert.ok(inside(box, Layout.PAGE));
    }
  }
});

test('格子索引超出範圍會丟出錯誤', () => {
  assert.throws(() => Layout.cellBox(10, 0), RangeError);
  assert.throws(() => Layout.cellBox(0, 20), RangeError);
  assert.throws(() => Layout.cellBox(-1, 0), RangeError);
  assert.throws(() => Layout.cellBox(0.5, 0), RangeError);
});

test('表頭欄位與份數欄位都在頁面內，且彼此不重疊', () => {
  const boxes = [
    ...Object.entries(Layout.FIELDS).map(([key, field]) => [key, Layout.fieldRegion(field)]),
    ...Object.entries(Layout.COUNTS)
  ];
  boxes.forEach(([key, box]) => assert.ok(inside(box, Layout.PAGE), `${key} 超出頁面`));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!overlaps(boxes[i][1], boxes[j][1]), `${boxes[i][0]} 與 ${boxes[j][0]} 重疊`);
    }
  }
});

test('表頭欄位不侵入格子區', () => {
  const gridTop = Layout.GRID_ROW_LINES[0];
  Object.entries(Layout.FIELDS).forEach(([key, field]) => {
    const box = Layout.fieldRegion(field);
    assert.ok(box.y + box.height <= gridTop, `${key} 侵入格子區`);
  });
});

test('字寬估算：中文一格、ASCII 半格', () => {
  assert.equal(Layout.measureEm(Array.from('王大明')), 3);
  assert.ok(Math.abs(Layout.measureEm(Array.from('100')) - 1.65) < 1e-9);
});

test('短文字維持最大字級、單行', () => {
  const result = Layout.fitField(Layout.FIELDS.senderName, '王大明');
  assert.equal(result.fits, true);
  assert.equal(result.fontSize, Layout.FIELDS.senderName.maxSize);
  assert.deepEqual(result.lines, ['王大明']);
});

test('地址欄延伸到表頭右框內側（官方右框 x=563.5）', () => {
  ['senderAddr', 'recvAddr', 'ccAddr', 'recvName', 'ccName'].forEach(key => {
    const field = Layout.FIELDS[key];
    assert.ok(field.right >= 555 && field.right < 563.5, `${key} 右界 ${field.right}`);
  });
  // 寄件人姓名需停在官方「印」字（x=513.8）之前
  assert.ok(Layout.FIELDS.senderName.right < 513.8);
});

test('一般長度地址以最大字級單行放下', () => {
  ['senderAddr', 'recvAddr', 'ccAddr'].forEach(key => {
    const field = Layout.FIELDS[key];
    const result = Layout.fitField(field, '100 台北市中正區忠孝東路一段100號5樓之3');
    assert.equal(result.fits, true, key);
    assert.equal(result.lines.length, 1, key);
    assert.equal(result.fontSize, field.maxSize, key);
  });
});

test('填入文字第一行垂直中心對齊官方標籤中心', () => {
  Object.entries(Layout.FIELDS).forEach(([key, field]) => {
    for (const text of ['甲', '甲'.repeat(60)]) {
      const r = Layout.fitField(field, text);
      const firstLineCenter = r.y + (r.fontSize * Layout.LINE_HEIGHT) / 2;
      assert.ok(Math.abs(firstLineCenter - field.anchorY) < 1e-6, `${key} 偏離 ${firstLineCenter - field.anchorY}`);
    }
  });
});

test('很長的地址縮小字級並換行，不超出右界與下界', () => {
  const field = Layout.FIELDS.senderAddr;
  const address = '台北市中正區忠孝東路一段100號5樓之3（大樓管理室代收）收發室轉交';
  const r = Layout.fitField(field, address);
  assert.equal(r.fits, true);
  assert.equal(r.lines.join(''), address);
  assert.ok(r.lines.length <= field.maxLines);
  r.lines.forEach(line => {
    assert.ok(Layout.measureEm(Array.from(line)) * r.fontSize <= field.right - field.x + 1e-6);
  });
  assert.ok(r.y + r.lines.length * r.fontSize * Layout.LINE_HEIGHT <= field.bottom + 1e-6);
});

test('過長文字回報 fits=false，並以最小字級顯示', () => {
  const field = Layout.FIELDS.ccAddr;
  const r = Layout.fitField(field, '甲'.repeat(200));
  assert.equal(r.fits, false);
  assert.equal(r.fontSize, field.minSize);
  assert.ok(r.lines.length <= field.maxLines);
});

test('空字串不產生任何行', () => {
  const result = Layout.fitField(Layout.FIELDS.ccName, '');
  assert.equal(result.fits, true);
  assert.deepEqual(result.lines, []);
});

test('正文字級與官方 ODT 範本一致（14pt），且小於格寬與行高', () => {
  assert.equal(Layout.GRID_FONT_SIZE, 14);
  const box = Layout.cellBox(0, 0);
  assert.ok(Layout.GRID_FONT_SIZE < box.width && Layout.GRID_FONT_SIZE < box.height);
});
