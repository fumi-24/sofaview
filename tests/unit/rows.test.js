'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const rows = require('../../extension/common/rows.js');

test('pinDelta: 見出しを画面高さの 15% に固定する（720px で 108px）', () => {
  assert.equal(rows.pinDelta(108, 720), 0);
  assert.equal(rows.pinDelta(520, 720), 412, '次の行は 412px 下にある → 412px スクロール');
  assert.equal(rows.pinDelta(-304, 720), -412, '前の行へ戻るときは上へ');
  assert.equal(rows.pinDelta(108.6, 720), 0, '1px 未満の差では動かさない');
  assert.equal(rows.pinDelta(162, 1080), 0, '1080px でも同じ割合（162px）');
});

test('slotScrollLeft: 先頭は動かさず、2 枚目以降は 2 枚目の位置にそろえる', () => {
  const lefts = [14, 390, 766, 1142, 1518, 1894]; // 幅 352 + 間隔 24 + 余白 14
  assert.equal(rows.slotScrollLeft(0, lefts), 0);
  assert.equal(rows.slotScrollLeft(1, lefts), 0);
  assert.equal(rows.slotScrollLeft(2, lefts), 376, '3 枚目 → 1 枚ぶん（376px）');
  assert.equal(rows.slotScrollLeft(3, lefts), 752);
  assert.equal(rows.slotScrollLeft(5, lefts), 1504);
});

test('slotScrollLeft: 範囲外・カードが少ないときは安全に 0 か末尾', () => {
  assert.equal(rows.slotScrollLeft(3, [0]), 0);
  assert.equal(rows.slotScrollLeft(3, []), 0);
  assert.equal(rows.slotScrollLeft(9, [14, 390, 766]), 376, '番号が大きすぎても末尾のカードにそろえる');
});
