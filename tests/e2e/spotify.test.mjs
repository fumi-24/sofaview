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
  await until(async () => /0:5\d/.test(await root.innerText()), { timeout: 5000, message: '再生位置は、アプリの状態（positionAsOfTimestamp）から。経過時間で進む' });
  assert.match(await root.innerText(), /2:55/);
  await until(async () => /経路 アプリ/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: 'アプリのサービスから読んでいる' });
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 10000, message: '歌詞（React の部品の props から）' });
  assert.match(await root.locator('.sv-np-line.is-current').innerText(), /三行目（いま）/);
  // 近い行は離れるほど暗い（3 行離れた行は、かすかに見える）
  const opacity = (n) => root.locator('.sv-np-line').nth(n).evaluate((e) => Number(getComputedStyle(e).opacity));
  await until(async () => Math.abs((await opacity(5)) - 0.16) < 0.02, { timeout: 4000, message: '3 行離れた行は、かすかに見える' });
  assert.ok((await opacity(2)) === 1 && (await opacity(3)) > 0.4 && (await opacity(4)) > 0.2 && (await opacity(4)) < (await opacity(3)), '近い行は、離れるほど暗い');
  await until(async () => /歌詞 6行・キャッシュ/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: '問い合わせキャッシュから読んだと表示される' });
  assert.equal(await root.locator('.sv-np-hint').count(), 0, '「どれかのキーで、ボタンを出す」の案内は出さない（要素もない）');
  assert.doesNotMatch(await root.innerText(), /どれかのキーで/);
  // Spotify の画面は、文書の外の要素に描かれた（起動のとき createRoot の描画先を替えた）
  assert.deepEqual(await fx(page, 'rendered'), { containerConnected: false, containerIsMain: false }, 'Spotify の画面の描画先は、文書の外');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-testid], main').length), 0, '文書に、Spotify の要素はない');
  await until(async () => (await page.evaluate(() => document.getElementById('main').children.length)) === 0, { timeout: 12000, message: '読み込みの骨組みも取り除く' });
  // 背景: ジャケットを、ぼかして・暗くして描いた絵（canvas）。画面では毎フレームのぼかし（CSS の filter）を使わない（弱い GPU で重いため）
  await until(async () => (await page.locator('#sv-np .sv-np-bg.on').count()) === 1, { timeout: 5000, message: '背景の絵が描かれる' });
  assert.equal(await page.locator('#sv-np .sv-np-bg.on').evaluate((e) => getComputedStyle(e).filter), 'none', '背景に CSS のぼかしを使わない');
  // アプリの更新イベントを購読している（曲が変わる・再生/一時停止・シークを、すぐ受け取る）。変わったら、すぐ画面に出る
  assert.ok((await fx(page, 'log')).some((l) => l.ev === 'app' && l.action === 'subscribe:update'), '更新イベントを購読');
  await page.evaluate(() => window.__fx.setTrack('次の曲'));
  await until(async () => /次の曲/.test(await root.innerText()), { timeout: 1500, message: '曲が変わったら、1.5 秒以内に画面に出る' });
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
  const clicks = (await fx(page, 'log')).filter((l) => l.ev === 'lyricsBtnClick');
  assert.equal(clicks.length, 1, 'アプリ自身の歌詞ボタンの処理を 1 回だけ呼ぶ（切り替えを繰り返さない）');
  assert.equal(clicks[0].button, 0, 'リンクの処理が通る形のクリックを渡す');
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

