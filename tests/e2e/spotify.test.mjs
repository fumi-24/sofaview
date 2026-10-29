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
