'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nav = require('../../extension/common/spatial-nav.js');

const box = (id, left, top, width, height) => ({ id, rect: { left, top, width, height } });
const ids = (c) => (c ? c.id : null);
const R = (left, top, width, height) => ({ left, top, width, height });

// 3 列 × 2 行のグリッド（各 100×60、間隔 20）
const grid = [
  box('a1', 0, 0, 100, 60), box('a2', 120, 0, 100, 60), box('a3', 240, 0, 100, 60),
  box('b1', 0, 80, 100, 60), box('b2', 120, 80, 100, 60), box('b3', 240, 80, 100, 60),
];
const without = (list, id) => list.filter((c) => c.id !== id);

test('グリッド: 上下左右の隣へ移動する', () => {
  const from = grid[1].rect; // a2
  assert.equal(ids(nav.pickNext('right', from, without(grid, 'a2'))), 'a3');
  assert.equal(ids(nav.pickNext('left', from, without(grid, 'a2'))), 'a1');
  assert.equal(ids(nav.pickNext('down', from, without(grid, 'a2'))), 'b2');
  assert.equal(ids(nav.pickNext('up', grid[4].rect, without(grid, 'b2'))), 'a2');
});

test('端では null（ラップしない）', () => {
  assert.equal(nav.pickNext('left', grid[0].rect, without(grid, 'a1')), null);
  assert.equal(nav.pickNext('up', grid[0].rect, without(grid, 'a1')), null);
  assert.equal(nav.pickNext('right', grid[2].rect, without(grid, 'a3')), null);
  assert.equal(nav.pickNext('down', grid[5].rect, without(grid, 'b3')), null);
});

test('後ろ・入れ子の要素は候補にならない', () => {
  const from = R(100, 100, 100, 60);
  const cands = [box('behind', 0, 100, 60, 60), box('inside', 120, 110, 40, 30)];
  assert.equal(nav.pickNext('right', from, cands), null);
  assert.equal(ids(nav.pickNext('left', from, cands)), 'behind');
});

test('同じ行に重なる候補を、近いだけの斜めの候補より優先する', () => {
  const from = R(0, 0, 100, 60);
  const cands = [
    box('near-diagonal', 110, 150, 100, 60), // 近いが行が違う（重ならない）
    box('far-aligned', 400, 0, 100, 60), // 遠いが同じ行
  ];
  assert.equal(ids(nav.pickNext('right', from, cands)), 'far-aligned');
});

test('重なる候補がなければ、重ならない候補から選ぶ', () => {
  const from = R(0, 0, 100, 60);
  const cands = [box('p', 200, 200, 100, 60), box('q', 120, 400, 100, 60)];
  assert.equal(ids(nav.pickNext('right', from, cands)), 'p'); // gap + 6*offset が小さい方
});

test('alignedOnly: 重なる候補がなければ null（斜めの候補は返さない）', () => {
  const from = R(0, 0, 100, 60);
  const diagonal = [box('p', 200, 200, 100, 60)];
  assert.equal(nav.pickNext('right', from, diagonal, { alignedOnly: true }), null);
  assert.equal(ids(nav.pickNext('right', from, diagonal)), 'p'); // 既定では従来どおり斜めも選ぶ
  const withAligned = diagonal.concat(box('r', 300, 0, 100, 60));
  assert.equal(ids(nav.pickNext('right', from, withAligned, { alignedOnly: true })), 'r');
});

test('縦移動は直前の横位置（sticky x）に近い列を選ぶ', () => {
  // 上の行: 幅広の 1 枚。下の行: 3 枚
  const wide = box('wide', 0, 0, 400, 60);
  const row = [box('r1', 0, 100, 120, 60), box('r2', 140, 100, 120, 60), box('r3', 280, 100, 120, 60)];
  // 中心 x を基準にすると r2 が最も近い（wide の中心 200）
  assert.equal(ids(nav.pickNext('down', wide.rect, row)), 'r2');
  // ユーザーが元いた列（x=340）を覚えている場合は r3
  assert.equal(ids(nav.pickNext('down', wide.rect, row, { stickyX: 340 })), 'r3');
  assert.equal(ids(nav.pickNext('down', wide.rect, row, { stickyX: 20 })), 'r1');
});

