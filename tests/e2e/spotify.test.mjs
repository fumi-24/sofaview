// Spotify: タブは 1 つ。Spotify のページが、そのまま、自前の再生中の画面になる（Spotify 自身の画面は、文書の外に描かれる）。E2E（ネットワーク不要。起動の再現ページ）。
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, until } from './helpers.mjs';
import { spotifyHtml } from '../fixtures/spotify.mjs';

let env;
test.before(async () => {
  env = await launch();
});
test.after(async () => {
  await env.close();
});
afterEach(async () => {
  for (const p of env.ctx.pages()) await p.close().catch(() => {}); // 失敗しても、次のテストに持ち越さない
});

const setSp = (sp) => env.sw.evaluate((sp) => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: sp } }, r)), sp);
const fx = (page, k) => page.evaluate((k) => window.__fx[k], k);
const ready = (page) => until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1').catch(() => false), { message: 'sv ready' });
const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
const tabId = (page) => page.evaluate(() => new Promise((r) => chrome.tabs.getCurrent((t) => r(t.id)))); // 拡張のページ自身の tab id
const activeId = () => env.sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
};

/** Spotify のページ（起動の再現）を開く。画面は、そのまま自前の再生中の画面。 */
async function open(opt) {
  const page = await env.ctx.newPage();
  await page.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml(opt) }));
  await page.goto('https://open.spotify.com/intl-ja/');
  await ready(page);
  await page.bringToFront();
  return page;
}
const kindOf = (page) => page.locator('#sv-np').getAttribute('data-kind');
const appLog = async (page, from = 0) => (await fx(page, 'log')).slice(from).filter((l) => l.ev === 'app').map((l) => l.action + (l.arg != null ? ':' + l.arg : ''));

test('Spotify: タブは 1 つ。Spotify 自身の画面は、文書の外に描かれる（文書には、自前の画面だけ）。曲名・アーティスト・再生位置・歌詞は、アプリ自身のサービスから', async () => {
  await setSp({ lyrics: true });
  const page = await open();
  const root = page.locator('#sv-np');
  await until(async () => (await kindOf(page)) === 'track', { message: '曲の画面' });
  assert.match(await root.innerText(), /テスト曲のタイトル/);
  assert.match(await root.innerText(), /テスト歌手/);
  assert.match(await root.innerText(), /0:5\d/, '再生位置は、アプリの状態（positionAsOfTimestamp）から。経過時間で進む');
  assert.match(await root.innerText(), /2:55/);
  await until(async () => /経路 アプリ/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: 'アプリのサービスから読んでいる' });
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞（React の部品の props から）' });
  assert.match(await root.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/);
  // Spotify の画面は、文書の外の要素に描かれた（起動のとき createRoot の描画先を替えた）
  assert.deepEqual(await fx(page, 'rendered'), { containerConnected: false, containerIsMain: false }, 'Spotify の画面の描画先は、文書の外');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid], main').length), 0, '文書に、Spotify の要素はない');
  await until(async () => (await page.evaluate(() => document.getElementById('main').children.length)) === 0, { timeout: 12000, message: '読み込みの骨組みも取り除く' });
});

