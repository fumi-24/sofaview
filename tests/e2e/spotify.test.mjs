// Spotify Web プレーヤー（open.spotify.com）: 再現ページでの E2E（ネットワーク不要）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, until, tverReady } from './helpers.mjs';
import { spotifyHtml } from '../fixtures/spotify.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml() }));
});
test.after(async () => {
  await env.close();
});

const setSp = (sp) => env.sw.evaluate((sp) => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: sp } }, r)), sp);

async function open(path = '/') {
  const page = await env.ctx.newPage();
  await page.goto('https://open.spotify.com' + path);
  await tverReady(page);
  return page;
}
const fx = (page, k) => page.evaluate((k) => window.__fx[k], k);
const press = async (page, key) => {
  await page.keyboard.press(key);
  await page.waitForTimeout(120);
};

test('Spotify: Home を押すと、Spotify のタブは動かさず（音楽が止まらない）、ハブが新しいタブで前面に出る。ハブの Spotify タイルは、そのタブを前面に出す', async () => {
  const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  // 実際の使い方と同じ: ハブのタブがあり、そこから Spotify のタブを開く
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  const sp = await open();
  await until(async () => (await sp.locator('#sv-np').count()) === 1, { message: '再生中の画面' });
  const before = (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/'));
  assert.equal(before.length, 1);
  const cdp = await env.ctx.newCDPSession(sp);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await until(async () => (await tabsOf()).some((t) => t.active && !t.url.startsWith('https://open.spotify.com/')), { message: 'ハブが前面に出る' });
  const after = (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/'));
  assert.equal(after.length, 1, 'Spotify のタブは残る');
  assert.equal(after[0].id, before[0].id, '同じタブのまま（遷移していない）');
  assert.equal(sp.url().startsWith('https://open.spotify.com/'), true);

  await until(async () => (await tabsOf()).some((t) => t.active && !t.url.startsWith('https://open.spotify.com/')), { message: 'ハブが前面にいる' });
  await hub.locator('a.tile-sp').focus();
  await hub.keyboard.press('Enter');
  await until(async () => (await tabsOf()).some((t) => t.active && t.url.startsWith('https://open.spotify.com/')), { message: 'Spotify のタブが前面に出る' });
  assert.equal(hub.url(), env.hubUrl, 'ハブのタブは動かさない');
  assert.equal((await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length, 1, '2 つ目を開かない');
  await hub.close();
  await sp.close();
});

test('Spotify: 開いている Spotify がなければ、ハブのタイルは同じタブで開く', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  await hub.locator('a.tile-sp').focus();
  await hub.keyboard.press('Enter');
  await hub.waitForURL('https://open.spotify.com/', { timeout: 8000 });
  await hub.close();
});

test('Spotify: （メディアセッションがないときの代わり）再生中の画面（曲名・アーティスト・歌詞・再生位置）が読み込むと開く。操作でボタンの列が出て、← → で選んで OK。↑ ↓ 音量。戻るで列が隠れる（画面は閉じない）', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  await setSp({ lyrics: true });
  const page = await openVariant({ noSession: true }); // メディアセッションがない作り: 画面のボタン・範囲入力にさがる
  const np = page.locator('#sv-np');
  await until(async () => /テスト曲のタイトル/.test(await np.innerText()), { message: '曲名' });
  assert.equal(await np.getAttribute('data-view'), 'track');
  assert.match(await np.innerText(), /テスト歌手/);
  assert.match(await np.innerText(), /0:50/);
  assert.equal(await np.getAttribute('data-state'), 'paused');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { message: '歌詞の行' });
  assert.match(await np.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/);
  assert.equal(await page.locator('[data-testid="lyrics-button"]').getAttribute('aria-pressed'), 'true', '歌詞を出すために押した');

  // 操作されたときにボタンの列が出る: 最初の ← → OK は、列を出すだけ（うっかり止まらない）。次から、← → でボタンを選び、OK で押す
  const controls = np.locator('.sv-np-controls');
  assert.equal(await controls.isVisible(), false, '操作するまで、ボタンは出ない');
  let mark = (await fx(page, 'log')).length;
  await press(page, 'Enter');
  assert.equal(await controls.isVisible(), true, '最初の OK は、ボタンの列を出すだけ');
  assert.equal((await fx(page, 'log')).slice(mark).filter((l) => l.ev === 'click').length, 0, 'まだ再生/一時停止は押さない');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  assert.equal(await focused(), 'play', '再生/一時停止にフォーカス');
  await press(page, 'Enter');
  await until(async () => (await np.getAttribute('data-state')) === 'playing', { message: '再生中になる' });
  await press(page, 'ArrowRight');
  assert.equal(await focused(), 'fwd');
  await press(page, 'Enter'); // 10 秒進む
  await press(page, 'Enter'); // 10 秒進む
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  assert.equal(await focused(), 'back');
  await press(page, 'Enter'); // 10 秒戻る
  // ↑ ↓ は、ボタンの列と関係なく音量
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowUp');
  const log = (await fx(page, 'log')).slice(mark);
  assert.deepEqual(log.filter((l) => l.ev === 'click').map((l) => l.id), ['control-button-playpause']);
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'seek').map((l) => l.value), [60000, 70000, 60000], '10 秒ずつ');
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'volume').map((l) => l.value), [0.9, 0.8, 0.9], '↑ ↓ で音量 10%');
  await until(async () => /音量 90%/.test(await np.locator('.sv-np-toast').innerText()), { message: '音量の表示' });
  // 戻るで、まずボタンの列が隠れる（画面は閉じない）
  await press(page, 'Escape');
  assert.equal(await controls.isVisible(), false);
  assert.equal(await np.count(), 1);
  assert.equal((await fx(page, 'log')).filter((l) => l.ev === 'navigate').length, 0, '下のページは動かない');
  await press(page, 'Escape');
  assert.equal(await np.count(), 1, '戻る（ボタンが出ていないとき）でも、再生中の画面は閉じない');
  await page.close();
});

