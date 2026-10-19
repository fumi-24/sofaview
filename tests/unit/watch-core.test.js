'use strict';
// 視聴画面の操作ルール（youtube.com/tv の実測。docs/NOTES.md 3.10）。DOM に触らない純粋なロジックの確認。
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../extension/common/watch-core.js');

const st = (o) => ({ ...W.initialState(), ...o });
const dos = (r) => r.effects.map((e) => e.do + (e.to ? ':' + e.to : '') + (e.dir ? ':' + e.dir : ''));
const run = (s, ...keys) => {
  let cur = s;
  const log = [];
  for (const k of keys) {
    const r = W.reduce(cur, k);
    log.push({ key: k, ui: r.state.ui, focus: r.state.focus, fx: dos(r), consume: r.consume });
    cur = r.state;
  }
  return { state: cur, log };
};

test('fmtTime: m:ss（分は 0 埋めしない）、1 時間以上は h:mm:ss（/tv の実測値と同じ）', () => {
  assert.equal(W.fmtTime(19), '0:19');
  assert.equal(W.fmtTime(2875), '47:55');
  assert.equal(W.fmtTime(588), '9:48');
  assert.equal(W.fmtTime(3961), '1:06:01');
  assert.equal(W.fmtTime(0), '0:00');
  assert.equal(W.fmtTime(59.9), '0:59');
  assert.equal(W.fmtTime(-5), '0:00');
  assert.equal(W.fmtTime(NaN), '0:00');
  assert.equal(W.fmtTime(Infinity), '0:00');
});

test('scrubStep: 最初の 14 回は 10 秒。その後は上限へなだらかに近づく（18.5 分の動画の実測と一致）', () => {
  for (let n = 1; n <= 14; n++) assert.equal(W.scrubStep(n, 1110), 10, `n=${n}`);
  // 実測: 12, 14, 17, 19, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 38, 39, 40, 40, 41（±1 秒）
  const measured = [12, 14, 17, 19, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37, 37, 38, 38, 39, 40, 40, 41];
  measured.forEach((m, i) => {
    const got = W.scrubStep(15 + i, 1110);
    assert.ok(Math.abs(got - m) <= 1, `n=${15 + i}: ${got} vs ${m}`);
  });
  assert.equal(W.scrubStep(200, 1110), 41, '上限で止まる');
});

test('scrubStep: 上限は動画の長さで変わる（66 分で約 81 秒）。短い動画でも 20 秒は確保する', () => {
  assert.ok(Math.abs(W.scrubStep(200, 3961) - 81) <= 2);
  assert.equal(W.scrubStep(200, 60), 20);
  assert.equal(W.scrubStep(200, NaN), 41, '長さが分からないときは 18.5 分相当');
  let prev = 0;
  for (let n = 1; n < 80; n++) {
    const v = W.scrubStep(n, 2000);
    assert.ok(v >= prev, '単調に増える');
    prev = v;
  }
});

test('nextCount: 間隔が 150ms 以下なら連続（加速する）、それより長いと 1 に戻る', () => {
  assert.equal(W.nextCount(0, 9999), 1);
  assert.equal(W.nextCount(1, 100), 2);
  assert.equal(W.nextCount(14, 150), 15);
  assert.equal(W.nextCount(14, 151), 1);
  assert.equal(W.nextCount(30, 300), 1, '150〜300ms の間隔では加速しない');
});

test('clampTarget: 0〜長さに収める', () => {
  assert.equal(W.clampTarget(-3, 100), 0);
  assert.equal(W.clampTarget(120, 100), 100);
  assert.equal(W.clampTarget(50, 100), 50);
  assert.equal(W.clampTarget(5000, NaN), 5000, '長さ不明なら上は制限しない');
});

test('H（非表示）: OK・↑・↓・メニュー・ページ送りは操作画面を出してボタン列（再生）にフォーカス', () => {
  for (const k of ['OK', 'UP', 'DOWN', 'MENU', 'PAGE_UP', 'PAGE_DOWN', 'NEXT']) {
    const { state, log } = run(st(), k);
    assert.equal(state.ui, 'C', k);
    assert.equal(state.focus, 'row', k);
    assert.deepEqual(log[0].fx, ['show', 'focus:row'], k);
    assert.equal(log[0].consume, true);
  }
});

test('H: ← → は操作画面を出して進行バーにフォーカスするだけ（シークしない）', () => {
  for (const k of ['LEFT', 'RIGHT']) {
    const { state, log } = run(st(), k);
    assert.equal(state.ui, 'C');
    assert.equal(state.focus, 'bar');
    assert.deepEqual(log[0].fx, ['show', 'focus:bar']);
  }
});