test('Spotify: 操作は、Spotify のアプリ自身のサービス（PlayerAPI・PlaybackAPI）を呼ぶ。最初の ← → OK はボタンの列を出すだけ。最初のキーで、音を有効にする（activateElement）。メディアセッションは使わない', async () => {
  await setSp({ lyrics: false });
  const page = await open();
  const root = page.locator('#sv-np');
  await until(async () => (await kindOf(page)) === 'track', { message: '曲の画面' });
  await until(async () => /経路 アプリ/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: 'アプリのサービスから読んでいる' });
  const controls = root.locator('.sv-np-controls');
  assert.equal(await controls.isVisible(), false, '操作するまで、ボタンは出ない');
  const mark = (await fx(page, 'log')).length;
  await press(page, 'Enter'); // 列を出すだけ
  assert.equal(await controls.isVisible(), true);
  assert.deepEqual(await appLog(page, mark), ['activate'], '最初のキーで、音を有効にする。再生などは、まだ操作しない');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  assert.equal(await focused(), 'play');
  await press(page, 'Enter'); // 再生（resume）
  await until(async () => (await root.getAttribute('data-state')) === 'playing', { message: '再生状態はアプリの状態（isPaused）から' });
  await until(async () => /^transform 12\d(\.\d+)?s linear$/.test(await root.locator('.sv-np-fill').evaluate((e) => e.style.transition)), { message: '残り時間をかけた直線の動き' });
  const before = await root.locator('.sv-np-fill').evaluate((e) => e.style.transition);
  await page.waitForTimeout(1200);
  assert.equal(await root.locator('.sv-np-fill').evaluate((e) => e.style.transition), before, '指示は出し直されない（毎回書き換えない）');
  await press(page, 'Enter'); // 一時停止
  await until(async () => (await root.getAttribute('data-state')) === 'paused', { message: '一時停止になる' });
  await press(page, 'ArrowRight');
  assert.equal(await focused(), 'fwd');
  await press(page, 'Enter'); // +10 秒
  await press(page, 'ArrowRight');
  await press(page, 'Enter'); // 次の曲
  for (let i = 0; i < 4; i++) await press(page, 'ArrowLeft');
  assert.equal(await focused(), 'prev');
  await press(page, 'Enter'); // 前の曲
  await press(page, 'Escape');
  await press(page, 'ArrowDown'); // 音量 −10%
  await until(async () => (await appLog(page, mark)).some((a) => a.startsWith('volume')), { message: '音量が、アプリのサービスで動く' });
  const acts = (await appLog(page, mark)).filter((a) => a !== 'activate');
  assert.deepEqual(acts.map((a) => a.split(':')[0]), ['resume', 'pause', 'seekTo', 'next', 'prev', 'volume']);
  const seekMs = Number(acts.find((a) => a.startsWith('seekTo')).split(':')[1]);
  assert.ok(seekMs >= 60000 && seekMs < 64000, '一時停止した位置 + 10 秒: ' + seekMs);
  assert.equal(acts.find((a) => a.startsWith('volume')), 'volume:0.9');
  assert.equal((await fx(page, 'log')).slice(mark).filter((l) => l.ev === 'ms').length, 0, 'メディアセッションは使わない');
  // 戻るで、まず列が隠れる（画面は閉じない）
  await press(page, 'ArrowRight');
  await press(page, 'Escape');
  assert.equal(await controls.isVisible(), false);
  // キーは、Spotify のページには届かない
  await page.evaluate(() => { window.__seen = []; window.addEventListener('keydown', (e) => window.__seen.push(e.key)); });
  await press(page, 'ArrowLeft');
  assert.deepEqual(await page.evaluate(() => window.__seen), [], 'キーは、自前の画面が受ける（Spotify のページには届かない）');
});

test('Spotify: （アプリのサービスが見つからないときの代わり）メディアセッションで操作する。再生位置は setPositionState から', async () => {
  await setSp({ lyrics: false });
  const page = await open({ noApp: true });
  const root = page.locator('#sv-np');
  await until(async () => (await kindOf(page)) === 'track', { message: '曲の画面（メディアセッションから）' });
  await until(async () => /経路 標準API/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: 'メディアセッションから読んでいる' });
  assert.match(await root.innerText(), /0:5\d/, '再生位置は setPositionState から');
  const mark = (await fx(page, 'log')).length;
  await press(page, 'Enter');
  await press(page, 'Enter'); // 再生
  await until(async () => (await root.getAttribute('data-state')) === 'playing', { message: '再生状態は mediaSession.playbackState から' });
  await press(page, 'Enter'); // 一時停止
  await press(page, 'ArrowRight');
  await press(page, 'Enter'); // +10 秒 → seekto
  await press(page, 'ArrowRight');
  await press(page, 'Enter'); // 次の曲
  for (let i = 0; i < 4; i++) await press(page, 'ArrowLeft');
  await press(page, 'Enter'); // 前の曲
  const ms = (await fx(page, 'log')).slice(mark).filter((l) => l.ev === 'ms');
  assert.deepEqual(ms.map((l) => l.action), ['play', 'pause', 'seekto', 'next', 'prev']);
  const seekTime = ms.find((l) => l.action === 'seekto').time;
  assert.ok(seekTime >= 60 && seekTime < 64, '再生した分（約 1〜3 秒）進んだ位置 + 10 秒: ' + seekTime);
});

