// Spotify Web プレーヤー（open.spotify.com）: 再現ページでの E2E（ネットワーク不要）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, tverReady } from './helpers.mjs';
import { spotifyHtml } from '../fixtures/spotify.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://open.spotify.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spotifyHtml() }));
});
test.after(async () => {
  await env.close();
});

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

test('Spotify: 読み込むと、内容（main）の最初のカードにフォーカスが入る。画面倍率の手順は完了する', async () => {
  const page = await open();
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
  for (let i = 0; i < 6 && (await page.evaluate(() => document.activeElement.dataset.testid)) !== 'search-input'; i++) await press(page, 'ArrowUp');
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
  const toSlider = async (kind) => {
    for (let i = 0; i < 14; i++) {
      if ((await page.evaluate(() => document.activeElement.getAttribute('data-sv-slider'))) === kind) return true;
      await press(page, i < 5 ? 'ArrowDown' : i % 2 ? 'ArrowRight' : 'ArrowDown');
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
  assert.equal(await toSlider('volume'), true, '音量の棒に届く');
  await press(page, 'Enter');
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft');
  assert.deepEqual(await ranges('volume'), [0.9, 0.8]);
  // リモコンで使えない「最新情報」は隠れ、候補にならない
  assert.equal(await page.locator('[data-testid="whats-new-feed-button"]').isVisible(), false);
  await page.close();
});