test('Spotify: 歌詞の画面への移り先は、アプリ自身の歌詞ボタンから（href があれば履歴で、なければ処理を呼ぶ）。ボタンがなければ履歴で /lyrics。行の部品が描かれなくても、入れ物の props（data.lyrics）から読む', async () => {
  await setSp({ lyrics: true });
  // 1) href: 履歴でその移り先へ。ボタンの処理は呼ばない
  let page = await open({ lyricsBtn: 'href' });
  await until(async () => (await page.locator('#sv-np .sv-np-line').count()) === 6, { timeout: 12000, message: 'href から歌詞が出る' });
  let log = await fx(page, 'log');
  assert.ok(log.some((l) => l.ev === 'nav' && /\/intl-ja\/lyrics$/.test(l.to)));
  assert.equal(log.filter((l) => l.ev === 'lyricsBtnClick').length, 0);
  await page.close();
  // 2) ボタンがない: 履歴で、接頭辞つきの /lyrics へ
  page = await open({ lyricsBtn: 'none' });
  await until(async () => (await page.locator('#sv-np .sv-np-line').count()) === 6, { timeout: 12000, message: '履歴の移動から歌詞が出る' });
  await page.close();
  // 3) 行の部品がない（描かれていない・名前が変わった）: 入れ物の props から読む
  page = await open({ dataOnly: true, noQuery: true });
  await until(async () => (await page.locator('#sv-np .sv-np-line').count()) === 6, { timeout: 12000, message: 'data.lyrics から歌詞が出る' });
  assert.match(await page.locator('#sv-np .sv-np-line.is-current').innerText(), /三行目（いま）/);
  await until(async () => /歌詞 6行・部品/.test(await page.locator('#sv-np .sv-np-ver').innerText()), { timeout: 12000, message: '部品の木から読んだと表示される' });
});

test('Spotify: 歌詞は、アプリの問い合わせキャッシュ（曲ごとに 1 回取得・次の曲は先読み）から受け取る。曲が変わった瞬間に、先読み済みの歌詞が出る。まだ取得中なら前の曲の歌詞は消える', async () => {
  await setSp({ lyrics: true });
  const page = await open();
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 12000, message: '最初の曲の歌詞' });
  // 次の曲の歌詞が先読みされた（Spotify 自身の動き）。曲が変わったら、すぐ出る
  await page.evaluate(() => window.__fx.cacheLyrics('spotify:track:next', ['次の一', '次の二', '次の三', '次の四']));
  await page.evaluate(() => window.__fx.setTrack('次の曲', 'spotify:track:next'));
  await until(async () => (await root.locator('.sv-np-line').count()) === 4 && /次の一/.test(await root.locator('.sv-np-ly-track').innerText()), { timeout: 1500, message: '先読み済みの歌詞が、曲が変わってすぐ出る' });
  // まだ取得されていない曲: 前の曲の歌詞は消える。取得されて（キャッシュに入って）すぐ、出る
  await page.evaluate(() => window.__fx.setTrack('三曲目', 'spotify:track:third'));
  await until(async () => (await root.locator('.sv-np-lyrics').isVisible()) === false, { timeout: 1500, message: '前の曲の歌詞が消える' });
  await page.evaluate(() => window.__fx.cacheLyrics('spotify:track:third', ['三の一', '三の二', '三の三']));
  await until(async () => (await root.locator('.sv-np-line').count()) === 3 && /三の一/.test(await root.locator('.sv-np-ly-track').innerText()), { timeout: 1500, message: '取得された歌詞がすぐ出る' });
  // 別の曲の歌詞（違う URI）は受け取らない
  await page.evaluate(() => window.__fx.cacheLyrics('spotify:track:other', ['別の曲の歌詞']));
  await page.waitForTimeout(600);
  assert.equal(await root.locator('.sv-np-line').count(), 3);
  // 歌詞のない曲: 理由が分かり、問い合わせを続けない
  await page.evaluate(() => window.__fx.setTrack('歌詞なしの曲', 'spotify:track:none'));
  await page.evaluate(() => window.__fx.cacheAvail('spotify:track:none', false));
  await until(async () => (await root.locator('.sv-np-lyrics').isVisible()) === false, { timeout: 1500, message: '歌詞の枠が消える' });
  await until(async () => /歌詞 なし/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 12000, message: '歌詞がないと表示される' });
});

