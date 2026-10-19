// ハブの拡張ページ（キー診断・設定・キー割り当て）の E2E。リモコンのキーだけで操作できることを確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, tverReady } from './helpers.mjs';
import { homeHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homeHtml() }),
  );
});
test.after(async () => {
  await env.close();
});

const url = (name) => env.hubUrl.replace('index.html', name);
const stored = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.get('sv.settings', (v) => r(v['sv.settings']))));
const clearStored = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('sv.settings', r)));

async function open(name) {
  const page = await env.ctx.newPage();
  await page.goto(url(name));
  await until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: name + ' ready' });
  return page;
}

const text = (page, sel) => page.locator(sel).textContent();

test.afterEach(async () => {
  await clearStored();
});

test('ハブ: キー診断・設定のタイルを Enter で開ける', async () => {
  const page = await open('index.html');
  await press(page, 'ArrowDown'); // 下段の小さなタイル
  const first = await active(page);
  assert.match(first.cls, /tile/);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/hub\/(diag|settings)\.html$/);
  await page.close();
});

test('キー診断: 押したキーの key / code / keyCode と割り当てを表示する', async () => {
  const page = await open('diag.html');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await text(page, '#d-key'), '"ArrowLeft"');
  assert.equal(await text(page, '#d-code'), '"ArrowLeft"');
  assert.equal(await text(page, '#d-keycode'), '37');
  assert.equal(await text(page, '#d-action'), 'LEFT');
  assert.equal(await text(page, '#key-main'), 'ArrowLeft');

  await page.keyboard.press('q'); // 未割り当て
  assert.equal(await text(page, '#d-key'), '"q"');
  assert.equal(await text(page, '#d-action'), '未割り当て');

  await page.keyboard.press('Enter');
  assert.equal(await text(page, '#d-action'), 'OK');
  assert.match(await text(page, '#hist'), /Enter/);
  assert.match(await text(page, '#env'), /SofaView/);
  assert.equal(page.url(), url('diag.html'), '診断中はどのキーでもページを離れない（Esc/Home/Backspace は 3 回で戻る）');
  await page.close();
});

test('キー診断: Home や Backspace の既定動作（スクロール・戻る）を止める。戻る/ホームを 3 回続けるとハブへ', async () => {
  const page = await open('diag.html');
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  assert.equal(page.url(), url('diag.html'));
  assert.equal(await text(page, '#d-action'), 'BACK');
  await page.waitForTimeout(100);
  await page.keyboard.press('Escape'); // 3 回目（Home, Backspace, Escape）
  await page.waitForURL(env.hubUrl);
  await page.close();
});

test('設定: Enter / ← → で値を切り替え、保存される。Esc でハブへ戻る', async () => {
  const page = await open('settings.html');
  assert.equal((await active(page)).sv, 'zoom.mode');
  assert.match(await text(page, '[data-id="zoom.mode"] .value'), /自動/);

  await page.keyboard.press('Enter'); // auto → off
  await until(async () => (await stored())?.zoom?.mode === 'off', { message: 'saved zoom.mode=off' });
  assert.match(await text(page, '[data-id="zoom.mode"] .value'), /変更しない/);
  assert.equal((await active(page)).sv, 'zoom.mode', '値を変えても同じ項目にフォーカスが残る');

  await page.keyboard.press('ArrowRight'); // off → fixed（固定倍率の項目が現れる）
  await until(async () => (await stored())?.zoom?.mode === 'fixed');
  assert.ok(await page.locator('[data-id="zoom.factor"]').count());
  await page.keyboard.press('ArrowLeft'); // fixed → off
  await until(async () => (await stored())?.zoom?.mode === 'off');
  assert.equal(await page.locator('[data-id="zoom.factor"]').count(), 0);

  await press(page, 'ArrowDown'); // tver.nativeFullscreen
  assert.equal((await active(page)).sv, 'tver.nativeFullscreen');
  await press(page, 'ArrowRight'); // オン → オフ
  await until(async () => (await stored())?.tver?.nativeFullscreen === false);
  assert.equal(await text(page, '[data-id="tver.nativeFullscreen"] .value'), 'オフ');

  await page.keyboard.press('Escape');
  await page.waitForURL(env.hubUrl);
  await page.close();
});

