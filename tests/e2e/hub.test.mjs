// 拡張機能の読み込み・ハブ・YouTube（スタブ）の E2E。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, extensionIdFromKey, manifest } from './helpers.mjs';

let env;
test.before(async () => {
  env = await launch();
  // YouTube /tv はスタブで応答する（拡張のコンテンツスクリプトは URL で注入される）。
  // /tv 以外には route を張らない（route が DNR のリダイレクトより先に処理されるため）。
  await env.ctx.route('https://www.youtube.com/tv**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt stub</title><body><h1>stub</h1></body>' }),
  );
});
test.after(async () => {
  await env.close();
});

async function openHub() {
  const page = await env.ctx.newPage();
  await page.goto(env.hubUrl);
  await until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  return page;
}

test('拡張機能が読み込まれ、拡張 ID が manifest の key から決まる', async () => {
  assert.equal(env.extId, await extensionIdFromKey(manifest.key));
  const page = await env.ctx.newPage();
  await page.goto(env.hubUrl);
  const info = await page.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'sv:info' }, r)));
  assert.equal(info.ok, true);
  assert.equal(info.version, manifest.version);
  assert.equal(info.id, env.extId);
  await page.close();
});

test('ハブ: 初期フォーカスは YouTube タイル、十字キーでタイル・レール間を移動できる', async () => {
  const page = await openHub();
  assert.match((await active(page)).cls, /tile-yt/);

  await press(page, 'ArrowRight');
  assert.match((await active(page)).cls, /tile-tver/);

  await press(page, 'ArrowDown'); // 下段の小さなタイルへ
  const small = await active(page);
  assert.match(small.cls, /tile/);
  assert.ok(['diag', 'settings'].includes(small.sv), `small tile: ${small.sv}`);

  await press(page, 'ArrowLeft');
  assert.equal((await active(page)).sv, 'diag');
  await press(page, 'ArrowUp'); // diag の上は YouTube タイル
  assert.match((await active(page)).cls, /tile-yt/);

  // 左端でさらに ← → レール（現在ページ＝ホーム）。レールは展開する
  await press(page, 'ArrowLeft');
  const rail = await active(page);
  assert.match(rail.cls, /rail-item/);
  assert.equal(rail.sv, 'home');
  assert.ok((await page.locator('.rail').evaluate((el) => el.getBoundingClientRect().width)) > 200, 'rail expanded');

  await press(page, 'ArrowDown');
  assert.equal((await active(page)).sv, 'youtube');
  await press(page, 'ArrowRight'); // コンテンツへ戻る（直前の位置）
  assert.match((await active(page)).cls, /tile-yt/);
  await page.close();
});

test('ハブ: 端での移動は何も起きず、スクロールもしない', async () => {
  const page = await openHub();
  await press(page, 'ArrowUp');
  assert.match((await active(page)).cls, /tile-yt/);
  await press(page, 'ArrowLeft'); // → レール
  await press(page, 'ArrowLeft'); // レールのさらに左: 何もない
  assert.match((await active(page)).cls, /rail-item/);
  assert.equal(await page.evaluate(() => window.scrollY), 0);
  await page.close();
});

test('ハブ: Home・Esc は何もしない（ルート）/ Enter で YouTube を開く', async () => {
  const page = await openHub();
  await press(page, 'Home');
  await press(page, 'Escape');
  assert.equal(page.url(), env.hubUrl);
  await page.keyboard.press('Enter');
  await page.waitForURL('https://www.youtube.com/tv');
  await page.close();
});

test('YouTube /tv: UA が TV 端末に偽装され、Home でハブへ戻る', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://www.youtube.com/tv');
  const info = await page.evaluate(() => ({ ua: navigator.userAgent, uaData: String(navigator.userAgentData), cls: document.documentElement.className }));
  assert.match(info.ua, /Tizen/);
  assert.equal(info.uaData, 'undefined');
  assert.match(info.cls, /sv-yt/);

  await page.keyboard.press('ArrowDown'); // /tv の操作は公式に任せる（スタブでは何も起きない）
  assert.match(page.url(), /youtube\.com\/tv/);
  await page.keyboard.press('Home');
  await page.waitForURL(env.hubUrl);
  await page.close();
});

test('YouTube /tv: BrowserHome キーでもハブへ戻る', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://www.youtube.com/tv');
  // BrowserHome は物理キーとして送れないため、合成せず key 名だけ一致するイベントを CDP で送る
  const cdp = await env.ctx.newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await page.waitForURL(env.hubUrl, { timeout: 8000 });
  await page.close();
});

test('YouTube: 戻るキー長押しでハブへ（設定で有効にした場合のみ）', async () => {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { holdBackToHome: true, holdMs: 400 } }, r)));
  const page = await env.ctx.newPage();
  await page.goto('https://www.youtube.com/tv');
  await page.waitForTimeout(500); // 設定の読み込み待ち
  await page.keyboard.down('Escape');
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(100);
    await page.keyboard.down('Escape'); // リピート（repeat: true）
  }
  await page.keyboard.up('Escape');
  await page.waitForURL(env.hubUrl, { timeout: 8000 });
  await page.close();
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('sv.settings', r)));
});

test('YouTube: 通常 URL の転送は既定ではオフ。設定でオンにすると /tv へ転送される', async () => {
  const enabled = () => env.sw.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  const rulesets = await enabled();
  assert.ok(rulesets.includes('yt-ua'), 'UA ルールは常時オン');
  assert.ok(!rulesets.includes('yt-redirect'), '転送ルールは既定でオフ');

  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { youtube: { redirect: true } } }, r)));
  await until(async () => (await enabled()).includes('yt-redirect'), { message: 'yt-redirect enabled' });

  const page = await env.ctx.newPage();
  await page.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5');
  assert.equal(page.url(), 'https://www.youtube.com/tv#/watch?v=jNQXAC9IVRw');
  await page.goto('https://youtu.be/jNQXAC9IVRw?si=abc');
  assert.equal(page.url(), 'https://www.youtube.com/tv#/watch?v=jNQXAC9IVRw');
  await page.goto('https://www.youtube.com/');
  assert.equal(page.url(), 'https://www.youtube.com/tv');
  await page.close();

  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('sv.settings', r)));
  await until(async () => !(await enabled()).includes('yt-redirect'), { message: 'yt-redirect disabled' });
});
