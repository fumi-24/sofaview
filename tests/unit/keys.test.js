'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const keys = require('../../extension/common/keys.js');

const ev = (o) => Object.assign({ key: '', code: '', keyCode: 0, isTrusted: true }, o);

test('既定の割り当て: 十字キー・決定・戻る・ホーム', () => {
  const m = keys.createMatcher();
  assert.equal(m.match(ev({ key: 'ArrowUp' })), 'UP');
  assert.equal(m.match(ev({ key: 'ArrowDown' })), 'DOWN');
  assert.equal(m.match(ev({ key: 'ArrowLeft' })), 'LEFT');
  assert.equal(m.match(ev({ key: 'ArrowRight' })), 'RIGHT');
  assert.equal(m.match(ev({ key: 'Enter' })), 'OK');
  assert.equal(m.match(ev({ key: 'Escape' })), 'BACK');
  assert.equal(m.match(ev({ key: 'Backspace' })), 'BACK');
  assert.equal(m.match(ev({ key: 'BrowserBack' })), 'BACK');
  assert.equal(m.match(ev({ key: 'Home' })), 'HOME');
  assert.equal(m.match(ev({ key: 'BrowserHome' })), 'HOME');
});

test('メディアキー・カラーキー', () => {
  const m = keys.createMatcher();
  assert.equal(m.match(ev({ key: 'MediaPlayPause' })), 'PLAY_PAUSE');
  assert.equal(m.match(ev({ key: 'MediaFastForward' })), 'SEEK_FWD');
  assert.equal(m.match(ev({ key: 'MediaRewind' })), 'SEEK_BACK');
  assert.equal(m.match(ev({ key: 'MediaTrackNext' })), 'NEXT');
  assert.equal(m.match(ev({ key: 'ColorF0Red' })), 'RED');
});

test('code でも判定する（テンキーのEnter）', () => {
  const m = keys.createMatcher();
  assert.equal(m.match(ev({ key: 'Enter', code: 'NumpadEnter' })), 'OK');
  assert.equal(m.match(ev({ key: 'Unidentified', code: 'NumpadEnter' })), 'OK');
});

test('未割り当てのキーは null', () => {
  const m = keys.createMatcher();
  assert.equal(m.match(ev({ key: 'a' })), null);
  assert.equal(m.match(ev({ key: ' ' })), null);
  assert.equal(m.match(null), null);
});

test('追加の割り当ては既定に「追加」される（既定は消えない）', () => {
  const m = keys.createMatcher({ HOME: ['F1', 'XF86Home'], BACK: ['q'] });
  assert.equal(m.match(ev({ key: 'F1' })), 'HOME');
  assert.equal(m.match(ev({ key: 'XF86Home' })), 'HOME');
  assert.equal(m.match(ev({ key: 'Home' })), 'HOME');
  assert.equal(m.match(ev({ key: 'q' })), 'BACK');
  assert.equal(m.match(ev({ key: 'Escape' })), 'BACK');
});

test('key が Unidentified のときだけ keyCode の予備表を使う', () => {
  const m = keys.createMatcher();
  assert.equal(m.match(ev({ key: 'Unidentified', keyCode: 10009 })), 'BACK'); // Tizen
  assert.equal(m.match(ev({ key: '', keyCode: 461 })), 'BACK'); // webOS
  assert.equal(m.match(ev({ key: 'Unidentified', keyCode: 417 })), 'SEEK_FWD');
  assert.equal(m.match(ev({ key: 'x', keyCode: 10009 })), null);
});

test('shouldIgnore: 合成イベント・修飾キー併用は無視', () => {
  assert.equal(keys.shouldIgnore(ev({ key: 'Enter' })), false);
  assert.equal(keys.shouldIgnore(ev({ key: 'Enter', isTrusted: false })), true);
  assert.equal(keys.shouldIgnore(ev({ key: 'ArrowLeft', altKey: true })), true);
  assert.equal(keys.shouldIgnore(ev({ key: 'r', ctrlKey: true })), true);
  assert.equal(keys.shouldIgnore(ev({ key: 'a', metaKey: true })), true);
  assert.equal(keys.shouldIgnore(ev({ key: 'a', isComposing: true })), true);
  assert.equal(keys.shouldIgnore(null), true);
});

