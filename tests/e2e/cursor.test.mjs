// マウスカーソルの自動非表示（common/cursor.js）: 動かすと出て、3 秒動かさないと消える。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, tverReady } from './helpers.mjs';
import { homeHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch({ viewport: { width: 800, height: 600 } });
  await env.ctx.route('https://tver.jp/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homeHtml() }));
});
test.after(async () => {
  await env.close();
});

const cursor = (page) => page.evaluate(() => getComputedStyle(document.body).cursor);

async function checkCursor(page) {
  assert.equal(await cursor(page), 'none', '読み込み直後は隠れている');
  await page.mouse.move(100, 100);
  await page.mouse.move(120, 130);
  await page.waitForTimeout(150);
  assert.notEqual(await cursor(page), 'none', 'マウスを動かすと出る');
  await page.waitForTimeout(2000);
  assert.notEqual(await cursor(page), 'none', '2 秒ではまだ出ている');
  await page.mouse.move(140, 150); // 動かし直すと、3 秒の数え直し
  await page.waitForTimeout(2000);
  assert.notEqual(await cursor(page), 'none', '動かし直して 2 秒（最初の移動からは 4 秒）でもまだ出ている');
  await page.waitForTimeout(1500);
  assert.equal(await cursor(page), 'none', '最後に動かしてから 3 秒で消える');
  await page.mouse.move(140, 150); // 同じ位置への移動イベントは「動いた」にしない
  await page.waitForTimeout(150);
  assert.equal(await cursor(page), 'none', '位置が変わらなければ出ない');
}

test('TVer: マウスカーソルは、動かすと出て、3 秒動かさないと消える', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await checkCursor(page);
  await page.close();
});

test('ハブ（拡張ページ）でも同じ', async () => {
  const page = await env.ctx.newPage();
  await page.goto(env.hubUrl);
  await page.waitForTimeout(500);
  await checkCursor(page);
  await page.close();
});