test('Spotify: 歌詞の位置は、実際に鳴っている音声に合わせて補正する。アプリの再生位置が音声より遅れていたら（右下の「音声差」が負）、その分だけ歌詞を進める。止まっても補正は保つ', async () => {
  await setSp({ lyrics: true });
  const page = await open({ mediaLag: 3, fineLyrics: true, pos: 20000 });
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 120, { timeout: 12000, message: '歌詞が出る（1 秒ごとの 120 行）' });
  await press(page, 'Enter'); // 列を出す
  await press(page, 'Enter'); // 再生
  await until(async () => /音声差 -3\.\d秒（歌詞を \+3\.\d秒補正）/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 20000, message: '音声差が分かり、歌詞が補正される' });
  await press(page, 'Enter'); // 一時停止
  await until(async () => (await root.getAttribute('data-state')) === 'paused', { message: '一時停止' });
  const sec = await root.locator('.sv-np-pos').evaluate((e) => { const m = e.textContent.match(/^(\d+):(\d+)$/); return Number(m[1]) * 60 + Number(m[2]); });
  const cur = Number(await root.locator('.sv-np-ly-track').evaluate((e) => e.style.getPropertyValue('--cur')));
  assert.ok(cur - sec >= 2 && cur - sec <= 4, 'いまの行は、アプリの位置より約 3 秒先: 位置 ' + sec + ' 秒、行 ' + cur);
  await page.waitForTimeout(1500);
  assert.match(await root.locator('.sv-np-ver').innerText(), /歌詞を \+3\.\d秒補正/, '止まっても補正は保たれる');
});

test('Spotify: 設定の「歌詞のタイミングの微調整」が、歌詞の行の選び方に効く（＋で早く、−で遅く）。設定を変えるとすぐ反映される', async () => {
  await setSp({ lyrics: true, lyricsOffset: 0 });
  const page = await open({ fineLyrics: true, pos: 50000 });
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 120, { timeout: 12000, message: '歌詞が出る' });
  const cur = async () => Number(await root.locator('.sv-np-ly-track').evaluate((e) => e.style.getPropertyValue('--cur')));
  await until(async () => (await cur()) === 50, { timeout: 5000, message: '調整なし: 位置 50 秒 → 50 行目' });
  // 枠の端（いまの行から 4 行以上離れた行）は、完全に透明。枠の中の 7 行（前後 3 行ずつ）は見える
  const opacity = (n) => root.locator('.sv-np-line').nth(n).evaluate((e) => Number(getComputedStyle(e).opacity));
  await until(async () => (await opacity(54)) === 0 && (await opacity(46)) === 0, { timeout: 4000, message: '4 行離れた行は透明' });
  await until(async () => (await opacity(53)) > 0.1 && (await opacity(47)) > 0.1, { timeout: 4000, message: '3 行離れた行は見える' });
  assert.equal(await root.locator('.sv-np-lyrics').evaluate((e) => Math.round((e.getBoundingClientRect().height / e.querySelector('.sv-np-line').getBoundingClientRect().height) * 10) / 10), 7, '枠は 7 行ぶんの高さ');
  await setSp({ lyricsOffset: 0.5 }); // 少しの調整では、行は変わらない（50.5 秒）
  await page.waitForTimeout(800);
  assert.equal(await cur(), 50);
  await setSp({ lyricsOffset: 3 });
  await until(async () => (await cur()) === 53, { timeout: 5000, message: '+3 秒: 歌詞が早まり 53 行目' });
  await until(async () => /微調整 \+3\.0秒/.test(await root.locator('.sv-np-ver').innerText()), { timeout: 8000, message: '右下に微調整が出る' });
  await setSp({ lyricsOffset: -2 });
  await until(async () => (await cur()) === 48, { timeout: 5000, message: '−2 秒: 歌詞が遅れて 48 行目' });
});

test('Spotify: 前奏（最初の行がまだ始まっていない間）も、最初の行は透明にならず、これから歌われる行として見える。始まったら、いまの行になる', async () => {
  await setSp({ lyrics: true });
  const page = await open({ leadIn: 30000, pos: 5000 });
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 12000, message: '歌詞が出る' });
  assert.equal(await root.locator('.sv-np-lyrics').isVisible(), true, '前奏でも歌詞の枠が出る');
  assert.equal(await root.locator('.sv-np-line.is-current').count(), 0, 'まだ、いまの行はない');
  const opacity = (n) => root.locator('.sv-np-line').nth(n).evaluate((e) => Number(getComputedStyle(e).opacity));
  await until(async () => Math.abs((await opacity(0)) - 0.7) < 0.03, { timeout: 4000, message: '最初の行は、透明でなく、見える（0.7）' });
  assert.ok((await opacity(1)) > 0.4 && (await opacity(1)) < (await opacity(0)), '次の行は、それより暗い');
  // 最初の行が始まったら、いまの行（明るさ 1）になる
  await press(page, 'Enter'); // 列を出す
  await press(page, 'Enter'); // 再生
  await page.evaluate(() => window.__fx.seekTo(32000)); // 最初の行の開始（30 秒）を過ぎる
  await until(async () => (await root.locator('.sv-np-line.is-current').count()) === 1, { timeout: 5000, message: '最初の行が、いまの行になる' });
  await until(async () => (await opacity(0)) === 1, { timeout: 4000, message: 'いまの行は明るさ 1' });
});

