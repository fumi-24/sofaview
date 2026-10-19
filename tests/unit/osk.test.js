// 画面上のキーボード（common/osk.js）の純粋な部分: 配列・カーソル移動・濁点などの変換・1 キーの効果。
const test = require('node:test');
const assert = require('node:assert/strict');
const osk = require('../../extension/common/osk.js');

const label = (k) => (k.t != null ? k.t : k.blank ? '' : k.label);

test('配列: どの行も、列の合計が列数に一致する（ずれた配列を作らない）', () => {
  for (const mode of ['hira', 'kata', 'abc', 'num']) {
    for (const modes of [['hira', 'kata', 'abc'], [mode]]) {
      const L = osk.buildLayout(mode, { modes, upper: mode === 'abc' });
      L.rows.forEach((r, i) => assert.equal(r.reduce((n, k) => n + k.span, 0), L.cols, `${mode}/${modes.length} 行${i}`));
    }
  }
});

test('配列: ひらがな・カタカナは同じ並び。カタカナ化は記号を変えない', () => {
  const h = osk.buildLayout('hira').rows.map((r) => r.map(label).join(''));
  const k = osk.buildLayout('kata').rows.map((r) => r.map(label).join(''));
  assert.equal(h[0], 'あかさたなはまやらわ');
  assert.equal(k[0], 'アカサタナハマヤラワ');
  assert.equal(h[5], k[5], '記号と ゛゜小 の行は同じ');
  assert.equal(osk.toKata('がっこう'), 'ガッコウ');
  assert.equal(osk.toHira('ヴァイオリン'), 'ゔぁいおりん');
});

test('配列: 切り替えキーの表示は「次の種類」。1 種類だけなら出さない', () => {
  const find = (L, id) => osk.findFn(L, id);
  assert.ok(find(osk.buildLayout('hira'), 'mode'));
  const L = osk.buildLayout('hira');
  const p = find(L, 'mode');
  assert.equal(L.rows[p.r][p.i].label, 'カナ');
  assert.equal(osk.buildLayout('abc').rows[4][0].label, 'あいう');
  assert.equal(osk.findFn(osk.buildLayout('num', { modes: ['num'] }), 'mode'), null);
  assert.equal(osk.findFn(osk.buildLayout('hira', { modes: ['hira'] }), 'mode'), null);
  assert.equal(osk.buildLayout('abc', { upper: true }).rows[0][0].t, 'A');
  assert.equal(osk.buildLayout('num').rows[3].map(label).join(','), '0,削除,完了');
});

test('移動: 端で止まり、空きは飛ばす。上下は中心に近い列へ', () => {
  const L = osk.buildLayout('hira');
  assert.deepEqual(osk.firstPos(L), { r: 0, i: 0 });
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'left'), { r: 0, i: 0 });
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'up'), { r: 0, i: 0 });
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'right'), { r: 0, i: 1 });
  // え行の め(i=6) の右は空きを飛ばして れ(i=8)
  assert.equal(label(L.rows[3][6]), 'め');
  assert.deepEqual(osk.move(L, { r: 3, i: 6 }, 'right'), { r: 3, i: 8 });
  assert.deepEqual(osk.move(L, { r: 3, i: 8 }, 'left'), { r: 3, i: 6 });
  // 空きの真下には降りず、一番近いキーへ（ん の下は れ）
  assert.deepEqual(osk.move(L, { r: 2, i: 9 }, 'down'), { r: 3, i: 8 });
  // 下の行は幅の広いキー: 完了(右端 2 列)の上は 、。ー… の右端
  const bottom = L.rows.length - 1;
  assert.deepEqual(osk.move(L, { r: bottom, i: 3 }, 'down'), { r: bottom, i: 3 }, '最下行から下へは動かない');
  const up = osk.move(L, { r: bottom, i: 3 }, 'up');
  assert.equal(up.r, bottom - 1);
  assert.ok(up.i >= 8, '完了の上は右端寄り: ' + up.i);
});

test('移動: 数字キー（3 列）', () => {
  const L = osk.buildLayout('num');
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'down'), { r: 1, i: 0 });
  assert.deepEqual(osk.move(L, { r: 3, i: 0 }, 'right'), { r: 3, i: 1 });
  assert.deepEqual(osk.move(L, { r: 3, i: 2 }, 'up'), { r: 2, i: 2 });
  assert.deepEqual(osk.move(L, { r: 3, i: 2 }, 'right'), { r: 3, i: 2 });
});

test('変換: 濁点・半濁点・小書き（カタカナも）', () => {
  assert.equal(osk.markChar('か', 'daku'), 'が');
  assert.equal(osk.markChar('が', 'daku'), 'か', '濁音にもう一度 ゛ で清音');
  assert.equal(osk.markChar('は', 'daku'), 'ば');
  assert.equal(osk.markChar('ば', 'han'), 'ぱ');
  assert.equal(osk.markChar('ぱ', 'daku'), 'ば');
  assert.equal(osk.markChar('は', 'han'), 'ぱ');
  assert.equal(osk.markChar('ぱ', 'han'), 'は');
  assert.equal(osk.markChar('う', 'daku'), 'ゔ');
  assert.equal(osk.markChar('カ', 'daku'), 'ガ');
  assert.equal(osk.markChar('ハ', 'han'), 'パ');
  assert.equal(osk.markChar('つ', 'small'), 'っ');
  assert.equal(osk.markChar('っ', 'small'), 'つ');
  assert.equal(osk.markChar('ヤ', 'small'), 'ャ');
  assert.equal(osk.markChar('あ', 'han'), null, '変えられない文字は null');
  assert.equal(osk.markChar('a', 'daku'), null);
  assert.equal(osk.markChar('ー', 'small'), null);
});