test('設定が TVer に反映される（ヘッダーを隠す → オフにすると検索・設定が現れる）', async () => {
  const tver = await env.ctx.newPage();
  await tver.goto('https://tver.jp/');
  await tverReady(tver);
  const actions = () => tver.evaluate(() => getComputedStyle(document.querySelector('[class*="AppLayout_actions__"]')).display);
  assert.equal(await actions(), 'none');

  const page = await open('settings.html');
  for (let i = 0; i < 20 && (await active(page)).sv !== 'tver.hideHeader'; i++) await press(page, 'ArrowDown', 60);
  assert.equal((await active(page)).sv, 'tver.hideHeader');
  await page.keyboard.press('Enter'); // オン → オフ
  await until(async () => (await stored())?.tver?.hideHeader === false);
  await until(async () => (await actions()) !== 'none', { message: 'TVer header actions visible' });
  await page.close();
  await tver.close();
});

test('設定の初期化: 2 回 Enter で既定値に戻る', async () => {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { holdMs: 1500 } }, r)));
  const page = await open('settings.html');
  for (let i = 0; i < 30 && (await active(page)).sv !== 'reset'; i++) await press(page, 'ArrowDown', 60);
  assert.equal((await active(page)).sv, 'reset');
  await page.keyboard.press('Enter');
  assert.match(await text(page, '[data-id="reset"] .value'), /もう一度/);
  assert.equal((await stored())?.holdMs, 1500, '1 回目ではまだ初期化しない');
  await page.keyboard.press('Enter');
  await until(async () => (await stored()) === undefined, { message: 'settings removed' });
  await page.close();
});

test('キー割り当て: リモコンのボタンを押して追加でき、TVer・YouTube で効く', async () => {
  const page = await open('keys.html');
  assert.equal((await active(page)).sv, 'OK');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  assert.equal((await active(page)).sv, 'HOME');
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.getElementById('capture').getAttribute('data-on') === 'true'), { message: 'capture on' });
  await page.keyboard.press('F9'); // リモコンの「ホーム」ボタン相当
  await until(async () => (await stored())?.bindings?.HOME?.includes('F9'), { message: 'F9 saved' });
  assert.equal(await page.evaluate(() => document.getElementById('capture').getAttribute('data-on')), 'false');
  assert.match(await text(page, '[data-id="HOME"] .value'), /F9/);

  // TVer で F9 → ハブ
  const tver = await env.ctx.newPage();
  await tver.goto('https://tver.jp/');
  await tverReady(tver);
  await tver.waitForTimeout(300);
  await tver.keyboard.press('F9');
  await tver.waitForURL(env.hubUrl);

  // YouTube /tv でも F9 → ハブ
  await env.ctx.route('https://www.youtube.com/tv**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt</title>' }));
  await tver.goto('https://www.youtube.com/tv');
  await tver.waitForTimeout(400);
  await tver.keyboard.press('F9');
  await tver.waitForURL(env.hubUrl);
  await tver.close();

  // Esc で設定ページへ戻る
  await page.keyboard.press('Escape');
  await page.waitForURL(url('settings.html'));
  await page.close();
});

test('キー割り当て: 入力待ちを Esc で取り消せる。「すべて消す」で追加分が消える', async () => {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { bindings: { BACK: ['q'] } } }, r)));
  const page = await open('keys.html');
  await press(page, 'ArrowDown');
  assert.equal((await active(page)).sv, 'BACK');
  assert.match(await text(page, '[data-id="BACK"] .value'), /q/);
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.getElementById('capture').getAttribute('data-on') === 'true'));
  await page.keyboard.press('Escape'); // 取り消し（割り当てない）
  await until(() => page.evaluate(() => document.getElementById('capture').getAttribute('data-on') === 'false'));
  assert.deepEqual((await stored()).bindings, { BACK: ['q'] });
  assert.equal(page.url(), url('keys.html'));

  for (let i = 0; i < 30 && (await active(page)).sv !== 'clear'; i++) await press(page, 'ArrowDown', 60);
  assert.equal((await active(page)).sv, 'clear');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await until(async () => Object.keys((await stored())?.bindings ?? { x: 1 }).length === 0, { message: 'bindings cleared' });
  await page.close();
});