test('Spotify: 最後の行が終わったあと（後奏）は、最後の行を暗くして、何も光っていない状態に。戻れば、またいまの行になる', async () => {
  await setSp({ lyrics: true });
  const page = await open({ pos: 101000 }); // 6 行（20 秒おき）の最後の行は 100 秒から。間隔 20 秒 → 最後の行は 8 秒続く
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 12000, message: '歌詞が出る' });
  const opacity = (n) => root.locator('.sv-np-line').nth(n).evaluate((e) => Number(getComputedStyle(e).opacity));
  await until(async () => (await root.locator('.sv-np-line.is-current').count()) === 1, { timeout: 5000, message: '最後の行がいまの行' });
  assert.match(await root.locator('.sv-np-line.is-current').innerText(), /六行目/);
  await page.evaluate(() => window.__fx.seekTo(110000)); // 最後の行が始まって 10 秒: 終わった
  await until(async () => (await root.locator('.sv-np-line.is-current').count()) === 0, { timeout: 5000, message: '光っている行がなくなる' });
  await until(async () => Math.abs((await opacity(5)) - 0.45) < 0.03, { timeout: 4000, message: '最後の行は暗くなる（0.45）' });
  assert.ok((await opacity(4)) > 0.3, '前の行は、そのまま見える');
  await page.evaluate(() => window.__fx.seekTo(102000)); // 戻した: また、いまの行
  await until(async () => (await root.locator('.sv-np-line.is-current').count()) === 1, { timeout: 5000, message: 'また、いまの行になる' });
  await until(async () => (await opacity(5)) === 1, { timeout: 4000, message: '明るさ 1' });
});