test('Spotify: ログインしていないと、状態の画面で理由と、やることを出す（ログインは、プラットフォームのセッションから分かる）。OK で、アプリ自身のログインの処理を呼ぶ。曲がなければ、待つ画面（手順つき）か、再生できない理由', async () => {
  const page = await open({ loggedOut: true, noTrack: true });
  const root = page.locator('#sv-np');
  await until(async () => (await kindOf(page)) === 'loggedOut', { message: 'ログインしていない画面' });
  assert.equal(await root.getAttribute('data-view'), 'status');
  assert.match(await root.innerText(), /Spotify にログインしていません/);
  assert.match(await root.innerText(), /OK でログイン画面を開く/);
  await press(page, 'Enter');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'login'), { message: 'アプリ自身のログインの処理が呼ばれる' });
  await page.close();

  const page2 = await open({ noTrack: true });
  const drm = await page2.evaluate(() => navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }]).then(() => true, () => false));
  const kind = drm ? 'idle' : 'noDrm';
  await until(async () => (await kindOf(page2)) === kind, { timeout: 12000, message: '保護機能の有無に合った画面: ' + kind });
  const r2 = page2.locator('#sv-np');
  assert.equal(await r2.getAttribute('data-view'), 'status');
  if (drm) {
    assert.match(await r2.innerText(), /スマホの Spotify から、再生してください/);
    assert.match(await r2.innerText(), /デバイスに接続/);
  } else {
    assert.match(await r2.innerText(), /再生できません/);
    assert.match(await r2.innerText(), /Widevine/);
  }
  // 曲がないときは、方向キー・OK は何もしない
  const before = (await fx(page2, 'log')).length;
  for (const k of ['ArrowLeft', 'ArrowDown', 'Enter']) await press(page2, k);
  assert.deepEqual((await fx(page2, 'log')).slice(before).filter((l) => l.ev === 'app' && l.action !== 'activate'), []);
});

test('Spotify: 歌詞のオン/オフ。ボタンで切り替えると設定に保存され、アプリ内の移動（/lyrics）で歌詞の画面を作らせる。オフの間は歌詞を出さない', async () => {
  await setSp({ lyrics: true });
  const page = await open();
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞が出る' });
  assert.equal(await root.locator('.sv-np-ly-track').evaluate((e) => e.style.getPropertyValue('--cur')), '2', 'いまの行（3 行目）が真ん中に来る位置');
  assert.ok((await fx(page, 'log')).some((l) => l.ev === 'nav' && /\/intl-ja\/lyrics$/.test(l.to)), 'アプリ内の移動で、歌詞の画面へ（言語の接頭辞を保つ）');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  for (let i = 0; i < 4; i++) await press(page, 'ArrowRight'); // 列を出す + 3 つ右
  assert.equal(await focused(), 'lyrics');
  assert.match(await root.locator('[data-id="lyrics"]').innerText(), /オン/);
  await press(page, 'Enter');
  await until(async () => (await root.locator('.sv-np-lyrics').isVisible()) === false, { message: '歌詞が消える' });
  assert.match(await root.locator('[data-id="lyrics"]').innerText(), /オフ/);
  const saved = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.get('sv.settings', (v) => r(v['sv.settings'].spotify.lyrics))));
  await until(async () => (await saved()) === false, { message: '設定に保存される' });
  await until(async () => (await fx(page, 'log')).filter((l) => l.ev === 'nav').pop().to === '/intl-ja/', { timeout: 8000, message: '歌詞の画面から戻る' });
  await press(page, 'Enter');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞がまた出る' });
  await until(async () => (await root.locator('.sv-np-controls').isVisible()) === false, { timeout: 8000, message: '5 秒で隠れる' });
});

