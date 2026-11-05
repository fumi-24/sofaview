// Spotify: 画面は拡張の自前ページ（spotify/np.html。前面）、再生エンジンは裏の Spotify のタブ（open.spotify.com。再現ページ）。E2E（ネットワーク不要）。
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

const NP_URL = () => env.hubUrl.replace('hub/index.html', 'spotify/np.html');
const setSp = (sp) => env.sw.evaluate((sp) => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: sp } }, r)), sp);
const fx = (page, k) => page.evaluate((k) => window.__fx[k], k);
const ready = (page) => until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1').catch(() => false), { message: 'sv ready' });
const tabId = (page) => page.evaluate(() => new Promise((r) => chrome.tabs.getCurrent((t) => r(t.id)))); // 拡張のページ自身の tab id
const activeId = () => env.sw.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0].id);
const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));

/** 裏の Spotify のタブ（再現ページ）を開く。 */
async function engine(opt) {
  const page = await env.ctx.newPage();
  await page.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml(opt) }));
  await page.goto('https://open.spotify.com/');
  await ready(page);
  return page;
}
/** 前面の再生中の画面（自前ページ）を開く。Spotify のタブは、先に開いておく（なければ拡張が作るが、Playwright の route が効かない）。 */
async function front() {
  const page = await env.ctx.newPage();
  await page.goto(NP_URL());
  await ready(page);
  await page.bringToFront();
  return page;
}
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
};
const closeAll = async () => {
  for (const p of env.ctx.pages()) await p.close().catch(() => {});
};
const kindOf = (np) => np.locator('#sv-np').getAttribute('data-kind');

test('Spotify: 再生中の画面は自前ページ。Spotify の部品は 1 つもなく、裏の Spotify のタブから、曲名・アーティスト・再生位置・歌詞が届く。Spotify のタブは、手を加えない（画面はそのまま見える・キーも奪わない）', async () => {
  await setSp({ lyrics: true });
  const sp = await engine();
  const np = await front();
  await until(async () => (await kindOf(np)) === 'track', { message: '曲の画面' });
  const root = np.locator('#sv-np');
  assert.match(await root.innerText(), /テスト曲のタイトル/);
  assert.match(await root.innerText(), /テスト歌手/);
  assert.match(await root.innerText(), /0:5\d/, '再生位置（setPositionState から。経過時間で進む）');
  assert.match(await root.innerText(), /2:55/);
  assert.equal(await root.getAttribute('data-state'), 'paused');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞（React の部品の props から）' });
  assert.match(await root.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/);
  assert.equal(await np.evaluate(() => document.querySelectorAll('[data-testid]').length), 0, '自前ページに、Spotify の要素はない');
  // Spotify のタブは、手を加えない
  assert.equal(await sp.evaluate(() => document.getElementById('main').getClientRects().length > 0), true, '画面はそのまま見える（隠さない・取り外さない）');
  assert.equal(await sp.evaluate(() => document.documentElement.classList.contains('sv-sp')), false);
  assert.equal(await sp.evaluate(() => /native code/.test(String(window.requestAnimationFrame))), true, 'requestAnimationFrame は差し替えない');
  await sp.evaluate(() => { window.__seen = []; window.addEventListener('keydown', (e) => window.__seen.push(e.key)); });
  await sp.bringToFront();
  await sp.keyboard.press('ArrowLeft');
  assert.deepEqual(await sp.evaluate(() => window.__seen), ['ArrowLeft'], '矢印キーは、Spotify のページにそのまま届く（拡張は奪わない）');
  await closeAll();
});