test('Spotify: MV（ミュージックビデオ）を再生中は、既定で映像を画面全体に出す（歌詞・曲名・案内は出さない）。Spotify 自身の映像の置き場を、自前の枠に差し込む。MV でなくなったら、戻す', async () => {
  await setSp({ lyrics: true, mvLayout: 'full' });
  const page = await open({ video: true });
  const root = page.locator('#sv-np');
  await until(async () => (await root.getAttribute('data-mv')) === 'full', { timeout: 12000, message: '映像が全画面で出る' });
  const log = async () => (await fx(page, 'log')).filter((l) => l.ev === 'app').map((l) => l.action);
  assert.ok((await log()).includes('video:claim'), 'アプリ自身の部品で、映像の置き場を枠に差し込む');
  assert.ok((await log()).includes('video:visible:true') && (await log()).includes('video:mode:cinema'), '映像を出していることをアプリに伝える');
  assert.equal(await page.locator('#sv-np-video .VideoPlayer__container video').count(), 1, '枠の中に映像がある');
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const box = await page.locator('#sv-np-video').boundingBox();
  assert.ok(Math.abs(box.width - vp.w) < 2 && Math.abs(box.height - vp.h) < 2, '画面全体: ' + JSON.stringify(box));
  const bgOf = (sel) => page.locator(sel).evaluate((e) => getComputedStyle(e).backgroundColor);
  for (const sel of ['#sv-np-video', '#sv-np-video .VideoPlayer__container', '#sv-np-video video']) assert.equal(await bgOf(sel), 'rgba(0, 0, 0, 0)', '映像の余白は黒でなく透明（後ろのぼかした背景が見える）: ' + sel);
  // 映像メイン: 曲名・アーティスト名は左上、位置の棒は一番下。歌詞・「再生中」・秒数・案内は出さない
  const rect = (sel) => root.locator(sel).boundingBox();
  const title = await rect('.sv-np-title');
  assert.ok(title.x < vp.w * 0.1 && title.y < vp.h * 0.15, '曲名は左上: ' + JSON.stringify(title));
  const bar = await rect('.sv-np-bar');
  assert.ok(Math.abs(bar.x) < 2 && Math.abs(bar.width - vp.w) < 2 && Math.abs(bar.y + bar.height - vp.h) < 2, '位置の棒は一番下で、画面の幅いっぱい: ' + JSON.stringify(bar));
  assert.ok(bar.height < vp.h * 0.015, '細い');
  for (const sel of ['.sv-np-artist', '.sv-np-lyrics', '.sv-np-state', '.sv-np-times', '.sv-np-cover']) assert.equal(await root.locator(sel).isVisible(), false, sel + ' は出ない（曲名だけ残す）');
  // 右下の版は、操作した直後だけ
  const verOpacity = () => root.locator('.sv-np-ver').evaluate((e) => Number(getComputedStyle(e).opacity));
  assert.equal(await verOpacity(), 0, '操作する前は出ない');
  await until(async () => /映像 全画面/.test(await root.locator('.sv-np-ver').evaluate((e) => e.textContent)), { timeout: 8000, message: '右下に状態（全画面）' });
  // キーを押すと、ボタンの列と右下の版が、映像の上に出る
  await press(page, 'Enter');
  assert.equal(await root.locator('.sv-np-controls').isVisible(), true);
  assert.equal(await verOpacity(), 1, '操作した直後は出る');
  // MV でなくなったら（次の曲）、映像を戻して、普通の画面に
  await page.evaluate(() => { window.__fx.setVideo(false); window.__fx.setTrack('次の曲', 'spotify:track:next'); });
  await until(async () => (await root.getAttribute('data-mv')) === null, { timeout: 5000, message: '映像の画面が終わる' });
  assert.ok((await log()).includes('video:release') && (await log()).includes('video:visible:false') && (await log()).includes('video:mode:none'));
  assert.equal(await page.locator('#sv-np-video .VideoPlayer__container').count(), 0, '枠は空になる');
  assert.equal(await root.locator('.sv-np-title').isVisible(), true, '曲名が戻る');
  assert.equal(await root.locator('.sv-np-artist').isVisible(), true, 'アーティスト名も戻る');
  assert.equal(await root.locator('.sv-np-state').isVisible(), true, '「再生中」の表示も戻る');
  assert.equal(await root.locator('.sv-np-times').isVisible(), true, '秒数も戻る');
  assert.ok((await rect('.sv-np-title')).x > vp.w * 0.2, '曲名は普通の位置（ジャケットの右）');
});

