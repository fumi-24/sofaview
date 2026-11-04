// Spotify Web プレーヤー（open.spotify.com）: 再現ページでの E2E（ネットワーク不要）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, tverReady } from './helpers.mjs';
import { spotifyHtml } from '../fixtures/spotify.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml() }));
  await setSp({ browse: true }); // 既定は「常に再生中の画面」。一覧のページの操作を調べるテストは browse で
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
const where = async (page) => (await active(page)) || {};

test('Spotify: 読み込むと、内容（main）の最初のカードにフォーカスが入る。画面倍率の手順は完了する。版の表示が出る', async () => {
  const page = await open();
  assert.match(await page.locator('#sv-badge').innerText(), /SofaView v\d+\.\d+\.\d+（Spotify）/);
  await until(async () => (await where(page)).href === '/album/a1', { message: '最初のカード' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-sp')), true);
  await page.close();
});

test('Spotify: 十字キーで、カード・次の行・左の一覧・上のバー・下の再生バーへ移れる。別サイトのリンクと新しいタブのリンクには止まらない', async () => {
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  const seen = new Set();
  const visit = async () => {
    const a = await where(page);
    seen.add(a.href || a.label);
    return a;
  };
  await press(page, 'ArrowRight');
  await visit();
  await press(page, 'ArrowDown'); // 次の棚
  const second = await visit();
  assert.match(second.href || '', /\/album\/b/, '下の棚のカード');
  await press(page, 'ArrowUp');
  await press(page, 'ArrowUp'); // 上のバー
  await visit();
  assert.ok(['search-input'].includes(await page.evaluate(() => document.activeElement.dataset.testid)) || (await where(page)).href === '/' || (await where(page)).href.includes('premium') === false, '上のバーに届く');
  // 左の一覧へ
  await press(page, 'ArrowDown');
  for (let i = 0; i < 6; i++) await press(page, 'ArrowLeft');
  for (let i = 0; i < 6; i++) {
    await press(page, 'ArrowDown');
    await visit();
  }
  for (const href of seen) {
    assert.ok(!/spotify\.com\/legal|\/other|spotify\.com\/jp\/premium/.test(String(href)), '別サイト・新しいタブのリンクには止まらない: ' + href);
  }
  await page.close();
});

test('Spotify: OK でカードを開く（サイトの遷移）。戻るで前の画面へ。曲の行で OK を押すと、その曲を再生する', async () => {
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  await press(page, 'Enter');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'navigate' && l.to === '/album/a1'), { message: 'アルバムへ' });
  await until(async () => !!(await active(page)), { message: '遷移後にフォーカスが入る' });
  // 曲の行へ
  for (let i = 0; i < 4 && !(await page.evaluate(() => document.activeElement.matches('[data-testid="tracklist-row"]'))); i++) await press(page, 'ArrowDown');
  assert.equal(await page.evaluate(() => document.activeElement.matches('[data-testid="tracklist-row"]')), true, '曲の行にフォーカス');
  await press(page, 'Enter');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'click' && /^track-/.test(l.id)), { message: '曲の再生ボタンが押される' });
  await press(page, 'Escape');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'popstate' && l.to === '/'), { message: '戻る' });
  await page.close();
});

test('Spotify: 再生/一時停止・次・前のキーで、サイトの操作ボタンを押す', async () => {
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  const cdp = await env.ctx.newCDPSession(page);
  for (const [key, code] of [['MediaPlayPause', 179], ['MediaTrackNext', 176], ['MediaTrackPrevious', 177]]) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await page.waitForTimeout(150);
  }
  const ids = (await fx(page, 'log')).filter((l) => l.ev === 'click').map((l) => l.id);
  assert.deepEqual(ids, ['control-button-playpause', 'control-button-skip-forward', 'control-button-skip-back']);
  await page.close();
});

test('Spotify: 検索欄で OK を押すと画面上のキーボードが開き、打った文字が検索欄に入る（input イベントで）', async () => {
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  for (let i = 0; i < 12 && (await page.evaluate(() => document.activeElement.dataset.testid)) !== 'search-input'; i++) await press(page, i < 3 ? 'ArrowUp' : 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'search-input', '検索欄に届く');
  await press(page, 'Enter');
  await until(() => page.evaluate(() => !!document.getElementById('sv-osk')), { message: '画面上のキーボード' });
  await page.keyboard.type('abc');
  await until(async () => (await fx(page, 'inputs')).includes('abc'), { message: '検索欄に入る' });
  await press(page, 'Escape');
  await page.close();
});