test('キーの効果: 文字・削除・空白・゛・種類の切り替え・完了', () => {
  const L = osk.buildLayout('hira');
  const key = (id) => L.rows[osk.findFn(L, id).r][osk.findFn(L, id).i];
  let s = { text: '', mode: 'hira', upper: false };
  s = osk.press(s, L.rows[0][1]); // か
  assert.equal(s.text, 'か');
  s = osk.press(s, key('daku'));
  assert.equal(s.text, 'が');
  s = osk.press(s, key('space'));
  assert.equal(s.text, 'が ');
  s = osk.press(s, key('daku'));
  assert.equal(s.text, 'が ', '直前が空白なら変えない');
  s = osk.press(s, key('del'));
  s = osk.press(s, key('del'));
  assert.equal(s.text, '');
  s = osk.press(s, key('del'));
  assert.equal(s.text, '', '空のまま削除しても壊れない');
  s = osk.press(s, key('mode'));
  assert.equal(s.mode, 'kata');
  s = osk.press(s, key('mode'), {});
  assert.equal(s.mode, 'abc');
  s = osk.press(s, key('mode'));
  assert.equal(s.mode, 'hira', '3 種類で一巡');
  assert.equal(osk.press(s, key('done')).done, true);
  assert.equal(osk.press({ text: '', mode: 'abc', upper: false }, { fn: 'case' }).upper, true);
  // サロゲートペア（𠮷）も 1 文字として消す
  assert.equal(osk.press({ text: 'a𠮷', mode: 'abc', upper: false }, { fn: 'del' }).text, 'a');
});

test('キーの効果: 文字数の上限を守る。物理キーボードの文字は数字欄では数字だけ', () => {
  const k = { t: 'あ', span: 1 };
  assert.equal(osk.press({ text: 'ああ', mode: 'hira', upper: false }, k, { maxLength: 2 }).text, 'ああ');
  assert.equal(osk.press({ text: 'あ', mode: 'hira', upper: false }, k, { maxLength: 2 }).text, 'ああ');
  assert.equal(osk.typed({ text: '', mode: 'num' }, 'a'), null);
  assert.equal(osk.typed({ text: '1', mode: 'num' }, '2'), '12');
  assert.equal(osk.typed({ text: '1234', mode: 'num' }, '5', { maxLength: 4 }), null);
  assert.equal(osk.typed({ text: '', mode: 'abc' }, 'Enter'), null, '名前付きキーは入れない');
  assert.equal(osk.typed({ text: 'a', mode: 'abc' }, ' '), 'a ');
});

test('入力欄の判定: 数字だけの欄は数字キー。読み取り専用・チェックボックスは使わない', () => {
  const el = (attrs, extra = {}) => ({ tagName: attrs.tag || 'INPUT', disabled: false, readOnly: false, maxLength: -1, labels: null, getAttribute: (n) => (n in attrs ? attrs[n] : null), ...extra });
  assert.equal(osk.inputSpec(el({})).mode, 'hira');
  assert.deepEqual(osk.inputSpec(el({})).modes, ['hira', 'kata', 'abc']);
  assert.equal(osk.inputSpec(el({ inputmode: 'numeric' })).mode, 'num');
  assert.deepEqual(osk.inputSpec(el({ inputmode: 'numeric' })).modes, ['num']);
  assert.equal(osk.inputSpec(el({ type: 'tel' })).mode, 'num');
  assert.equal(osk.inputSpec(el({ type: 'number' })).mode, 'num');
  assert.equal(osk.inputSpec(el({ pattern: '[0-9]*' })).mode, 'num');
  assert.equal(osk.inputSpec(el({ type: 'checkbox' })), null);
  assert.equal(osk.inputSpec(el({ type: 'file' })), null);
  assert.equal(osk.inputSpec(el({}, { readOnly: true })), null);
  assert.equal(osk.inputSpec(el({}, { disabled: true })), null);
  assert.equal(osk.inputSpec(el({ tag: 'DIV' })), null);
  assert.equal(osk.inputSpec(el({}, { maxLength: 7 })).maxLength, 7);
  assert.equal(osk.inputSpec(el({ placeholder: '郵便番号' })).title, '郵便番号');
  assert.equal(osk.inputSpec(el({ tag: 'TEXTAREA' })).mode, 'hira');
});

test('検索アイコン: 入力欄の右端に最上段のキーとして足す。最初のフォーカスはアイコンではなく先頭のキー。最上段のキーから ↑ で届く', () => {
  const L = osk.buildLayout('hira', { searchIcon: true, doneLabel: '検索' });
  assert.equal(L.rows[0].length, 1);
  assert.equal(L.rows[0][0].fn, 'done');
  assert.equal(L.rows[0][0].icon, true);
  assert.equal(L.rows[0][0].span, L.cols, '全列にまたがる（どの列の ↑ でも届く）');
  assert.deepEqual(osk.firstPos(L), { r: 1, i: 0 });
  assert.deepEqual(osk.move(L, { r: 1, i: 7 }, 'up'), { r: 0, i: 0 });
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'down'), { r: 1, i: 4 }, '下は中心に近い列（同じ距離なら左）');
  assert.deepEqual(osk.move(L, { r: 0, i: 0 }, 'left'), { r: 0, i: 0 });
  assert.equal(osk.press({ text: 'あ', mode: 'hira', upper: false }, L.rows[0][0]).done, true);
  assert.equal(osk.findFn(osk.buildLayout('hira'), 'done').r, 6, '指定がなければ足さない');
});