test('Spotify: MV の表示を「左半分に映像・右半分に歌詞」にできる。「出さない」なら映像を出さない', async () => {
  await setSp({ lyrics: true, mvLayout: 'split' });
  let page = await open({ video: true });
  let root = page.locator('#sv-np');
  await until(async () => (await root.getAttribute('data-mv')) === 'split', { timeout: 12000, message: '左右の表示' });
  assert.ok((await fx(page, 'log')).some((l) => l.ev === 'app' && l.action === 'video:mode:npv'));
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const vbox = await page.locator('#sv-np-video').boundingBox();
  assert.ok(Math.abs(vbox.width - vp.w * 0.7) < 2 && vbox.x < 2 && Math.abs(vbox.height - vp.h) < 2, '左 70%: ' + JSON.stringify(vbox));
  // 曲名・アーティスト名は左上（左半分の中）、位置の棒は一番下、「再生中」・秒数・案内は出さない
  const title = await root.locator('.sv-np-title').boundingBox();
  assert.ok(title.x < vp.w * 0.1 && title.y < vp.h * 0.15 && title.x + title.width <= vp.w * 0.7, '曲名は左上（映像の側の中）: ' + JSON.stringify(title));
  const bar = await root.locator('.sv-np-bar').boundingBox();
  assert.ok(Math.abs(bar.width - vp.w) < 2 && Math.abs(bar.y + bar.height - vp.h) < 2, '位置の棒は一番下: ' + JSON.stringify(bar));
  for (const sel of ['.sv-np-artist', '.sv-np-state', '.sv-np-times', '.sv-np-cover']) assert.equal(await root.locator(sel).isVisible(), false, sel + ' は出ない');
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 12000, message: '歌詞も出る' });
  assert.equal(await root.locator('.sv-np-lyrics').isVisible(), true);
  const lbox = await root.locator('.sv-np-lyrics').boundingBox();
  assert.ok(lbox.x >= vp.w * 0.7 && Math.abs(lbox.y + lbox.height / 2 - vp.h / 2) < vp.h * 0.03, '歌詞は右 30% の縦の真ん中: ' + JSON.stringify(lbox));
  assert.ok(lbox.height < vp.h * 0.33, '歌詞の枠は小さい（画面の高さの 1/3 より小さい）: ' + lbox.height);
  const lh = await root.locator('.sv-np-line').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  assert.ok(lh < vp.h * 0.03, '歌詞の文字も小さい: ' + lh);
  assert.equal(await page.locator('#sv-np-video').evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)', '左半分の余白も透明');
  await page.close();

  await setSp({ mvLayout: 'off' });
  page = await open({ video: true });
  root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-title').isVisible()) === true, { timeout: 12000, message: '普通の画面' });
  await page.waitForTimeout(800);
  assert.equal(await root.getAttribute('data-mv'), null);
  assert.ok(!(await fx(page, 'log')).some((l) => l.ev === 'app' && l.action === 'video:claim'), '映像は差し込まない');
  await until(async () => /映像 検出（設定で出さない）/.test(await root.locator('.sv-np-ver').evaluate((e) => e.textContent)), { timeout: 8000, message: '検出だけ表示' });
  await page.close();

  // 映像の部品が見つからないとき: 普通の画面のまま。理由を右下に
  await setSp({ mvLayout: 'full' });
  page = await open({ video: true, noVideoApi: true });
  root = page.locator('#sv-np');
  await until(async () => /映像 検出（出せません: 映像の部品なし）/.test(await root.locator('.sv-np-ver').evaluate((e) => e.textContent)), { timeout: 12000, message: '出せない理由' });
  assert.equal(await root.getAttribute('data-mv'), null);
  assert.equal(await root.locator('.sv-np-title').isVisible(), true, '普通の画面のまま');
});

test('Spotify: MV の「映像に重ねる」をオフにすると、曲名は映像の上の帯、位置の棒は映像の下の帯に分けて、映像に被せない（全画面・左右とも）', async () => {
  for (const layout of ['full', 'split']) {
    await setSp({ lyrics: true, mvLayout: layout, mvOverlap: false });
    const page = await open({ video: true });
    const root = page.locator('#sv-np');
    await until(async () => (await root.getAttribute('data-mv-apart')) === '1', { timeout: 12000, message: layout + ': 重ねない表示' });
    const title = await root.locator('.sv-np-title').boundingBox();
    const bar = await root.locator('.sv-np-bar').boundingBox();
    const video = await page.locator('#sv-np-video').boundingBox();
    assert.ok(video.y >= title.y + title.height - 1, layout + ': 映像は曲名の下から: 映像 ' + JSON.stringify(video) + ' 曲名 ' + JSON.stringify(title));
    assert.ok(video.y + video.height <= bar.y + 1, layout + ': 映像は位置の棒の上まで: 映像 ' + JSON.stringify(video) + ' 棒 ' + JSON.stringify(bar));
    assert.equal(await root.evaluate((e) => getComputedStyle(e, '::before').display), 'none', layout + ': 暗幕は要らない');
    await page.close();
    // 重ねる（既定）: 映像は画面の上から下まで
    await setSp({ lyrics: true, mvLayout: layout, mvOverlap: true }); // setSp は、設定を丸ごと置き換える
    const page2 = await open({ video: true });
    const root2 = page2.locator('#sv-np');
    await until(async () => (await root2.getAttribute('data-mv')) === layout, { timeout: 12000, message: layout + ': 重ねる表示' });
    assert.equal(await root2.getAttribute('data-mv-apart'), null);
    const v2 = await page2.locator('#sv-np-video').boundingBox();
    const vp = await page2.evaluate(() => ({ h: innerHeight }));
    assert.ok(Math.abs(v2.y) < 2 && Math.abs(v2.height - vp.h) < 2, layout + ': 映像は画面の上から下まで: ' + JSON.stringify(v2));
    await page2.close();
  }
});