test('Spotify: Home でハブへ（Spotify のタブは動かさず、音楽が止まらない。ハブは新しいタブで前面に出る）。ハブの Spotify タイルは、開いている Spotify のタブを前面に出す', async () => {
  await setSp({ lyrics: false });
  const page = await open();
  await until(async () => (await kindOf(page)) === 'track', { message: '曲の画面' });
  const spId = (await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).id;
  await press(page, 'Home');
  await until(async () => (await activeId()) !== spId, { message: 'ハブが前面に出る' });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).id, spId, 'Spotify のタブは同じまま（音楽が止まらない）');
  const hub = env.ctx.pages().find((p) => p.url() === env.hubUrl);
  assert.ok(hub, 'ハブが開く');
  await ready(hub);
  await hub.locator('a.tile-sp').focus();
  await hub.keyboard.press('Enter');
  await until(async () => (await activeId()) === spId, { message: 'Spotify のタブが前面に戻る' });
  assert.equal((await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length, 1, 'Spotify のタブは 1 つのまま');
});

test('Spotify: 「裏で開いておく」をオンにすると、Spotify が裏のタブで開く。スマホから再生が始まる（曲が変わる）と、そのタブが前面に出る。ハブのタイルに状態が出る', async () => {
  for (const p of env.ctx.pages()) await p.close().catch(() => {});
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await ready(hub);
  await env.sw.evaluate(() => chrome.storage.session.remove(['svSpotifyAt', 'svSpotifyState']));
  await setSp({ standby: true, lyrics: false });
  await until(async () => (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length === 1, { message: '裏の Spotify が開く' });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, false, '前面を奪わない');
  const sp = env.ctx.pages().find((p) => p.url().startsWith('https://open.spotify.com/'));
  await sp.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml() }));
  await sp.reload(); // 拡張が作ったタブは、Playwright が付く前に読み込みが始まるので、再現ページにするため読み込み直す
  await ready(sp);
  await hub.bringToFront();
  await until(async () => /再生中: テスト曲のタイトル/.test(await hub.locator('#sp-sub').innerText()), { timeout: 12000, message: 'ハブのタイルに状態' });
  // スマホから再生が始まった（曲が変わった）
  await sp.evaluate(() => window.__fx.setTrack('スマホから送った曲'));
  await until(async () => (await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, { timeout: 10000, message: 'Spotify のタブが前面に出る' });
  await until(async () => /スマホから送った曲/.test(await sp.locator('#sv-np').innerText()), { timeout: 10000, message: '新しい曲が出る' });
  await setSp({ standby: false });
});

test('Spotify 診断（読み取りだけ）: アプリの内部の「形」（部品の名前・種類・メソッド名）だけを集めて、診断ページに出す。文字の値（トークン・ID・曲名など）は含めない', async () => {
  await setSp({ lyrics: false });
  const sp = await open();
  const page = await env.ctx.newPage();
  await page.goto(env.hubUrl.replace('index.html', 'spotify-diag.html'));
  await page.bringToFront();
  await page.click('#run');
  await until(async () => /部品の数/.test(await page.locator('#summary').innerText()), { timeout: 15000, message: '報告が出る' });
  const report = JSON.parse(await page.locator('#out').innerText());
  const player = report.candidates.find((c) => c.prop === 'playerAPI');
  assert.ok(player, 'プレーヤーの API らしい部品が見つかる');
  for (const k of ['play', 'pause', 'resume', 'seekTo', 'skipToNext', 'skipToPrevious', 'getState']) assert.ok(Object.keys(player.shape).includes(k), 'メソッド ' + k);
  assert.equal(report.playerState.isPaused, 'boolean', '状態の「形」だけ（値は入らない）');
  assert.equal(report.playerState.item.name, 'str');
  assert.ok(report.volumeCandidates.some((c) => c.prop === 'standalonePlayer'), '音量・音声のサービス');
  assert.ok(report.platform && report.platform.keys.includes('getRegistry'), 'プラットフォームの部品');
  assert.deepEqual(report.platform.Session, { isAnonymous: 'boolean', market: 'str' });
  assert.equal(report.boot.patched, true, '起動の入口（createRoot の包み）が効いている');
  assert.ok(!/SECRET/.test(JSON.stringify(report)), '文字の値（トークン・ID・市場など）は報告に含まれない');
  assert.equal(await page.locator('#save').isDisabled(), false, '保存できる');
  await sp.close();
});