test('H: 再生/一時停止は出して切り替え、一時停止は一時停止だけ、再生は再生だけ', () => {
  assert.deepEqual(run(st(), 'PLAY_PAUSE').log[0].fx, ['show', 'focus:row', 'togglePause']);
  assert.deepEqual(run(st(), 'PAUSE').log[0].fx, ['show', 'focus:row', 'pause']);
  assert.deepEqual(run(st(), 'PLAY').log[0].fx, ['show', 'focus:row', 'play']);
});

test('H: 早送り/巻き戻しキーでスクラブを始める（最初の 1 回は現在位置を出すだけで動かさない）', () => {
  const r = run(st(), 'SEEK_FWD');
  assert.equal(r.state.ui, 'S');
  assert.deepEqual(r.log[0].fx, ['show', 'scrubStart']);
});

test('H: 戻るで画面を離れる。停止も離れる', () => {
  assert.deepEqual(run(st(), 'BACK').log[0].fx, ['leave']);
  assert.deepEqual(run(st(), 'STOP').log[0].fx, ['leave']);
  assert.equal(run(st(), 'BACK').state.ui, 'H');
});

test('C（操作画面）: 戻るで隠す（再生はそのまま）', () => {
  const r = run(st({ ui: 'C', focus: 'row' }), 'BACK');
  assert.equal(r.state.ui, 'H');
  assert.deepEqual(r.log[0].fx, ['hide']);
});

test('C: ↑ はボタン列 → 進行バー、進行バーから ↑ で隠れる。↓ は進行バー → ボタン列', () => {
  let r = run(st({ ui: 'C', focus: 'row' }), 'UP');
  assert.equal(r.state.focus, 'bar');
  assert.equal(r.state.ui, 'C');
  r = run(r.state, 'UP');
  assert.equal(r.state.ui, 'H', '進行バーから ↑ で隠れる');
  r = run(st({ ui: 'C', focus: 'bar' }), 'DOWN');
  assert.equal(r.state.focus, 'row');
  assert.equal(r.state.ui, 'C');
  r = run(r.state, 'DOWN');
  assert.equal(r.state.ui, 'C', 'ボタン列から ↓ は何も起きない（YouTube の関連動画は無い）');
  assert.equal(r.state.focus, 'row');
});

test('C: 進行バーで ← → を押すと、すぐスクラブ（その場で ±10 秒ぶん動く）', () => {
  const r = run(st({ ui: 'C', focus: 'bar' }), 'RIGHT');
  assert.equal(r.state.ui, 'S');
  assert.deepEqual(r.log[0].fx, ['scrubStart', 'scrubStep:1']);
  assert.deepEqual(run(st({ ui: 'C', focus: 'bar' }), 'LEFT').log[0].fx, ['scrubStart', 'scrubStep:-1']);
});

test('C: ボタン列の ← → はフォーカス移動（行の端で折り返さない判断は DOM 側）', () => {
  const r = run(st({ ui: 'C', focus: 'row' }), 'LEFT', 'RIGHT');
  assert.deepEqual(r.log[0].fx, ['rowMove:-1', 'touch']);
  assert.deepEqual(r.log[1].fx, ['rowMove:1', 'touch']);
  assert.equal(r.state.ui, 'C');
});

test('C: OK は進行バーなら再生/一時停止、ボタンならそのボタンを押す', () => {
  assert.deepEqual(run(st({ ui: 'C', focus: 'bar' }), 'OK').log[0].fx, ['togglePause', 'touch']);
  assert.deepEqual(run(st({ ui: 'C', focus: 'row' }), 'OK').log[0].fx, ['activate', 'touch']);
});

test('C: そのほかのキーは自動で隠すタイマーを延ばすだけ（横取りはする）', () => {
  const r = run(st({ ui: 'C', focus: 'row' }), 'GREEN');
  assert.deepEqual(r.log[0].fx, ['touch']);
  assert.equal(r.log[0].consume, true);
});

test('S（スクラブ）: ← → / 早送り・巻き戻しで 1 回ずつ動く。OK で確定して隠す', () => {
  const s = st({ ui: 'S', focus: 'bar' });
  for (const [k, d] of [['LEFT', -1], ['RIGHT', 1], ['SEEK_BACK', -1], ['SEEK_FWD', 1]]) {
    const r = run(s, k);
    assert.equal(r.state.ui, 'S');
    assert.deepEqual(r.log[0].fx, ['scrubStep:' + d]);
  }
  const r = run(s, 'OK');
  assert.equal(r.state.ui, 'H');
  assert.deepEqual(r.log[0].fx, ['scrubCommit', 'hide']);
});