test('Spotify: MV の左右表示で歌詞がないときは、映像を画面いっぱいに（中央寄りで）広げる。歌詞が出る間は、左 70% に戻る', async () => {
  await setSp({ lyrics: true, mvLayout: 'split', mvOverlap: true });
  const page = await open({ video: true });
  const root = page.locator('#sv-np');
  const vp = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const vbox = () => page.locator('#sv-np-video').boundingBox();
  await until(async () => (await root.locator('.sv-np-line').count()) === 6, { timeout: 12000, message: '歌詞が出る' });
  assert.equal(await root.getAttribute('data-mv-wide'), null, '歌詞があるときは広げない');
  assert.ok(Math.abs((await vbox()).width - vp.w * 0.7) < 2, '左 70%');
  // 歌詞のない曲: 映像が画面の幅いっぱい
  await page.evaluate(() => { window.__fx.setTrack('歌詞なしの曲', 'spotify:track:none'); window.__fx.cacheAvail('spotify:track:none', false); });
  await until(async () => (await root.getAttribute('data-mv-wide')) === '1', { timeout: 6000, message: '歌詞がないと分かったら、広げる' });
  let b = await vbox();
  assert.ok(Math.abs(b.x) < 2 && Math.abs(b.width - vp.w) < 2, '映像は画面の幅いっぱい: ' + JSON.stringify(b));
  assert.equal(await root.locator('.sv-np-lyrics').isVisible(), false);
  assert.equal(await root.getAttribute('data-mv'), 'split', '左右の表示のまま（歌詞が来たら戻る）');
  // 歌詞のある曲に変わったら、左 70% に戻る
  await page.evaluate(() => { window.__fx.setTrack('歌詞ありの曲', 'spotify:track:third'); window.__fx.cacheLyrics('spotify:track:third', ['一', '二', '三']); });
  await until(async () => (await root.getAttribute('data-mv-wide')) === null, { timeout: 6000, message: '歌詞が来たら、戻る' });
  assert.ok(Math.abs((await vbox()).width - vp.w * 0.7) < 2, '左 70% に戻る');
  await page.close();

  // 設定で歌詞をオフにしているときも、広げる
  await setSp({ lyrics: false, mvLayout: 'split', mvOverlap: true });
  const page2 = await open({ video: true });
  const root2 = page2.locator('#sv-np');
  await until(async () => (await root2.getAttribute('data-mv-wide')) === '1', { timeout: 12000, message: '歌詞オフなら広げる' });
  const b2 = await page2.locator('#sv-np-video').boundingBox();
  assert.ok(Math.abs(b2.width - vp.w) < 2, '映像は画面の幅いっぱい');
  await page2.close();

  // 全画面では、もともと画面いっぱい（広げる属性は付かない）
  await setSp({ lyrics: false, mvLayout: 'full', mvOverlap: true });
  const page3 = await open({ video: true });
  const root3 = page3.locator('#sv-np');
  await until(async () => (await root3.getAttribute('data-mv')) === 'full', { timeout: 12000, message: '全画面' });
  assert.equal(await root3.getAttribute('data-mv-wide'), null);
});

test('Spotify: MV は、Spotify 自身と同じく、再生状態の signals で見分ける（switch-to-audio＝映像を再生中）。mediaType が音のままでも、映像を出す', async () => {
  await setSp({ lyrics: false, mvLayout: 'full' });
  const page = await open({ songVideoPlaying: true });
  const root = page.locator('#sv-np');
  await until(async () => (await root.getAttribute('data-mv')) === 'full', { timeout: 12000, message: 'signals だけで映像と分かる' });
  assert.ok((await fx(page, 'log')).some((l) => l.ev === 'app' && l.action === 'video:claim'));
  assert.ok(!(await fx(page, 'log')).some((l) => l.ev === 'app' && /^signal:/.test(l.action)), '映像を再生中なので、切り替えの信号は送らない');
});