test('横移動は sticky y に近い行を選ぶ', () => {
  const from = R(0, 0, 100, 400); // 縦に長い要素（レールなど）
  const cands = [box('top', 150, 0, 100, 60), box('mid', 150, 170, 100, 60), box('low', 150, 340, 100, 60)];
  assert.equal(ids(nav.pickNext('right', from, cands)), 'mid'); // 中心 y=200 に最も近い
  assert.equal(ids(nav.pickNext('right', from, cands, { stickyY: 30 })), 'top');
  assert.equal(ids(nav.pickNext('right', from, cands, { stickyY: 370 })), 'low');
});

test('ワイドなカードからの左右は隣のカードへ（行内のリンクに飛ばない）', () => {
  // 回帰: 試作で「すべてみる」リンクに飛んでいた
  const wide = R(306, 277, 832, 166);
  const cands = [
    box('next-card', 1160, 277, 400, 166), // 隣のカード（同じ行）
    box('see-all', 1169, 250, 80, 17), // 行の見出し横の小さなリンク（行の上）
  ];
  assert.equal(ids(nav.pickNext('right', wide, cands)), 'next-card');
});

test('空の候補は null', () => {
  assert.equal(nav.pickNext('down', R(0, 0, 10, 10), []), null);
});

test('同点は DOM 順（先の候補）が勝つ', () => {
  const from = R(0, 100, 100, 60);
  const cands = [box('x', 200, 100, 100, 60), box('y', 200, 100, 100, 60)];
  assert.equal(ids(nav.pickNext('right', from, cands)), 'x');
});

test('pickInitial: 画面内で最も左上の候補を選ぶ（DOM 順に依存しない）', () => {
  const vp = { left: 0, top: 0, right: 1280, bottom: 720 };
  const cands = [
    box('clone-far-right', 5092, 157, 588, 331), // DOM 先頭だが画面外（ビルボードの複製）
    box('card', 700, 300, 300, 200),
    box('billboard', 196, 94, 700, 394),
    box('banner', 196, 94 + 8, 260, 146), // 同じ帯なら左が先
  ];
  assert.equal(ids(nav.pickInitial(cands, vp)), 'billboard');
});

test('pickInitial: 画面内に候補がなければ全体で最も上・左', () => {
  const vp = { left: 0, top: 0, right: 100, bottom: 100 };
  const cands = [box('b', 500, 900, 50, 50), box('a', 20, 800, 50, 50)];
  assert.equal(ids(nav.pickInitial(cands, vp)), 'a');
  assert.equal(nav.pickInitial([], vp), null);
});

test('rectOf: x/y 形式と left/top 形式を正規化', () => {
  assert.deepEqual(nav.rectOf({ x: 10, y: 20, width: 30, height: 40 }), { left: 10, top: 20, right: 40, bottom: 60, width: 30, height: 40 });
  assert.deepEqual(nav.rectOf({ left: 1, top: 2, right: 11, bottom: 12 }), { left: 1, top: 2, right: 11, bottom: 12, width: 10, height: 10 });
});

test('evaluate: 向かい合う辺の距離と重なりを返す', () => {
  const e = nav.evaluate('right', nav.rectOf(R(0, 0, 100, 60)), nav.rectOf(R(150, 10, 100, 60)), nav.DEFAULT_OPTS);
  assert.equal(e.gap, 50);
  assert.equal(e.overlapping, true);
  assert.equal(e.offset, 10);
  assert.equal(nav.evaluate('left', nav.rectOf(R(0, 0, 100, 60)), nav.rectOf(R(150, 10, 100, 60)), nav.DEFAULT_OPTS), null);
});

test('縦に長いカルーセル行の実寸に近い配置（TVer ホームの縮図）', () => {
  // 行 1: 見出しリンク + カード 4 枚、行 2: カード 4 枚
  const row1 = [0, 1, 2, 3].map((i) => box('r1c' + i, 300 + i * 400, 494, 390, 220));
  const row2 = [0, 1, 2, 3].map((i) => box('r2c' + i, 300 + i * 400, 900, 390, 220));
  const seeAll = box('see-all', 1169, 466, 80, 17);
  const all = [...row1, ...row2, seeAll];
  // r1c1 → 右 → r1c2、下 → r2c1（同じ列）
  assert.equal(ids(nav.pickNext('right', row1[1].rect, all.filter((c) => c.id !== 'r1c1'))), 'r1c2');
  assert.equal(ids(nav.pickNext('down', row1[1].rect, all.filter((c) => c.id !== 'r1c1'), { stickyX: row1[1].rect.left + 195 })), 'r2c1');
  // 見出しリンクから下へ → 近い列のカード
  assert.equal(ids(nav.pickNext('down', seeAll.rect, row1)), 'r1c2');
});