test('Spotify: 操作は、メディアセッション（OS のメディアキーと同じ標準の API）のハンドラを直接呼ぶ。最初の ← → OK はボタンの列を出すだけ。画面のボタンは押さない。位置の棒は、残り時間をかけた直線の動きを 1 回だけ指示する', async () => {
  await setSp({ lyrics: true });
  const sp = await engine();
  const np = await front();
  const root = np.locator('#sv-np');
  await until(async () => (await kindOf(np)) === 'track', { message: '曲の画面' });
  const controls = root.locator('.sv-np-controls');
  assert.equal(await controls.isVisible(), false, '操作するまで、ボタンは出ない');
  const mark = (await fx(sp, 'log')).length;
  await press(np, 'Enter'); // 列を出すだけ
  assert.equal(await controls.isVisible(), true);
  assert.equal((await fx(sp, 'log')).slice(mark).filter((l) => l.ev === 'ms').length, 0, '最初の OK は、何も操作しない');
  const focused = () => np.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  assert.equal(await focused(), 'play');
  await press(np, 'Enter'); // 再生
  await until(async () => (await root.getAttribute('data-state')) === 'playing', { message: '再生状態は mediaSession.playbackState から' });
  await until(async () => /^transform 12\d(\.\d+)?s linear$/.test(await root.locator('.sv-np-fill').evaluate((e) => e.style.transition)), { message: '残り時間をかけた直線の動き' });
  assert.equal(await root.locator('.sv-np-fill').evaluate((e) => e.style.transform), 'scaleX(1)');
  const before = await root.locator('.sv-np-fill').evaluate((e) => e.style.transition);
  await np.waitForTimeout(1200);
  assert.equal(await root.locator('.sv-np-fill').evaluate((e) => e.style.transition), before, '指示は出し直されない（毎回書き換えない）');
  await press(np, 'Enter'); // 一時停止（再生中なので pause）
  await press(np, 'ArrowRight');
  assert.equal(await focused(), 'fwd');
  await press(np, 'Enter'); // +10 秒 → seekto
  await press(np, 'ArrowRight');
  await press(np, 'Enter'); // 次の曲
  for (let i = 0; i < 4; i++) await press(np, 'ArrowLeft');
  assert.equal(await focused(), 'prev');
  await press(np, 'Enter'); // 前の曲
  const log = (await fx(sp, 'log')).slice(mark);
  const ms = log.filter((l) => l.ev === 'ms');
  assert.deepEqual(ms.map((l) => l.action), ['play', 'pause', 'seekto', 'next', 'prev']);
  const seekTime = ms.find((l) => l.action === 'seekto').time;
  assert.ok(seekTime >= 60 && seekTime < 64, '再生した分（約 1〜3 秒）進んだ位置 + 10 秒: ' + seekTime);
  assert.equal(log.filter((l) => l.ev === 'click').length, 0, '画面のボタンは押さない');
  assert.equal(log.filter((l) => l.ev === 'range').length, 0, '画面の範囲入力も動かさない');
  // 戻るで、まず列が隠れる（画面は閉じない）
  await press(np, 'Escape');
  assert.equal(await controls.isVisible(), false);
  // ↑ ↓ は音量（本来の画面の範囲入力。メディアセッションに音量はない）
  await press(np, 'ArrowDown');
  await until(async () => (await fx(sp, 'log')).some((l) => l.ev === 'range' && l.kind === 'volume'), { message: '音量の範囲入力が動く' });
  await closeAll();
});

test('Spotify: （メディアセッションがないときの代わり）画面のボタン・範囲入力にさがる。位置は画面の時間の表示から', async () => {
  await setSp({ lyrics: true });
  const sp = await engine({ noSession: true });
  const np = await front();
  const root = np.locator('#sv-np');
  await until(async () => (await kindOf(np)) === 'track', { message: '曲の画面' });
  assert.match(await root.innerText(), /テスト曲のタイトル/);
  assert.match(await root.innerText(), /0:5\d/);
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞' });
  assert.match(await root.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/, '時間の表示（0:50）から、いまの行が決まる');
  const mark = (await fx(sp, 'log')).length;
  await press(np, 'Enter');
  await press(np, 'Enter'); // 再生/一時停止 → 画面のボタン
  await press(np, 'ArrowRight');
  await press(np, 'Enter'); // +10 秒 → 範囲入力
  const log = (await fx(sp, 'log')).slice(mark);
  assert.deepEqual(log.filter((l) => l.ev === 'click').map((l) => l.id), ['control-button-playpause']);
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'seek').map((l) => l.value), [60000]);
  await closeAll();
});

