// 裏で YouTube /tv を開いておく設定（スマホのリモコンの受け取り役）。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, until } from './helpers.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://www.youtube.com/tv**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt stub</title><body><h1>stub</h1></body>' }),
  );
});
test.after(async () => {
  await env.close();
});

const tabsOf = () => env.sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url || '', active: t.active })));
const activeUrl = async () => (await tabsOf()).find((t) => t.active)?.url;
const ytTabs = async () => (await tabsOf()).filter((t) => t.url.startsWith('https://www.youtube.com/tv'));

test('裏で開く設定: オンにすると /tv が裏のタブで 1 つだけ開く。ハブの YouTube タイルは、そのタブを前面に出す', async () => {
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { youtube: { receiver: true } } }, r)));
  await until(async () => (await ytTabs()).length === 1, { message: '裏の /tv が開く' });
  assert.equal((await ytTabs())[0].active, false, '前面を奪わない');
  await until(async () => /スマホのリモコン.*\/tv: 裏/.test(await hub.locator('#remote-line').innerText()), { timeout: 8000, message: 'ハブにスマホのリモコンの状態の一行が出る' });
  const yt0 = env.ctx.pages().find((p) => p.url().startsWith('https://www.youtube.com/tv'));
  assert.deepEqual(await yt0.evaluate(() => [document.hidden, document.visibilityState]), [false, 'visible'], '/tv には、いつも見えている扱いにする（裏で接続を切らない）');
  await hub.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ type: 'sv:ensureReceiver' }, r)));
  await hub.waitForTimeout(500);
  assert.equal((await ytTabs()).length, 1, '何度頼んでも 1 つだけ');

  await hub.bringToFront();
  await hub.locator('a.tile-yt').focus();
  await hub.keyboard.press('Enter');
  await until(async () => (await activeUrl()).startsWith('https://www.youtube.com/tv'), { message: '裏の /tv が前面に出る' });
  assert.equal(hub.url(), env.hubUrl, 'ハブのタブは動かさない');
  assert.equal((await ytTabs()).length, 1, '/tv をもう 1 つ開かない');
  await hub.close().catch(() => {});
});

test('裏で開く設定: /tv から Home でハブ（残っているタブ）が前面に出て、/tv は裏に残る。スマホから再生画面にされると前面に出る', async () => {
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  const yt = env.ctx.pages().find((p) => p.url().startsWith('https://www.youtube.com/tv'));
  assert.ok(yt, '裏の /tv がある');
  await yt.bringToFront();
  assert.ok((await activeUrl()).startsWith('https://www.youtube.com/tv'));
  await yt.evaluate(() => { window.__marker = 1; location.hash = '#/watch?v=abc'; }); // 再生画面（スマホから送られた状態）
  const cdp = await env.ctx.newCDPSession(yt);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await until(async () => (await activeUrl()).startsWith('chrome-extension://') || (await activeUrl()) === '', { message: 'ハブが前面に出る' });
  assert.equal((await ytTabs()).length, 1, '/tv のタブは残る（受け取りが切れない）');

  // 再読み込みはしない（スマホとの接続が切れる）。再生画面だけホームに戻る
  await until(async () => (await yt.evaluate(() => location.hash)) === '#/', { message: '再生画面からホームに戻る' });
  assert.equal(await yt.evaluate(() => window.__marker), 1, '/tv のページは再読み込みされない');
  // スマホから YouTube を送られた（/tv が再生画面になった）
  await yt.evaluate(() => { location.hash = '#/watch?v=def'; });
  await until(async () => (await activeUrl()).startsWith('https://www.youtube.com/tv'), { message: '再生画面になったら前面に出る' });
  await hub.close().catch(() => {});
});

test('裏で開く設定: /tv が 2 つになったら 1 つに整える。/tv しか開いていなくても、ハブへ戻るときは /tv のタブを動かさず、ハブを新しいタブで開く（受け取り役が一瞬もなくならない）', async () => {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { youtube: { receiver: true } } }, r)));
  await until(async () => (await ytTabs()).length === 1, { message: '裏の /tv が 1 つ' });
  // 自分で /tv をもう 1 つ開いた
  const dup = await env.ctx.newPage();
  await dup.goto('https://www.youtube.com/tv');
  await until(async () => (await ytTabs()).length === 1, { timeout: 12000, message: '1 つに整う' });
  // ほかのタブを全部閉じて、/tv だけにする
  for (const p of env.ctx.pages()) if (p !== dup && !p.isClosed()) await p.close().catch(() => {});
  await until(async () => (await tabsOf()).length === 1, { message: 'タブは /tv だけ' });
  await dup.bringToFront();
  await until(() => dup.evaluate(() => document.documentElement.classList.contains('sv-yt')), { message: '拡張が読み込まれる' });
  const ytId = (await ytTabs())[0].id;
  const cdp = await env.ctx.newCDPSession(dup);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'BrowserHome', code: 'BrowserHome', windowsVirtualKeyCode: 172 });
  // /tv のタブは動かさず、ハブが新しいタブで開く（/tv が一瞬もなくならない）
  await until(async () => (await tabsOf()).length === 2 && (await tabsOf()).some((t) => t.active && !t.url.startsWith('https://www.youtube.com/tv')), { message: 'ハブが新しいタブで前面に出る' });
  const yts = await ytTabs();
  assert.equal(yts.length, 1);
  assert.equal(yts[0].id, ytId, '/tv は同じタブのまま');
  assert.equal(yts[0].active, false);
  assert.equal(dup.url().startsWith('https://www.youtube.com/tv'), true, '/tv のページは遷移していない');
  for (const p of env.ctx.pages()) await p.close().catch(() => {});
});

test('裏で開く設定がオフ（既定）のときは、何も開かず、タイルは今までどおり同じタブで開く', async () => {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { youtube: { receiver: false } } }, r)));
  for (const p of env.ctx.pages()) if (p.url().startsWith('https://www.youtube.com/tv')) await p.close();
  await new Promise((r) => setTimeout(r, 4000)); // 閉じても開き直さない
  assert.equal((await ytTabs()).length, 0);
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  await hub.locator('a.tile-yt').focus();
  await hub.keyboard.press('Enter');
  await hub.waitForURL('https://www.youtube.com/tv', { timeout: 8000 });
  await hub.close();
});
