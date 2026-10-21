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
  const boxes = [...Object.entries(Layout.FIELDS), ...Object.entries(Layout.COUNTS)];
  boxes.forEach(([key, box]) => assert.ok(inside(box, Layout.PAGE), `${key} 超出頁面`));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      assert.ok(!overlaps(boxes[i][1], boxes[j][1]), `${boxes[i][0]} 與 ${boxes[j][0]} 重疊`);
    }
  }
});

test('表頭欄位不侵入格子區', () => {
  const gridTop = Layout.GRID_ROW_LINES[0];
  Object.entries(Layout.FIELDS).forEach(([key, box]) => {
    assert.ok(box.y + box.height <= gridTop, `${key} 侵入格子區`);
  });
});

test('字寬估算：中文一格、ASCII 半格', () => {
  assert.equal(Layout.measureEm(Array.from('王大明')), 3);
  assert.ok(Math.abs(Layout.measureEm(Array.from('100')) - 1.65) < 1e-9);
});

test('短文字維持最大字級、單行', () => {
  const result = Layout.fitText('王大明', Layout.FIELDS.senderName);
  assert.equal(result.fits, true);
  assert.equal(result.fontSize, Layout.FIELDS.senderName.maxSize);
  assert.deepEqual(result.lines, ['王大明']);
});

test('長地址會縮小字級並換行，且不超出框寬與行數', () => {
  const box = Layout.FIELDS.senderAddr;
  const address = '台北市中正區忠孝東路一段100號5樓之3';
  const result = Layout.fitText(address, box);
  assert.equal(result.fits, true);
  assert.ok(result.fontSize < box.maxSize);
  assert.ok(result.lines.length <= box.maxLines);
  assert.equal(result.lines.join(''), address);
  result.lines.forEach(line => {
    assert.ok(Layout.measureEm(Array.from(line)) * result.fontSize <= box.width + 1e-6);
  });
});

test('過長文字回報 fits=false，並以最小字級顯示', () => {
  const box = Layout.FIELDS.ccAddr;
  const result = Layout.fitText('甲'.repeat(200), box);
  assert.equal(result.fits, false);
  assert.equal(result.fontSize, box.minSize);
  assert.ok(result.lines.length <= box.maxLines);
});

test('空字串不產生任何行', () => {
  const result = Layout.fitText('', Layout.FIELDS.ccName);
  assert.equal(result.fits, true);
  assert.deepEqual(result.lines, []);
});