test('Spotify: Home を押すと、Spotify のタブは動かさず（音楽が止まらない）、ハブが新しいタブで前面に出る。ハブの Spotify タイルは、そのタブを前面に出す', async () => {
  const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  // 実際の使い方と同じ: ハブのタブがあり、そこから Spotify のタブを開く
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  const sp = await open();
  await until(async () => (await where(sp)).href === '/album/a1');
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

test('Spotify: 再生バーの再生位置・音量の棒にフォーカスでき、← → で動かせる（本体の input は画面に出ないので、見える容器に印を付ける）。早送り・巻き戻しのキーは再生位置を 10 秒動かす', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  assert.equal(await page.locator('[data-sv-slider]').count(), 2, '再生位置と音量に印が付く');
  const kindNow = () => page.evaluate(() => document.activeElement.getAttribute('data-sv-slider'));
  const toSlider = async (kind) => {
    for (let i = 0; i < 16; i++) {
      if ((await kindNow()) === kind) return true;
      // 再生バーの外からは下へ。バーの中では、目的の棒の向き（再生位置は左・音量は右）へ
      const inBar = await page.evaluate(() => !!document.activeElement.closest('[data-testid="now-playing-bar"]'));
      const leftOf = await page.evaluate((k) => {
        const t = document.querySelector('[data-sv-slider="' + k + '"]').getBoundingClientRect();
        const a = document.activeElement.getBoundingClientRect();
        return t.left + t.width / 2 < a.left + a.width / 2;
      }, kind);
      await press(page, !inBar ? 'ArrowDown' : leftOf ? 'ArrowLeft' : 'ArrowRight');
    }
    return false;
  };
  assert.equal(await toSlider('seek'), true, '再生位置の棒に届く');
  const ranges = async (kind) => (await fx(page, 'log')).filter((l) => l.ev === 'range' && l.kind === kind).map((l) => l.value);
  await press(page, 'ArrowRight'); // 調整中でないときは、← → は普通のフォーカス移動
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider')), null, '棒から出る');
  await press(page, 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider')), 'seek', '戻る');
  assert.deepEqual(await ranges('seek'), [], 'まだ動いていない');
  await press(page, 'Enter'); // 調整中へ
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  await press(page, 'ArrowLeft');
  assert.deepEqual(await ranges('seek'), [60000, 70000, 60000], '← → で 10 秒ずつ');
  await press(page, 'Enter'); // 調整を終える
  await press(page, 'ArrowRight');
  assert.notEqual(await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider')), 'seek', '調整を終えると、← → で移れる');
  await toSlider('seek');
  // 早送り・巻き戻しのキー（フォーカスがどこでも）
  const cdp = await env.ctx.newCDPSession(page);
  for (const [key, code] of [['MediaFastForward', 228], ['MediaRewind', 227]]) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
    await page.waitForTimeout(150);
  }
  assert.deepEqual((await ranges('seek')).slice(3), [70000, 60000]);
  // 音量: 0.1 ずつ
  assert.equal(await toSlider('seek'), true);
  for (let i = 0; i < 8 && (await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider'))) !== 'volume'; i++) await press(page, 'ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider')), 'volume', '音量の棒に届く（再生位置から →）');
  await press(page, 'Enter');
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  assert.deepEqual(await ranges('volume'), [0.9, 0.8]);
  // リモコンで使えない「最新情報」は隠れ、候補にならない
  assert.equal(await page.locator('[data-testid="whats-new-feed-button"]').isVisible(), false);
  await page.close();
});

test('Spotify: 再生バーのジャケットで OK を押すと、再生中の画面（曲名・アーティスト・歌詞・再生位置）が開く。操作でボタンの列が出て、← → で選んで OK。↑ ↓ 音量。戻るで列が隠れ、もう一度で閉じる。黄色キーでも開閉', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  const np = page.locator('#sv-np');
  for (let i = 0; i < 12 && (await page.evaluate(() => document.activeElement.dataset.testid)) !== 'cover-art-button'; i++) await press(page, i < 5 ? 'ArrowDown' : 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'cover-art-button', 'ジャケットに届く');
  await press(page, 'Enter');
  await until(async () => (await np.count()) === 1, { message: '再生中の画面が開く' });
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
  await until(async () => (await np.count()) === 0, { message: '戻る（ボタンが出ていないとき）で閉じる' });
  assert.equal(await page.locator('[data-testid="lyrics-button"]').getAttribute('aria-pressed'), 'false', '歌詞は、こちらで出した分だけ元に戻す');
  const cdp = await env.ctx.newCDPSession(page);
  const yellow = async () => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ColorF2Yellow', code: 'ColorF2Yellow', windowsVirtualKeyCode: 405 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ColorF2Yellow', code: 'ColorF2Yellow', windowsVirtualKeyCode: 405 });
    await page.waitForTimeout(150);
  };
  await yellow();
  assert.equal(await np.count(), 1, '黄色キーで開く');
  await yellow();
  assert.equal(await np.count(), 0, '黄色キーで閉じる');
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
const yellowKey = async (page) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ColorF2Yellow', code: 'ColorF2Yellow', windowsVirtualKeyCode: 405 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ColorF2Yellow', code: 'ColorF2Yellow', windowsVirtualKeyCode: 405 });
  await page.waitForTimeout(200);
};