/** 変種の再現ページ（ログインしていない・曲がない）を開く。 */
async function openVariant(opt) {
  const page = await env.ctx.newPage();
  await page.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml(opt) }));
  await page.goto('https://open.spotify.com/');
  await tverReady(page);
  return page;
}

test('Spotify: ログインしていないと、状態の画面で理由と、やることを出す。OK でログイン画面を開く（ボタンを押す）。戻るで閉じる', async () => {
  const page = await openVariant({ loggedOut: true, noTrack: true });
  const np = page.locator('#sv-np');
  await until(async () => (await np.count()) === 1, { message: '画面が開く' });
  assert.equal(await np.getAttribute('data-kind'), 'loggedOut');
  assert.equal(await np.getAttribute('data-view'), 'status');
  assert.match(await np.innerText(), /Spotify にログインしていません/);
  assert.match(await np.innerText(), /OK でログイン画面を開く/);
  await page.keyboard.press('Enter');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'login'), { message: 'ログインのボタンが押される' });
  await page.close();
});

test('Spotify: ログインしていて曲がないときは、スマホから再生するのを待つ画面（手順つき）。保護機能（Widevine）がないブラウザでは、再生できない理由を出す', async () => {
  const page = await openVariant({ noTrack: true });
  const np = page.locator('#sv-np');
  await until(async () => (await np.count()) === 1, { message: '画面が開く' });
  const drm = await page.evaluate(() => navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }]).then(() => true, () => false));
  const kind = drm ? 'idle' : 'noDrm';
  await until(async () => (await np.getAttribute('data-kind')) === kind, { message: '保護機能の有無に合った画面: ' + kind });
  assert.equal(await np.getAttribute('data-view'), 'status');
  if (drm) {
    assert.match(await np.innerText(), /スマホの Spotify から、再生してください/);
    assert.match(await np.innerText(), /デバイスに接続/);
  } else {
    assert.match(await np.innerText(), /再生できません/);
    assert.match(await np.innerText(), /Widevine/);
  }
  // 曲がないときは、方向キー・OK は何もしない（ページを動かさない）
  const before = (await fx(page, 'log')).length;
  for (const k of ['ArrowLeft', 'ArrowDown', 'Enter']) await page.keyboard.press(k);
  assert.equal((await fx(page, 'log')).length, before);
  await page.close();
});