test('S: 戻る・↑・↓ は取り消して、進行バーにフォーカスした操作画面に戻る', () => {
  for (const k of ['BACK', 'UP', 'DOWN']) {
    const r = run(st({ ui: 'S', focus: 'bar' }), k);
    assert.equal(r.state.ui, 'C', k);
    assert.equal(r.state.focus, 'bar', k);
    assert.deepEqual(r.log[0].fx, ['scrubCancel', 'show', 'focus:bar'], k);
  }
});

test('S: 時間切れはない（IDLE を受けても何も起きない）。そのほかのキーは無視', () => {
  const r = run(st({ ui: 'S', focus: 'bar' }), 'IDLE', 'GREEN');
  assert.equal(r.state.ui, 'S');
  assert.deepEqual(r.log[0].fx, []);
  assert.deepEqual(r.log[1].fx, []);
});

test('IDLE: 操作画面だけが隠れる。非表示のままなら何もしない', () => {
  assert.equal(run(st({ ui: 'C' }), 'IDLE').state.ui, 'H');
  assert.deepEqual(run(st({ ui: 'C' }), 'IDLE').log[0].fx, ['hide']);
  assert.deepEqual(run(st({ ui: 'H' }), 'IDLE').log[0].fx, []);
});

test('広告・ライブ・シーク不可（noSeek）: スクラブを始めない。操作画面は出る', () => {
  const ad = { noSeek: true };
  assert.equal(run(st({ ui: 'C', focus: 'bar', ...ad }), 'RIGHT').state.ui, 'C');
  assert.deepEqual(run(st({ ui: 'C', focus: 'bar', ...ad }), 'RIGHT').log[0].fx, ['touch']);
  assert.equal(run(st({ ui: 'C', focus: 'row', ...ad }), 'SEEK_FWD').state.ui, 'C');
  const h = run(st(ad), 'SEEK_FWD');
  assert.equal(h.state.ui, 'C');
  assert.deepEqual(h.log[0].fx, ['show', 'focus:row']);
  // 再生/一時停止とボタン列の移動は広告中も使える
  assert.deepEqual(run(st({ ui: 'C', focus: 'bar', ...ad }), 'OK').log[0].fx, ['togglePause', 'touch']);
  assert.deepEqual(run(st({ ui: 'C', focus: 'row', ...ad }), 'RIGHT').log[0].fx, ['rowMove:1', 'touch']);
});

test('ポップアップ（再生速度・画質）: 矢印はサイトに任せ、OK は選んで閉じる、戻るは閉じる', () => {
  const s = st({ ui: 'C', focus: 'row', popup: true });
  for (const k of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    const r = W.reduce(s, k);
    assert.equal(r.consume, false, k);
    assert.deepEqual(r.effects, []);
  }
  assert.deepEqual(dos(W.reduce(s, 'OK')), ['popupSelect']);
  assert.equal(W.reduce(s, 'OK').consume, true);
  const b = W.reduce(s, 'BACK');
  assert.deepEqual(dos(b), ['escapePopup']);
  assert.equal(b.consume, false, 'Esc そのものは Radix が受け取る。Esc 以外の戻るキーは DOM 側で Esc に置き換える');
  assert.equal(W.reduce(s, 'BACK').state.ui, 'C', 'ポップアップを閉じても操作画面は残る');
});

test('再生が終わった: OK で次のエピソード、戻る・停止で案内を閉じる。矢印はサイトへ', () => {
  const s = st({ ended: true });
  assert.deepEqual(dos(W.reduce(s, 'OK')), ['playNext']);
  assert.deepEqual(dos(W.reduce(s, 'BACK')), ['cancelNext']);
  assert.deepEqual(dos(W.reduce(s, 'STOP')), ['cancelNext']);
  assert.equal(W.reduce(s, 'LEFT').consume, false);
});

test('reduce は渡された状態を書き換えない', () => {
  const s = Object.freeze(st({ ui: 'C', focus: 'bar' }));
  assert.doesNotThrow(() => W.reduce(s, 'RIGHT'));
  assert.equal(s.ui, 'C');
});

test('通し: H → → で操作画面（バー）→ → でスクラブ → → でもう 1 回 → OK で確定 → 隠れる', () => {
  const r = run(st(), 'RIGHT', 'RIGHT', 'RIGHT', 'OK');
  assert.deepEqual(
    r.log.map((l) => l.ui),
    ['C', 'S', 'S', 'H'],
  );
  assert.deepEqual(r.log[1].fx, ['scrubStart', 'scrubStep:1']);
  assert.deepEqual(r.log[3].fx, ['scrubCommit', 'hide']);
});
