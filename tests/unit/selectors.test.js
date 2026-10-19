'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../../extension/sites/tver/selectors.js');

const docWith = (hasEpisodeMarker) => ({ querySelector: (sel) => (hasEpisodeMarker && sel === T.SEL.episodePage ? {} : null) });

test('pageType: URL からページ種別を判定する', () => {
  assert.equal(T.pageType('/'), 'home');
  assert.equal(T.pageType('/search'), 'search');
  assert.equal(T.pageType('/episodes/ep123'), 'episode');
  assert.equal(T.pageType('/series/sr123/'), 'series');
  assert.equal(T.pageType('/live/tokyo'), 'live');
  assert.equal(T.pageType('/categories/drama'), 'list');
  assert.equal(T.pageType('/something-new'), 'other');
});

test('detectType: URL で分かるものは DOM を見ない', () => {
  assert.equal(T.detectType('/', docWith(true)), 'home');
  assert.equal(T.detectType('/episodes/ep1', docWith(false)), 'episode');
});

test('detectType: URL の体系が変わっても data-episode-page があればエピソード', () => {
  assert.equal(T.detectType('/watch/ep1', docWith(true)), 'episode');
  assert.equal(T.detectType('/watch/ep1', docWith(false)), 'other');
});

const link = (href, target) => ({ tagName: 'A', getAttribute: (k) => (k === 'href' ? href : k === 'target' ? target || null : null) });

test('isExternalLink: tver.jp 以外（サブドメインを含む）と、新しいタブで開くリンクは対象外', () => {
  assert.equal(T.isExternalLink(link('/episodes/ep1')), false);
  assert.equal(T.isExternalLink(link('https://tver.jp/search')), false);
  assert.equal(T.isExternalLink(link('https://schedule-drama.tver.jp/meisaku')), true, 'サブドメインでは拡張が動かず戻れなくなる');
  assert.equal(T.isExternalLink(link('https://help.tver.jp/')), true);
  assert.equal(T.isExternalLink(link('https://x.com/TVer_official')), true);
  assert.equal(T.isExternalLink(link('https://tver.jp/_l/promo/', '_blank')), true, '新しいタブ');
  assert.equal(T.isExternalLink(link('mailto:a@b.c')), true);
});

const player = (...classes) => ({ classList: { contains: (c) => classes.includes(c) } });

test('playerFlags: 広告中・シーク不可の区間・ライブを、Video.js / Streaks のクラスから判定する', () => {
  assert.deepEqual(T.playerFlags(player(), null), { ad: false, noSeek: false, live: false });
  assert.equal(T.playerFlags(player('vjs-ad-playing'), null).ad, true);
  assert.equal(T.playerFlags(player('strp-adsactive'), null).ad, true);
  assert.equal(T.playerFlags(player('strp-adbreaking'), null).ad, true);
  assert.equal(T.playerFlags(player('strp-no-seek'), null).noSeek, true);
  assert.equal(T.playerFlags(player('vjs-live'), null).live, true);
  assert.equal(T.playerFlags(null, null).ad, false, 'プレイヤーが見つからなくても例外にしない');
});

test('playerFlags: duration が有限でない（ライブ）ときは、メタデータの読み込み後だけライブ扱い', () => {
  assert.equal(T.playerFlags(player(), { readyState: 4, duration: Infinity }).live, true);
  assert.equal(T.playerFlags(player(), { readyState: 0, duration: NaN }).live, false, '読み込み前は決めない');
  assert.equal(T.playerFlags(player(), { readyState: 4, duration: 1500 }).live, false);
});

test('meta: 題名と、番組名 • 放送局 • 放送日（/tv の「チャンネル • 再生回数 • 日付」の位置）', () => {
  const el = (t) => ({ textContent: t });
  const doc = {
    title: '第1話 | TVer',
    querySelector: (sel) =>
      ({ [T.SEL.episodeTitle]: el('第1話 サンプル'), [T.SEL.seriesTitle]: el('テスト番組'), [T.SEL.producer]: el(' テスト放送局 '), [T.SEL.broadcastDate]: el('10月10日(土)放送分') })[sel] || null,
  };
  assert.deepEqual(T.meta(doc), { title: '第1話 サンプル', subtitle: 'テスト番組 • テスト放送局 • 10月10日(土)放送分' });
  // 見出しが描画されていないときは、document.title の先頭を題名にする
  assert.deepEqual(T.meta({ title: '第1話 | TVer', querySelector: () => null }), { title: '第1話', subtitle: '' });
});

test('WATCH_BTN: 操作盤のボタンは ARIA ラベルで探す（クラス名に依存しない）', () => {
  for (const sel of Object.values(T.WATCH_BTN)) assert.match(sel, /aria-label/, sel);
  assert.match(T.WATCH_BTN.play, /"一時停止"/);
  assert.match(T.WATCH_BTN.fullscreen, /"全画面を終了"/);
});

test('initialPrefer: エピソードの初期フォーカスは TVer 自身の再生ボタン（#episode-play）', () => {
  assert.equal(T.initialPrefer('episode')[0], '#episode-play');
});