test('Spotify: 「裏で開いておく」をオンにすると、Spotify が裏のタブで開き、読み込むと再生中の画面（待機）を出す。スマホから再生が始まる（曲が変わる）と、裏のタブなら前面に出て、新しい曲を出す。ハブのタイルに状態が出る', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  await env.sw.evaluate(() => chrome.storage.session.remove(['svSpotifyAt', 'svSpotifyState']));
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: { standby: true } } }, r)));
  await until(async () => (await tabsOf()).filter((t) => t.url.startsWith('https://open.spotify.com/')).length === 1, { message: '裏の Spotify が開く' });
  assert.equal((await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, false, '前面を奪わない');
  const sp = env.ctx.pages().find((p) => p.url().startsWith('https://open.spotify.com/'));
  await sp.reload(); // 拡張が作ったタブは、Playwright が付く前に読み込みが始まるので、再現ページにするため読み込み直す
  await until(() => sp.evaluate(() => document.documentElement.dataset.svReady === '1' && !!window.__fx).catch(() => false), { message: '拡張が読み込まれる' });
  // 待機のときは、読み込むと、再生中の画面が開いている
  await until(async () => (await sp.locator('#sv-np').count()) === 1, { message: '待機の画面が開いている' });
  assert.match(await sp.locator('#sv-np').innerText(), /テスト曲のタイトル/);
  // ハブのタイルに、再生中の曲が出る
  await hub.bringToFront();
  await until(async () => /再生中: テスト曲のタイトル/.test(await hub.locator('#sp-sub').innerText()), { timeout: 10000, message: 'ハブのタイルに状態' });
  // スマホから再生が始まった（曲が変わった）
  await sp.evaluate(() => window.__fx.setTrack('スマホから送った曲'));
  await until(async () => (await tabsOf()).find((t) => t.url.startsWith('https://open.spotify.com/')).active, { message: '前面に出る' });
  await until(async () => /スマホから送った曲/.test(await sp.locator('#sv-np').innerText()), { message: '新しい曲が出る' });
  // 前面でも、曲が変われば、新しい曲を出す（再生中の画面は閉じない）
  await sp.evaluate(() => window.__fx.setTrack('前面で変わった曲'));
  await until(async () => /前面で変わった曲/.test(await sp.locator('#sv-np').innerText()), { message: '新しい曲' });
  // 設定をオフに戻す
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: { standby: false } } }, r)));
  await hub.close().catch(() => {});
  await sp.close().catch(() => {});
});

test('Spotify: 元の画面は完全に差し替える（描画もレイアウトもしない）。再生中の画面は読み込むと開き、戻るでは閉じない。↑ ↓ は効き、← → は元の画面に届かない。曲がなくても状態の画面のまま', async () => {
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.count()) === 1, { message: '読み込むと再生中の画面が開く' });
  assert.match(await np.innerText(), /テスト曲のタイトル/);
  await press(page, 'Escape');
  assert.equal(await np.count(), 1, '戻るでは閉じない');
  const boxes = (sel) => page.evaluate((sel) => document.querySelector(sel).getClientRects().length, sel);
  assert.equal(await boxes('main'), 0, '元の画面は描画もレイアウトもしない');
  assert.equal(await boxes('[data-testid="now-playing-bar"]'), 0);
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid="now-playing-bar"]').length), 1, 'DOM は残る（再生エンジンとして）');
  assert.equal(await np.evaluate((e) => getComputedStyle(e).display), 'block');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svZoom), 'skipped');
  // 本来の画面（ページ側）には、keydown・keyup・keypress のどれも届かない
  await page.evaluate(() => { window.__seen = []; for (const t of ['keydown', 'keyup', 'keypress']) window.addEventListener(t, (e) => window.__seen.push(t + ':' + e.key)); document.addEventListener('keydown', (e) => window.__seen.push('doc-keydown:' + e.key), true); });
  const before = (await fx(page, 'log')).length;
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowRight');
  assert.deepEqual(await page.evaluate(() => window.__seen), [], '← → は本来の画面（サイト）に届かない');
  assert.match(await np.locator('.sv-np-ver').innerText(), /SofaView v\d+\.\d+\.\d+/, '版がいつも右下に出る');
  assert.equal((await fx(page, 'log')).slice(before).filter((l) => l.ev === 'range').length, 0, '最初の ← → は、元の画面の再生位置を動かさない（ボタンの列を出すだけ）');
  await press(page, 'ArrowUp');
  await until(async () => /音量 \d+%/.test(await page.locator('.sv-np-toast').innerText()), { message: '音量の表示' });
  const v = await openVariant({ loggedOut: false, noTrack: true });
  await until(async () => (await v.locator('#sv-np').count()) === 1, { message: '曲がなくても状態の画面が開く' });
  await press(v, 'Escape');
  assert.equal(await v.locator('#sv-np').count(), 1, '状態の画面も閉じない');
  await v.close();
  await page.close();
});