test('isEditable: 文字入力欄だけ true', () => {
  assert.equal(keys.isEditable({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(keys.isEditable({ tagName: 'input', type: 'search' }), true);
  assert.equal(keys.isEditable({ tagName: 'INPUT' }), true);
  assert.equal(keys.isEditable({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(keys.isEditable({ tagName: 'INPUT', type: 'button' }), false);
  assert.equal(keys.isEditable({ tagName: 'TEXTAREA' }), true);
  assert.equal(keys.isEditable({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(keys.isEditable({ tagName: 'A' }), false);
  assert.equal(keys.isEditable(null), false);
});

test('isDirection / isRepeatable', () => {
  assert.equal(keys.isDirection('UP'), true);
  assert.equal(keys.isDirection('OK'), false);
  assert.equal(keys.isRepeatable('LEFT'), true);
  assert.equal(keys.isRepeatable('SEEK_FWD'), true);
  assert.equal(keys.isRepeatable('OK'), false);
  assert.equal(keys.isRepeatable('HOME'), false);
});

test('RepeatGate: OK/BACK/HOME のリピートは通さない', () => {
  let t = 0;
  const g = new keys.RepeatGate({ maxPerSec: 10, now: () => t });
  assert.equal(g.allow('OK', { repeat: false }), true);
  assert.equal(g.allow('OK', { repeat: true }), false);
  assert.equal(g.allow('BACK', { repeat: true }), false);
  assert.equal(g.allow('HOME', { repeat: true }), false);
});

test('RepeatGate: 方向キーのリピートは 1 秒あたり maxPerSec 回に制限', () => {
  let t = 1000;
  const g = new keys.RepeatGate({ maxPerSec: 10, now: () => t }); // 100ms 間隔
  assert.equal(g.allow('RIGHT', { repeat: false }), true); // 最初の押下は通る
  t += 30;
  assert.equal(g.allow('RIGHT', { repeat: true }), false);
  t += 30;
  assert.equal(g.allow('RIGHT', { repeat: true }), false);
  t += 50; // 110ms 経過
  assert.equal(g.allow('RIGHT', { repeat: true }), true);
  t += 10;
  assert.equal(g.allow('RIGHT', { repeat: true }), false);
  // 別アクションは独立
  assert.equal(g.allow('DOWN', { repeat: true }), true);
});

test('RepeatGate: 連打（repeat でない押下）は常に通す', () => {
  let t = 0;
  const g = new keys.RepeatGate({ maxPerSec: 5, now: () => t });
  for (let i = 0; i < 5; i++) {
    assert.equal(g.allow('DOWN', { repeat: false }), true);
    t += 5;
  }
});

test('RepeatGate: 処理待ちで溜まった古いリピートは捨てる（離したあとも走り続けない）。単押しは古くても通す', () => {
  let t = 1000;
  let perf = 5000;
  const g = new keys.RepeatGate({ maxPerSec: 10, now: () => t, perfNow: () => perf, staleMs: 150 });
  assert.equal(g.allow('RIGHT', { repeat: false, timeStamp: 100 }), true); // 単押しは遅れていても通す
  t += 200;
  assert.equal(g.allow('RIGHT', { repeat: true, timeStamp: perf - 40 }), true); // 40ms 遅れ: 通す
  t += 200;
  assert.equal(g.allow('RIGHT', { repeat: true, timeStamp: perf - 400 }), false); // 400ms 遅れ（溜まっていた）: 捨てる
  t += 200;
  assert.equal(g.allow('RIGHT', { repeat: true, timeStamp: 0 }), true); // 時刻なし（合成イベント）は判定しない
});

test('HoldDetector: 長押しで一度だけ発火し、離すとリセット', () => {
  let t = 0;
  const h = new keys.HoldDetector({ holdMs: 800, now: () => t });
  assert.equal(h.feed('BACK', { repeat: false }), false);
  t = 400;
  assert.equal(h.feed('BACK', { repeat: true }), false);
  t = 820;
  assert.equal(h.feed('BACK', { repeat: true }), true);
  t = 900;
  assert.equal(h.feed('BACK', { repeat: true }), false); // 一度だけ
  h.release('BACK');
  t = 1000;
  assert.equal(h.feed('BACK', { repeat: false }), false);
  t = 1900;
  assert.equal(h.feed('BACK', { repeat: true }), true); // 新しい押下で再び
});

test('describe: 診断用のフィールドを返す', () => {
  const d = keys.describe(ev({ key: 'Home', code: 'Home', keyCode: 36, location: 0, repeat: true, shiftKey: true }));
  assert.deepEqual(d, { key: 'Home', code: 'Home', keyCode: 36, location: 0, repeat: true, shift: true, ctrl: false, alt: false, meta: false });
});

test('DEFAULT_BINDINGS はすべての ACTIONS を含む', () => {
  for (const a of keys.ACTIONS) assert.ok(Array.isArray(keys.DEFAULT_BINDINGS[a]), a);
});
