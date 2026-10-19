// SPA（クライアント遷移・描画遅延）での初期フォーカス・遷移・戻るの E2E。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, tverReady } from './helpers.mjs';
import { spaHtml } from '../fixtures/tver.mjs';

let outsideMain = false;

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: spaHtml(900, { outsideMain }) }),
  );
});
test.after(async () => {
  await env.close();
});

const id = async (page) => (await active(page))?.sv;

async function open(path = '/') {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp' + path);
  await tverReady(page);
  return page;
}

test('描画が遅れても、初期フォーカスはレールではなくコンテンツ（ビルボード）に付く', async () => {
  const page = await open('/');
  // 描画前（main が空）の間はレールにフォーカスしない
  assert.equal(await id(page), undefined);
  await until(async () => (await id(page)) === 'b1', { timeout: 8000, message: 'focus on billboard after render' });
  await page.close();
});

test('main の外の除外されないリンクがあっても、描画前の初期フォーカスにならない（描画後にコンテンツへ）', async () => {
  outsideMain = true;
  try {
    const page = await open('/');
    assert.equal(await id(page), undefined, '描画前は何にもフォーカスしない（パンくず・補助リンクを選ばない）');
    await until(async () => (await id(page)) === 'b1', { timeout: 8000, message: 'focus on billboard after render' });
    await page.close();
  } finally {
    outsideMain = false;
  }
});

test('操作を始めたら、遅れて描画されたコンテンツにフォーカスを奪われない', async () => {
  const page = await open('/');
  await press(page, 'ArrowLeft', 50); // まだコンテンツがない状態で操作 → フォーカス対象はレールのみ
  await press(page, 'ArrowDown', 50);
  await page.waitForTimeout(1800); // 描画完了を待つ
  assert.match((await active(page))?.sv ?? '', /^rail-/);
  await page.close();
});

test('レールで Enter → SPA 遷移 → フォーカスはレールに残り、→ で新しいページの最初の要素に入る', async () => {
  const page = await open('/');
  await until(async () => (await id(page)) === 'b1', { timeout: 8000 });
  await press(page, 'ArrowLeft');
  assert.equal(await id(page), 'rail-home');
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'rail-search');
  await page.keyboard.press('Enter'); // クリック → pushState('/search')
  await page.waitForFunction(() => location.pathname === '/search');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svPage), 'search');
  await page.waitForTimeout(2200); // 描画が終わっても、カーソルは勝手に動かない
  assert.equal(await id(page), 'rail-search');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'purpose-0', '→ で、そのページの最初の要素');
  await page.close();
});

test('遷移直後にレールで上下した場合は、新ページのコンテンツにフォーカスを奪われない', async () => {
  const page = await open('/');
  await until(async () => (await id(page)) === 'b1', { timeout: 8000 });
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'rail-search');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/search');
  await press(page, 'ArrowDown', 50); // 描画前に操作 → レールの次の項目
  await page.waitForTimeout(1800);
  assert.equal(await id(page), 'rail-live');
  await page.close();
});

test('SPA の「戻る」（popstate）で前のページへ戻り、最後にいた位置にフォーカスが復元される', async () => {
  const page = await open('/');
  await until(async () => (await id(page)) === 'b1', { timeout: 8000 });
  await press(page, 'ArrowDown');
  await press(page, 'ArrowRight');
  const before = await id(page);
  assert.match(before, /^epd\d$/);
  await press(page, 'ArrowLeft');
  await press(page, 'ArrowLeft'); // 1 行目の先頭 → レール
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'rail-search');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/search');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape'); // 戻る
  await page.waitForFunction(() => location.pathname === '/');
  await until(async () => (await id(page)) === 'rail-search', { timeout: 8000, message: 'restored last focus of "/"' });
  await page.close();
});