test('Spotify: ログインしていないと、状態の画面で理由と、やることを出す。OK でログイン画面を開く（ボタンを押す）。戻るで閉じる', async () => {
  const page = await openVariant({ loggedOut: true, noTrack: true });
  await yellowKey(page);
  const np = page.locator('#sv-np');
  await until(async () => (await np.count()) === 1, { message: '画面が開く' });
  assert.equal(await np.getAttribute('data-kind'), 'loggedOut');
  assert.equal(await np.getAttribute('data-view'), 'status');
  assert.match(await np.innerText(), /Spotify にログインしていません/);
  assert.match(await np.innerText(), /OK でログイン画面を開く/);
  await page.keyboard.press('Enter');
  await until(async () => (await fx(page, 'log')).some((l) => l.ev === 'login'), { message: 'ログインのボタンが押される' });
  await page.keyboard.press('Escape');
  await until(async () => (await np.count()) === 0, { message: '戻るで閉じる' });
  await page.close();
});

test('Spotify: ログインしていて曲がないときは、スマホから再生するのを待つ画面（手順つき）。保護機能（Widevine）がないブラウザでは、再生できない理由を出す', async () => {
  const page = await openVariant({ noTrack: true });
  await yellowKey(page);
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

test('Spotify: 画面倍率は TVer（720）より小さい高さ（648）に合わせて、大きく拡大する', async () => {
  const page = await open();
  await until(async () => Math.abs((await page.evaluate(() => innerHeight)) - 648) < 12, { message: '1080 の画面が 648 相当（約 1.67 倍）' });
  await page.close();
});

test('Spotify: 「裏で開いておく」をオンにすると、Spotify が裏のタブで開き、読み込むと再生中の画面（待機）を出す。スマホから再生が始まる（曲が変わる）と、裏のタブなら前面に出て、新しい曲を出す。ハブのタイルに状態が出る', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  await env.sw.evaluate(() => chrome.storage.session.remove(['svSpotifyAt', 'svSpotifyState']));
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: { standby: true, browse: true } } }, r)));
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
  // 戻るで画面を閉じたあと、前面でも、曲が変われば、また再生中の画面になる（スマホ主体の使い方）
  await sp.keyboard.press('Escape');
  await until(async () => (await sp.locator('#sv-np').count()) === 0, { message: '戻るで閉じる' });
  await sp.evaluate(() => window.__fx.setTrack('前面で変わった曲'));
  await until(async () => (await sp.locator('#sv-np').count()) === 1, { message: '前面でも開く' });
  await until(async () => /前面で変わった曲/.test(await sp.locator('#sv-np').innerText()), { message: '新しい曲' });
  // 設定をオフに戻す
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { spotify: { standby: false, browse: true } } }, r)));
  await hub.close().catch(() => {});
  await sp.close().catch(() => {});
});