test('Spotify: 歌詞のオン/オフ。ボタンで切り替えると設定に保存され、オフの間は歌詞を出さない。5 秒操作しないと、ボタンの列は隠れる', async () => {
  await setSp({ lyrics: true });
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { message: '歌詞が出る' });
  assert.equal(await np.locator('.sv-np-ly-track').evaluate((e) => e.style.getPropertyValue('--cur')), '2', 'いまの行（3 行目）が真ん中に来る位置（列ごと滑らかに動かす）');
  assert.match(await np.locator('.sv-np-fill').evaluate((e) => e.style.transform), /^scaleX\(0\.2844\d*\)$/, '再生位置は transform だけで動かす（レイアウトを走らせない）');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  await press(page, 'ArrowRight'); // 列を出す
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  assert.equal(await focused(), 'lyrics');
  assert.match(await np.locator('[data-id="lyrics"]').innerText(), /オン/);
  await press(page, 'Enter');
  await until(async () => (await np.locator('.sv-np-lyrics').isVisible()) === false, { message: '歌詞が消える' });
  assert.match(await np.locator('[data-id="lyrics"]').innerText(), /オフ/);
  const saved = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.get('sv.settings', (v) => r(v['sv.settings'].spotify.lyrics))));
  await until(async () => (await saved()) === false, { message: '設定に保存される' });
  assert.equal((await fx(page, 'log')).filter((l) => l.ev === 'lyrics').pop().on, false, 'サイトの歌詞表示も閉じる');
  await press(page, 'Enter');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { message: '歌詞がまた出る' });
  await until(async () => (await saved()) === true);
  // 設定がオフなら、最初から出さない
  await page.close();
  await setSp({ lyrics: false });
  const p2 = await openVariant({ noSession: true });
  await until(async () => (await p2.locator('#sv-np').count()) === 1);
  await p2.waitForTimeout(800);
  assert.equal(await p2.locator('#sv-np .sv-np-lyrics').isVisible(), false);
  assert.equal(await p2.locator('[data-testid="lyrics-button"]').getAttribute('aria-pressed'), 'false', 'サイトの歌詞表示を開かない');
  // 5 秒でボタンの列が隠れる
  await press(p2, 'ArrowRight');
  assert.equal(await p2.locator('.sv-np-controls').isVisible(), true);
  await until(async () => (await p2.locator('.sv-np-controls').isVisible()) === false, { timeout: 8000, message: '5 秒で隠れる' });
  await p2.close();
});

test('Spotify: サイトの作りが変わっても（目印の data-testid・クラス名が全部なくなっても）、再生中の画面は動く。曲の情報は再生情報（mediaSession）、再生位置は音声、操作はボタンの表示名と範囲入力の並びで見つける', async () => {
  await setSp({ lyrics: true });
  const page = await openVariant({ plain: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const np = page.locator('#sv-np');
  await until(async () => (await np.getAttribute('data-kind')) === 'track', { message: '再生情報から、曲の画面になる' });
  assert.match(await np.innerText(), /テスト曲のタイトル/);
  assert.match(await np.innerText(), /テスト歌手/);
  await until(async () => /0:10/.test(await np.innerText()), { message: '再生位置は音声から' });
  assert.match(await np.innerText(), /0:20/, '長さも音声から');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid]').length), 0, '目印は 1 つもない');
  assert.equal(await np.getAttribute('data-state'), 'paused');
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.dataset.id);
  const mark = (await fx(page, 'log')).length;
  await press(page, 'Enter'); // 列を出す
  await press(page, 'Enter'); // 再生/一時停止（ボタンの表示名「再生」で見つける）
  await until(async () => (await np.getAttribute('data-state')) === 'playing', { message: '音声が再生中になる' });
  await press(page, 'ArrowRight');
  assert.equal(await focused(), 'fwd');
  await press(page, 'Enter'); // +10 秒（範囲入力の並びの 1 つ目 = 再生位置）
  await press(page, 'ArrowUp'); // 音量（並びの最後 = 音量）
  await press(page, 'ArrowDown');
  const log = (await fx(page, 'log')).slice(mark);
  assert.deepEqual(log.filter((l) => l.ev === 'click').map((l) => l.id), ['control-button-playpause'], '再生ボタンだけが押される');
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'seek').map((l) => l.value), [60000]);
  assert.deepEqual(log.filter((l) => l.ev === 'range' && l.kind === 'volume').map((l) => l.value), [1, 0.9], '音量（上限では動かない）');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { timeout: 8000, message: '歌詞は、React の部品の props から読むので、目印・クラス名がなくても出る' });
  assert.deepEqual(errors, []);
  await page.close();
  // ログインしていない: ログインのボタンも、表示名で見つかる
  const out = await openVariant({ plain: true, loggedOut: true, noTrack: true });
  await until(async () => (await out.locator('#sv-np').getAttribute('data-kind')) === 'loggedOut', { message: 'ログインしていない画面' });
  await press(out, 'Enter');
  await until(async () => (await fx(out, 'log')).some((l) => l.ev === 'login'), { message: 'ログインのボタンが押される' });
  await out.close();
});