test('Spotify: サイトの作りが変わっても（目印の data-testid・クラス名が全部なくなっても）動く。曲の情報は再生情報（mediaSession）、再生位置は音声、操作はボタンの表示名と範囲入力の並び、歌詞は React の部品の props', async () => {
  await setSp({ lyrics: true });
  const sp = await engine({ plain: true });
  const errors = [];
  sp.on('pageerror', (e) => errors.push(String(e)));
  const np = await front();
  const root = np.locator('#sv-np');
  await until(async () => (await kindOf(np)) === 'track', { message: '再生情報から、曲の画面になる' });
  assert.match(await root.innerText(), /テスト曲のタイトル/);
  assert.match(await root.innerText(), /テスト歌手/);
  await until(async () => /0:1\d/.test(await root.innerText()), { message: '再生位置は音声から' });
  assert.match(await root.innerText(), /0:20/, '長さも音声から');
  assert.equal(await sp.evaluate(() => document.querySelectorAll('[data-testid]').length), 0, '目印は 1 つもない');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞は、目印・クラス名がなくても出る' });
  const mark = (await fx(sp, 'log')).length;
  await press(np, 'Enter');
  await press(np, 'Enter'); // 再生/一時停止（ボタンの表示名「再生」で見つける）
  await until(async () => (await root.getAttribute('data-state')) === 'playing', { message: '音声が再生中になる' });
  await press(np, 'ArrowRight');
  await press(np, 'Enter'); // +10 秒（範囲入力の並びの 1 つ目 = 再生位置）
  await press(np, 'ArrowDown'); // 音量（並びの最後）
  const log = (await fx(sp, 'log')).slice(mark);
  assert.deepEqual(log.filter((l) => l.ev === 'click').map((l) => l.id), ['control-button-playpause'], '再生ボタンだけが押される');
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'seek').map((l) => l.value), [60000]);
  assert.ok(log.some((l) => l.ev === 'range' && l.kind === 'volume'));
  assert.deepEqual(errors, []);
  await closeAll();
});

test('Spotify: ログインしていないと、状態の画面で理由と、やることを出す。OK で、Spotify のタブのログインを押し、そのタブを前面に出す。曲がなければ、待つ画面（手順つき）か、再生できない理由', async () => {
  const sp = await engine({ loggedOut: true, noTrack: true });
  const np = await front();
  const root = np.locator('#sv-np');
  await until(async () => (await kindOf(np)) === 'loggedOut', { message: 'ログインしていない画面' });
  assert.equal(await root.getAttribute('data-view'), 'status');
  assert.match(await root.innerText(), /Spotify にログインしていません/);
  assert.match(await root.innerText(), /OK でログイン画面を開く/);
  await press(np, 'Enter');
  await until(async () => (await fx(sp, 'log')).some((l) => l.ev === 'login'), { message: 'ログインのボタンが押される' });
  await until(async () => (await tabsOf()).some((t) => t.active && t.url.startsWith('https://open.spotify.com/')), { message: 'Spotify のタブが前面に出る' });
  await closeAll();

  const sp2 = await engine({ noTrack: true });
  const np2 = await front();
  const drm = await np2.evaluate(() => navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }]).then(() => true, () => false));
  const kind = drm ? 'idle' : 'noDrm';
  await until(async () => (await kindOf(np2)) === kind, { timeout: 12000, message: '保護機能の有無に合った画面: ' + kind });
  const r2 = np2.locator('#sv-np');
  assert.equal(await r2.getAttribute('data-view'), 'status');
  if (drm) {
    assert.match(await r2.innerText(), /スマホの Spotify から、再生してください/);
    assert.match(await r2.innerText(), /デバイスに接続/);
  } else {
    assert.match(await r2.innerText(), /再生できません/);
    assert.match(await r2.innerText(), /Widevine/);
  }
  // 曲がないときは、方向キー・OK は何もしない
  const before = (await fx(sp2, 'log')).length;
  for (const k of ['ArrowLeft', 'ArrowDown', 'Enter']) await press(np2, k);
  assert.equal((await fx(sp2, 'log')).length, before);
  await closeAll();
});

test('Spotify: 歌詞のオン/オフ。ボタンで切り替えると設定に保存され、Spotify のタブの歌詞ボタンが押される。オフの間は歌詞を出さない', async () => {
  await setSp({ lyrics: true });
  const sp = await engine();
  const np = await front();
  const root = np.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞が出る' });
  assert.equal(await root.locator('.sv-np-ly-track').evaluate((e) => e.style.getPropertyValue('--cur')), '2', 'いまの行（3 行目）が真ん中に来る位置');
  assert.equal((await fx(sp, 'log')).filter((l) => l.ev === 'lyrics').pop().on, true, 'Spotify の歌詞ボタンが押された');
  const focused = () => np.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  for (let i = 0; i < 4; i++) await press(np, 'ArrowRight'); // 列を出す + 3 つ右
  assert.equal(await focused(), 'lyrics');
  assert.match(await root.locator('[data-id="lyrics"]').innerText(), /オン/);
  await press(np, 'Enter');
  await until(async () => (await root.locator('.sv-np-lyrics').isVisible()) === false, { message: '歌詞が消える' });
  assert.match(await root.locator('[data-id="lyrics"]').innerText(), /オフ/);
  const saved = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.get('sv.settings', (v) => r(v['sv.settings'].spotify.lyrics))));
  await until(async () => (await saved()) === false, { message: '設定に保存される' });
  await until(async () => (await fx(sp, 'log')).filter((l) => l.ev === 'lyrics').pop().on === false, { timeout: 8000, message: 'Spotify の歌詞表示も閉じる' });
  await press(np, 'Enter');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞がまた出る' });
  // 5 秒でボタンの列が隠れる
  await until(async () => (await root.locator('.sv-np-controls').isVisible()) === false, { timeout: 8000, message: '5 秒で隠れる' });
  await closeAll();
});