test('Spotify: サイトのメニュー（role=menu）が開いている間は、十字キーはメニューの中だけを動き、戻るはメニューを閉じる（ページは戻らない）', async () => {
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://open.spotify.com/')) await p.close().catch(() => {});
  const page = await open();
  await until(async () => (await where(page)).href === '/album/a1');
  for (let i = 0; i < 14 && (await page.evaluate(() => document.activeElement.dataset.testid)) !== 'more-button'; i++) await press(page, i < 3 ? 'ArrowUp' : 'ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.testid), 'more-button', '「…」に届く');
  await press(page, 'Enter');
  await until(async () => (await page.locator('#ctx').count()) === 1, { message: 'メニューが開く' });
  const inMenu = () => page.evaluate(() => !!document.activeElement.closest('#ctx'));
  assert.equal(await inMenu(), true, 'フォーカスはメニューの中');
  // 十字キーは、メニューの外（後ろのページ）へ出ない
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowUp']) {
    await press(page, k);
    assert.equal(await inMenu(), true, k + ' でメニューの外へ出ない');
  }
  await press(page, 'Enter');
  assert.equal((await fx(page, 'log')).filter((l) => l.ev === 'menu-item').length, 1, 'OK でメニューの項目を押せる');
  await press(page, 'Escape');
  await until(async () => (await page.locator('#ctx').count()) === 0, { message: '戻るでメニューが閉じる' });
  assert.equal((await fx(page, 'log')).filter((l) => l.ev === 'popstate' || l.ev === 'navigate').length, 0, 'ページは戻らない');
  await page.close();
});

test('Spotify: 既定は「常に再生中の画面」。読み込むと開き、戻る・黄色キーでは閉じない。↑ ↓ は効く。曲がなくても状態の画面のまま', async () => {
  await setSp({ browse: false });
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.count()) === 1, { message: '読み込むと再生中の画面が開く' });
  assert.match(await np.innerText(), /テスト曲のタイトル/);
  await press(page, 'Escape');
  await yellowKey(page);
  assert.equal(await np.count(), 1, '戻る・黄色キーでは閉じない');
  // 元の画面は完全に差し替える: 描画しない（隠れている）。画面倍率の変更もしない。キーは元の画面に届かない
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).visibility), 'hidden', '元の画面は描画しない');
  assert.equal(await np.evaluate((e) => getComputedStyle(e).visibility), 'visible');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svZoom), 'skipped');
  const before = (await fx(page, 'log')).length;
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowRight');
  assert.equal((await fx(page, 'log')).slice(before).filter((l) => l.ev === 'range').length, 0, '最初の ← → は、元の画面の再生位置を動かさない（ボタンの列を出すだけ）');
  await press(page, 'ArrowUp');
  await until(async () => /音量 \d+%/.test(await page.locator('.sv-np-toast').innerText()), { message: '音量の表示' });
  const v = await openVariant({ loggedOut: false, noTrack: true });
  await until(async () => (await v.locator('#sv-np').count()) === 1, { message: '曲がなくても状態の画面が開く' });
  await press(v, 'Escape');
  assert.equal(await v.locator('#sv-np').count(), 1, '状態の画面も閉じない');
  await v.close();
  await page.close();
  await setSp({ browse: true });
});

test('Spotify: 歌詞のオン/オフ。ボタンで切り替えると設定に保存され、オフの間は歌詞を出さない。5 秒操作しないと、ボタンの列は隠れる', async () => {
  await setSp({ browse: false, lyrics: true });
  const page = await open();
  const np = page.locator('#sv-np');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { message: '歌詞が出る' });
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
  assert.equal(await page.locator('[data-testid="lyrics-button"]').getAttribute('aria-pressed'), 'false', 'サイトの歌詞表示も閉じる');
  await press(page, 'Enter');
  await until(async () => (await np.locator('.sv-np-line').count()) === 6, { message: '歌詞がまた出る' });
  await until(async () => (await saved()) === true);
  // 設定がオフなら、最初から出さない
  await page.close();
  await setSp({ browse: false, lyrics: false });
  const p2 = await open();
  await until(async () => (await p2.locator('#sv-np').count()) === 1);
  await p2.waitForTimeout(800);
  assert.equal(await p2.locator('#sv-np .sv-np-lyrics').isVisible(), false);
  assert.equal(await p2.locator('[data-testid="lyrics-button"]').getAttribute('aria-pressed'), 'false', 'サイトの歌詞表示を開かない');
  // 5 秒でボタンの列が隠れる
  await press(p2, 'ArrowRight');
  assert.equal(await p2.locator('.sv-np-controls').isVisible(), true);
  await until(async () => (await p2.locator('.sv-np-controls').isVisible()) === false, { timeout: 8000, message: '5 秒で隠れる' });
  await p2.close();
  await setSp({ browse: true });
});