test('Spotify: 操作は、メディアセッション（OS のメディアキーと同じ標準の API）のハンドラを直接呼ぶ。画面のボタンは押さない。再生位置は setPositionState から', async () => {
  await setSp({ lyrics: true });
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.getAttribute('data-kind')) === 'track', { message: '曲の画面' });
  assert.match(await np.innerText(), /テスト曲のタイトル/);
  assert.match(await np.innerText(), /0:50/, '再生位置は setPositionState から');
  const mark = (await fx(page, 'log')).length;
  await press(page, 'Enter'); // 列を出す
  await press(page, 'Enter'); // 再生
  await until(async () => (await np.getAttribute('data-state')) === 'playing', { message: '再生状態は mediaSession.playbackState から' });
  // 再生中の位置の棒は、「いまの位置 → 最後」へ、残り時間をかけて直線で動かす指示を 1 回だけ出す（250ms ごとに書き換えない）
  await until(async () => /^transform 12\d(\.\d+)?s linear$/.test(await np.locator('.sv-np-fill').evaluate((e) => e.style.transition)), { message: '残り時間をかけた直線の動き' });
  assert.equal(await np.locator('.sv-np-fill').evaluate((e) => e.style.transform), 'scaleX(1)');
  const before = await np.locator('.sv-np-fill').evaluate((e) => e.style.transition);
  await page.waitForTimeout(1200);
  assert.equal(await np.locator('.sv-np-fill').evaluate((e) => e.style.transition), before, '指示は出し直されない（毎回書き換えない）');
  await press(page, 'Enter'); // 一時停止（再生中なので pause）
  await press(page, 'ArrowRight');
  await press(page, 'Enter'); // +10 秒 → seekto 60
  await press(page, 'ArrowRight');
  await press(page, 'Enter'); // 次の曲
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  await press(page, 'Enter'); // 前の曲
  const log = (await fx(page, 'log')).slice(mark);
  const ms = log.filter((l) => l.ev === 'ms');
  assert.deepEqual(ms.map((l) => l.action), ['play', 'pause', 'seekto', 'next', 'prev']);
  const seekTime = ms.find((l) => l.action === 'seekto').time;
  assert.ok(seekTime >= 60 && seekTime < 63, '再生した分（約 1〜2 秒）進んだ位置 + 10 秒: ' + seekTime);
  assert.equal(log.filter((l) => l.ev === 'click').length, 0, '画面のボタンは押さない');
  assert.equal(log.filter((l) => l.ev === 'range').length, 0, '画面の範囲入力も動かさない');
  await page.close();
});

test('Spotify: 本来の画面の要素は DOM からも取り外す（操作はメディアセッション、歌詞は React の部品の props）。取り外したままで、歌詞ボタンも押せて、歌詞が出る', async () => {
  await setSp({ lyrics: false });
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.getAttribute('data-kind')) === 'track', { message: '曲の画面' });
  await until(async () => (await page.evaluate(() => document.querySelector('main, [data-testid="now-playing-bar"]'))) === null, { timeout: 8000, message: '本来の画面の要素が取り外される' });
  assert.deepEqual(await page.evaluate(() => Array.from(document.body.children).map((e) => e.id || e.tagName).filter((t) => !/SCRIPT|sv-badge/.test(t))), ['sv-np'], 'body には再生中の画面だけ');
  assert.equal(await np.locator('.sv-np-lyrics').isVisible(), false, '歌詞はオフ');
  // 取り外したあとも、操作できる
  const mark = (await fx(page, 'log')).length;
  await press(page, 'Enter');
  await press(page, 'Enter');
  await until(async () => (await np.getAttribute('data-state')) === 'playing', { message: '取り外したあとでも再生できる' });
  assert.deepEqual((await fx(page, 'log')).slice(mark).filter((l) => l.ev === 'ms').map((l) => l.action), ['play']);
  // 歌詞をオン → 取り外したまま、歌詞のボタンを押して、歌詞が出る（本来の画面は戻さない）
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'Enter');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { timeout: 8000, message: '歌詞が出る' });
  assert.equal(await page.evaluate(() => !!document.querySelector('main')), false, '本来の画面は戻さない');
  assert.match(await np.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/, '再生位置（50 秒）といまの行の開始時刻（40 秒）から決まる');
  assert.equal((await fx(page, 'log')).filter((l) => l.ev === 'lyrics').pop().on, true);
  await page.close();
  await setSp({ lyrics: true });
});