test('Spotify: 映像のある曲（signals に switch-to-video。いまは音だけ）は、設定が許せば、自動で映像に切り替える（Spotify 自身の「映像に切り替える」と同じ sendSignal）。曲ごとに最大 2 回。スマホで音に戻されても戻さない。設定オフ・MV を出さない設定なら送らない', async () => {
  const signals = async (page) => (await fx(page, 'log')).filter((l) => l.ev === 'app' && /^signal:/.test(l.action)).map((l) => l.action);
  // 自動（既定）
  await setSp({ lyrics: false, mvLayout: 'full', mvAuto: true });
  let page = await open({ songVideo: true });
  let root = page.locator('#sv-np');
  await until(async () => (await signals(page)).length >= 1, { timeout: 8000, message: '切り替えの信号を送る' });
  assert.deepEqual(await signals(page), ['signal:switch-to-video']);
  await until(async () => (await root.getAttribute('data-mv')) === 'full', { timeout: 8000, message: '映像が出る' });
  // スマホで音に戻された: 同じ曲では、勝手に戻さない
  await page.evaluate(() => window.__fx.setVideo(false));
  await until(async () => (await root.getAttribute('data-mv')) === null, { timeout: 8000, message: '音に戻る' });
  await page.waitForTimeout(6500);
  assert.deepEqual(await signals(page), ['signal:switch-to-video'], '一度でも映像になった曲は、もう切り替えない（スマホで音に戻したのを、勝手に戻さない）');
  assert.equal(await root.getAttribute('data-mv'), null, '勝手に映像に戻さない');
  await page.close();

  // 設定「自動で切り替える」がオフ
  await setSp({ lyrics: false, mvLayout: 'full', mvAuto: false });
  page = await open({ songVideo: true });
  root = page.locator('#sv-np');
  await until(async () => /映像 なし（映像あり・音で再生中）/.test(await root.locator('.sv-np-ver').evaluate((e) => e.textContent)), { timeout: 10000, message: '音で再生中と表示' });
  await page.waitForTimeout(1500);
  assert.deepEqual(await signals(page), [], '信号は送らない');
  await page.close();

  // MV を出さない設定
  await setSp({ lyrics: false, mvLayout: 'off', mvAuto: true });
  page = await open({ songVideo: true });
  await page.waitForTimeout(2500);
  assert.deepEqual(await signals(page), [], 'MV を出さないなら、信号は送らない');
  await page.close();
});

test('Spotify: 歌詞の枠で行を切らない（動いている途中でも、枠の端で行が半分切れて見えない）。遠い行は透明', async () => {
  await setSp({ lyrics: true, mvLayout: 'off' });
  const page = await open({ fineLyrics: true, pos: 20000 });
  const root = page.locator('#sv-np');
  await until(async () => (await root.locator('.sv-np-line').count()) === 120, { timeout: 12000, message: '歌詞が出る' });
  // 行を切る祖先がない（歌詞の枠・列・その外側の枠。画面全体の #sv-np は除く）
  const clipping = await page.evaluate(() => {
    const out = [];
    for (let e = document.querySelector('#sv-np .sv-np-line').parentElement; e && e.id !== 'sv-np'; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || (cs.clipPath && cs.clipPath !== 'none') || (cs.maskImage && cs.maskImage !== 'none')) out.push(e.className);
    }
    return out;
  });
  assert.deepEqual(clipping, [], '行を切る枠・マスクがない');
  // 遠い行（4 行以上離れた行）は透明
  await until(async () => (await root.locator('.sv-np-line.is-current').count()) === 1, { timeout: 5000, message: 'いまの行がある' });
  const far = await page.evaluate(() => {
    const k = Array.from(document.querySelectorAll('#sv-np .sv-np-line'));
    const c = k.findIndex((e) => e.classList.contains('is-current'));
    return [c - 6, c - 4, c + 4, c + 6].filter((i) => i >= 0 && i < k.length).map((i) => Number(getComputedStyle(k[i]).opacity));
  });
  assert.ok(far.length >= 3 && far.every((o) => o < 0.02), '遠い行は透明: ' + JSON.stringify(far));
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