test('Spotify: Home でハブへ（自前ページのタブがハブへ。Spotify のタブは動かさない）。ハブの Spotify タイルは自前ページへのリンクで、開くと、裏に Spotify のタブができる。Spotify のタブで Home を押すと、前面のタブ（自前ページ・ハブ）へ戻る', async () => {
  await setSp({ lyrics: true });
  const sp = await engine();
  const np = await front();
  await until(async () => (await kindOf(np)) === 'track', { message: '曲の画面' });
  const spId = (await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).id;
  await press(np, 'Home');
  await np.waitForURL(env.hubUrl, { timeout: 8000 });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).id, spId, 'Spotify のタブは同じまま（音楽が止まらない）');
  // ハブのタイル → 自前ページ
  await ready(np);
  await np.locator('a.tile-sp').focus();
  await np.keyboard.press('Enter');
  await np.waitForURL(NP_URL(), { timeout: 8000 });
  await ready(np);
  assert.equal((await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length, 1, 'Spotify のタブは 1 つのまま（増やさない）');
  // Spotify のタブで Home → ほかの前面のタブへ
  await sp.bringToFront();
  await sp.keyboard.press('Home');
  await until(async () => (await activeId()) === (await tabId(np)), { message: '自前ページが前面に出る' });

  // Spotify のタブがなければ、自前ページが裏に作る
  const np2 = await front();
  await until(async () => (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length === 1, { timeout: 10000, message: '裏に Spotify のタブができる' });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, false, '前面は奪わない');
  assert.equal(await kindOf(np2), 'loading');
  await closeAll();
});

test('Spotify: 「裏で開いておく」をオンにすると、Spotify が裏のタブで開く。スマホから再生が始まる（曲が変わる）と、自前ページが前面に出て（なければ開いて）、新しい曲を出す。ハブのタイルに状態が出る', async () => {
  await closeAll();
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await ready(hub);
  await env.sw.evaluate(() => chrome.storage.session.remove(['svSpotifyAt', 'svSpotifyState']));
  await setSp({ standby: true });
  await until(async () => (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length === 1, { message: '裏の Spotify が開く' });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, false, '前面を奪わない');
  const sp = env.ctx.pages().find((p) => p.url().startsWith('https://open.spotify.com/'));
  await sp.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml() }));
  await sp.reload(); // 拡張が作ったタブは、Playwright が付く前に読み込みが始まるので、再現ページにするため読み込み直す
  await ready(sp);
  await hub.bringToFront();
  // ハブのタイルに、再生中の曲が出る
  await until(async () => /再生中: テスト曲のタイトル/.test(await hub.locator('#sp-sub').innerText()), { timeout: 12000, message: 'ハブのタイルに状態' });
  // スマホから再生が始まった（曲が変わった）: 自前ページが開いて前面に出る
  await sp.evaluate(() => window.__fx.setTrack('スマホから送った曲'));
  const hubId = await tabId(hub);
  await until(async () => (await activeId()) !== hubId && !(await tabsOf()).some((t) => t.active && t.url.startsWith('https://open.spotify.com/')), { timeout: 10000, message: '自前ページが前面に出る' });
  const np = await until(() => env.ctx.pages().find((p) => p.url() === NP_URL()), { message: '自前ページが開く' });
  await ready(np);
  assert.equal(await activeId(), await tabId(np));
  await until(async () => /スマホから送った曲/.test(await np.locator('#sv-np').innerText()), { timeout: 10000, message: '新しい曲が出る' });
  // 前面でも、曲が変われば、新しい曲を出す
  await sp.evaluate(() => window.__fx.setTrack('前面で変わった曲'));
  await until(async () => /前面で変わった曲/.test(await np.locator('#sv-np').innerText()), { timeout: 10000, message: '新しい曲' });
  await setSp({ standby: false });
  await closeAll();
});
