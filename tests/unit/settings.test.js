'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const settings = require('../../extension/common/settings.js');

test.beforeEach(() => {
  settings._setAdapter(null);
  settings._clearMemory();
});

test('既定値', async () => {
  const s = await settings.load();
  assert.equal(s.zoom.mode, 'auto');
  assert.equal(s.zoom.targetHeight, 720);
  assert.equal(s.holdMs, 800);
  assert.equal(s.tver.hideHeader, true);
  assert.equal(s.tver.nativeFullscreen, true);
  assert.equal(s.youtube.redirect, false);
  assert.deepEqual(s.bindings, {});
});

test('save は既定値にマージされ、範囲チェックされる', async () => {
  const s = await settings.save({ holdMs: 99999, zoom: { mode: 'weird', factor: 9 } });
  assert.equal(s.holdMs, 3000);
  assert.equal(s.zoom.mode, 'auto');
  assert.equal(s.zoom.factor, 4);
  assert.equal(s.tver.nativeFullscreen, true); // 触っていない項目は既定のまま
  assert.equal('seekStep' in s, false, '視聴画面は /tv と同じ固定の動きなので、シーク秒数・HUD の設定はない');
});

test('save → load で値が残る（部分更新）', async () => {
  await settings.save({ tver: { hideHeader: false } });
  await settings.save({ youtube: { redirect: true } });
  const s = await settings.load();
  assert.equal(s.tver.hideHeader, false);
  assert.equal(s.tver.hideAppCta, true);
  assert.equal(s.youtube.redirect, true);
});

test('bindings: 文字列だけを残し、重複を除き、12 件までに制限', async () => {
  const many = Array.from({ length: 30 }, (_, i) => 'K' + i);
  const s = await settings.save({ bindings: { HOME: ['F1', 'F1', 3, '', 'X'], BACK: many, OK: 'nope' } });
  assert.deepEqual(s.bindings.HOME, ['F1', 'X']);
  assert.equal(s.bindings.BACK.length, 12);
  assert.equal('OK' in s.bindings, false);
});

test('不正な保存値でも既定にフォールバックする', async () => {
  settings._setAdapter({ get: async () => ({ zoom: 'bad', holdMs: 'x', tver: null }), set: async () => {}, remove: async () => {} });
  const s = await settings.load();
  assert.equal(s.zoom.mode, 'auto');
  assert.equal(s.holdMs, 800);
  assert.equal(s.tver.hideHeader, true);
});

test('reset は既定に戻す', async () => {
  await settings.save({ holdMs: 1500 });
  const s = await settings.reset();
  assert.equal(s.holdMs, 800);
  assert.equal((await settings.load()).holdMs, 800);
});

test('sanitize は元の DEFAULTS を変更しない', () => {
  const before = JSON.stringify(settings.DEFAULTS);
  const s = settings.sanitize({ holdMs: 500 });
  s.zoom.mode = 'off';
  assert.equal(JSON.stringify(settings.DEFAULTS), before);
});

test('deepMerge は配列を置き換え、オブジェクトを再帰マージする', () => {
  const m = settings.deepMerge({ a: { x: 1, y: [1, 2] }, b: 1 }, { a: { y: [3] }, c: 2 });
  assert.deepEqual(m, { a: { x: 1, y: [3] }, b: 1, c: 2 });
});

test('save の replace: 指定したキーはマージせず置き換える（bindings を空にできる）', async () => {
  await settings.save({ bindings: { HOME: ['F1'], BACK: ['q'] } });
  let s = await settings.save({ bindings: { HOME: ['F2'] } });
  assert.deepEqual(s.bindings, { HOME: ['F2'], BACK: ['q'] }); // 通常はマージ
  s = await settings.save({ bindings: {} }, { replace: ['bindings'] });
  assert.deepEqual(s.bindings, {});
  s = await settings.save({ bindings: { OK: ['x'] } }, { replace: ['bindings'] });
  assert.deepEqual(s.bindings, { OK: ['x'] });
});

test('歌詞のタイミングの微調整: 既定は 0。−3〜+3 秒に収め、0.1 秒に丸める。数でないものは 0', async () => {
  assert.equal(settings.defaults().spotify.lyricsOffset, 0);
  assert.equal(settings.sanitize({ spotify: { lyricsOffset: 0.34 } }).spotify.lyricsOffset, 0.3);
  assert.equal(settings.sanitize({ spotify: { lyricsOffset: -0.26 } }).spotify.lyricsOffset, -0.3);
  assert.equal(settings.sanitize({ spotify: { lyricsOffset: 99 } }).spotify.lyricsOffset, 3);
  assert.equal(settings.sanitize({ spotify: { lyricsOffset: -99 } }).spotify.lyricsOffset, -3);
  assert.equal(settings.sanitize({ spotify: { lyricsOffset: 'x' } }).spotify.lyricsOffset, 0);
  assert.equal(Object.is(settings.sanitize({ spotify: { lyricsOffset: -0.01 } }).spotify.lyricsOffset, 0), true, '-0 にならない');
  const s = await settings.save({ spotify: { lyricsOffset: 0.5 } });
  assert.equal(s.spotify.lyricsOffset, 0.5);
});

test('MV の表示: 既定は full。full / split / off 以外は既定に戻す', async () => {
  assert.equal(settings.defaults().spotify.mvLayout, 'full');
  for (const v of ['full', 'split', 'off']) assert.equal(settings.sanitize({ spotify: { mvLayout: v } }).spotify.mvLayout, v);
  for (const v of ['x', 1, null, true]) assert.equal(settings.sanitize({ spotify: { mvLayout: v } }).spotify.mvLayout, 'full');
  const s = await settings.save({ spotify: { mvLayout: 'split' } });
  assert.equal(s.spotify.mvLayout, 'split');
});

test('MV の「映像に重ねる」: 既定は true。真偽以外は既定に戻す', async () => {
  assert.equal(settings.defaults().spotify.mvOverlap, true);
  assert.equal(settings.sanitize({ spotify: { mvOverlap: false } }).spotify.mvOverlap, false);
  assert.equal(settings.sanitize({ spotify: { mvOverlap: 'no' } }).spotify.mvOverlap, true);
  const s = await settings.save({ spotify: { mvOverlap: false } });
  assert.equal(s.spotify.mvOverlap, false);
});

test('MV の「自動で映像に切り替える」: 既定は true。真偽以外は既定に戻す', () => {
  assert.equal(settings.defaults().spotify.mvAuto, true);
  assert.equal(settings.sanitize({ spotify: { mvAuto: false } }).spotify.mvAuto, false);
  assert.equal(settings.sanitize({ spotify: { mvAuto: 0 } }).spotify.mvAuto, true);
});
