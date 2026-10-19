// ビルボードの橋（sites/tver/billboard-main.js）の E2E。再現ページに「偽の React fiber + keen 風インスタンス」を持たせる（fixtures の o.bridge）。
// 実サイトで起きた不具合: ← が前向きに一周する（選択ボタンの click は前向きにしか回らない）／連打・押しっぱなしで走り続ける／フォーカスのたびに 100ms 超のスタイル再計算。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, tverReady } from './helpers.mjs';
import { homeKeenHtml } from '../fixtures/tver.mjs';

let env;
let opts = { bridge: true };
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homeKeenHtml(opts) }),
  );
});
test.after(async () => {
  await env.close();
});

async function openHome(o = { bridge: true }) {
  opts = o;
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await until(async () => (await active(page)) !== null, { message: 'initial focus' });
  return page;
}
const id = async (page) => (await active(page))?.sv;
const log = (page) => page.evaluate(() => ({ moves: window.__bbMoves.slice(), clicks: window.__bbClicks.slice(), pause: window.__bbPause.slice() }));

test('橋: → ← は moveToIdx（最短）で動かし、選択ボタンは click しない。端でループする', async () => {
  const page = await openHome();
  assert.equal(await id(page), 's0');
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowLeft', 100);
  await press(page, 'ArrowLeft', 100);
  await press(page, 'ArrowLeft', 100); // 先頭の ← は末尾へ（ループ）
  assert.equal(await id(page), 's4');
  await press(page, 'ArrowRight', 100); // 末尾の → は先頭へ
  assert.equal(await id(page), 's0');
  const l = await log(page);
  // 1 枚ずつの移動（初期フォーカスの go は、すでにそこにいるので冪等 = 何もしない）
  assert.deepEqual(l.moves, [1, 2, 1, 0, 4, 0], `moveToIdx の列: ${l.moves}`);
  assert.deepEqual(l.clicks, [], '選択ボタンは click しない（前向きにしか回らず、回転中は捨てられる）');
  await page.close();
});

test('橋: 連打（60ms 間隔で 12 回）しても、最後のフォーカス・表示・moveToIdx の目標が一致する', async () => {
  const page = await openHome();
  for (let i = 0; i < 12; i++) await press(page, 'ArrowRight', 60);
  assert.equal(await id(page), 's2'); // 12 回進むと 5 枚のループで 2
  const l = await log(page);
  assert.equal(l.moves[l.moves.length - 1], 2);
  assert.deepEqual(l.clicks, []);
  await page.close();
});

test('橋: ビルボードにフォーカスがある間は自動送りを止め、出たら再開する', async () => {
  const page = await openHome();
  await until(async () => (await log(page)).pause.includes('stop'), { message: 'stop on focus' });
  await press(page, 'ArrowDown', 100);
  await until(async () => (await log(page)).pause.includes('restart'), { timeout: 4000, message: 'restart after leaving' });
  await press(page, 'ArrowUp', 100);
  await until(async () => (await log(page)).pause.filter((x) => x === 'stop').length >= 2, { message: 'stop again on return' });
  await page.close();
});

test('橋: 押しっぱなし（リピート）は間引かれ、離したあとに走り続けない', async () => {
  const page = await openHome();
  const t0 = Date.now();
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 40; i++) {
    await page.keyboard.down('ArrowRight'); // 2 回目以降は repeat=true
    await page.waitForTimeout(33);
  }
  await page.keyboard.up('ArrowRight');
  const held = Date.now() - t0;
  const l = await log(page);
  const steps = l.moves.length;
  assert.ok(steps >= 1 && steps <= Math.ceil(held / 150) + 1, `押しっぱなし ${held}ms で ${steps} 枚（間引かれていない）`);
  await page.waitForTimeout(600);
  assert.equal((await log(page)).moves.length, l.moves.length, '離したあとに動き続けない');
  await page.close();
});

test('橋が無い（サイトの内部が変わった）ときは、選択ボタンの click に戻る', async () => {
  const page = await openHome({ bridge: false });
  await press(page, 'ArrowRight', 200);
  await press(page, 'ArrowRight', 200);
  assert.equal(await id(page), 's2');
  const l = await log(page);
  assert.deepEqual(l.moves, []);
  assert.ok(l.clicks.includes(2), `選択ボタンの click: ${l.clicks}`);
  await page.close();
});
