// ビルボード（注目作品。keen-slider の自動で回るスライダー）の E2E。実サイトの構造を再現したページで確かめる。
// 実際に起きた不具合: リングが画像に隠れて見えない／← → が効かない（見えないスライドへ飛ぶ）／自動送りでフォーカスが画面外へ消える。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, tverReady } from './helpers.mjs';
import { homeKeenHtml } from '../fixtures/tver.mjs';

let env;
let autoplayMs = 0;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homeKeenHtml({ autoplayMs }) }),
  );
});
test.after(async () => {
  await env.close();
});

async function openHome(ms = 0) {
  autoplayMs = ms;
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await until(async () => (await active(page)) !== null, { message: 'initial focus' });
  return page;
}

const id = async (page) => (await active(page))?.sv;
/** 現在のスライド（ページ送りボタン）と、フォーカス中の要素の位置（スライダーの左端との差）。 */
const state = (page) =>
  page.evaluate(() => {
    const act = [...document.querySelectorAll('[class*="BillboardList_selectorItem__"]')].findIndex((b) => /Active/.test(b.className));
    const left = document.querySelector('ul.keen-slider').getBoundingClientRect().left;
    const a = document.activeElement;
    return { act, id: a.getAttribute('data-id'), dx: Math.round(a.getBoundingClientRect().left - left) };
  });
const settled = async (page, want, message) =>
  until(async () => {
    const s = await state(page);
    return s.id === 's' + want && s.act === want && Math.abs(s.dx) <= 2;
  }, { timeout: 4000, message });

test('ビルボード: 初期フォーカスは表示中のスライド', async () => {
  const page = await openHome();
  assert.equal(await id(page), 's0');
  await settled(page, 0, 'slide 0 active and in place');
  await page.close();
});

test('ビルボード: フォーカスのリングが画像の上に見える（画像に隠れない）', async () => {
  const page = await openHome();
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    const r = document.activeElement.getBoundingClientRect();
    return { x: r.left, y: r.top + r.height / 2, dpr: devicePixelRatio };
  });
  const png = (await page.screenshot()).toString('base64');
  const [ring, inside] = await page.evaluate(
    async ({ png, pts }) => {
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      return pts.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3));
    },
    { png, pts: [[(g.x + 2) * g.dpr, g.y * g.dpr], [(g.x + 40) * g.dpr, g.y * g.dpr]] },
  );
  const bright = (p) => (p[0] + p[1] + p[2]) / 3;
  assert.ok(bright(ring) > 200, `リングの位置が明るい白（実際: ${ring}）`);
  assert.ok(bright(inside) < 160, `画像の内側は画像の色（実際: ${inside}）`);
  await page.close();
});

test('ビルボード: ← → でスライドを 1 枚ずつ切り替え、表示位置に回る。端でループする', async () => {
  const page = await openHome();
  for (let i = 1; i <= 4; i++) {
    await press(page, 'ArrowRight', 150);
    await settled(page, i, `slide ${i}`);
  }
  await press(page, 'ArrowRight', 300); // 末尾の → は先頭へ（ループ）
  await settled(page, 0, 'loop to the first slide');
  await press(page, 'ArrowLeft', 300); // 先頭の ← は末尾へ（ループ）
  await settled(page, 4, 'loop to the last slide');
  for (let i = 3; i >= 0; i--) {
    await press(page, 'ArrowLeft', 150);
    await settled(page, i, `back to slide ${i}`);
  }
  await page.close();
});

test('ビルボード: 連打（← → を 60ms 間隔で 12 回）しても、最後はフォーカスと表示中のスライドが一致する', async () => {
  const page = await openHome();
  for (let i = 0; i < 12; i++) await press(page, 'ArrowRight', 60);
  // 12 回進むと 5 枚のループで 2 番目（添字 2）
  await settled(page, 2, 'slide 2 after 12 rapid presses');
  for (let i = 0; i < 7; i++) await press(page, 'ArrowLeft', 60);
  await settled(page, 0, 'slide 0 after 7 rapid presses back');
  await page.close();
});

test('ビルボード: 自動で次のスライドに回っても、フォーカスは表示中のスライドを追う（画面外へ消えない）', async () => {
  const page = await openHome(900);
  let worst = 0;
  let since = null;
  const acts = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 4200) {
    const s = await state(page);
    acts.add(s.act);
    const following = s.id === 's' + s.act;
    if (!following) since ??= Date.now();
    else since = null;
    if (since) worst = Math.max(worst, Date.now() - since);
    await page.waitForTimeout(100);
  }
  assert.ok(worst < 1000, `フォーカスが表示中のスライドと違う状態が長く続いた（最長 ${worst}ms）`);
  assert.ok(acts.size >= 3, `自動送りが進んでいる（見たスライド: ${[...acts]}）`);
  await page.close();
});

test('ビルボード: 手動で選んだ直後に自動送りが進んでも、選んだスライドへ戻す', async () => {
  const page = await openHome(900);
  await until(async () => { const s = await state(page); return s.id === 's' + s.act && Math.abs(s.dx) <= 2 && s.act <= 2; }, { timeout: 4000 });
  const before = (await state(page)).act;
  await press(page, 'ArrowRight', 100);
  const want = before + 1;
  await until(async () => { const s = await state(page); return s.id === 's' + want && s.act === want && Math.abs(s.dx) <= 2; }, { timeout: 2500, message: `slide ${want} stays after autoplay advances` });
  await page.close();
});

test('ビルボード: ↑ で戻ってきたとき、フォーカスしたスライドが表示位置に回る', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown'); // 1 行目のカード（バナー行の除外されるリンクは飛ばす）
  assert.match(await id(page), /^epd\d+$/);
  for (let i = 0; i < 3; i++) await press(page, 'ArrowRight', 150);
  await press(page, 'ArrowUp');
  const s0 = await state(page);
  assert.match(s0.id, /^s\d$/, 'ビルボードに戻る');
  await until(async () => {
    const s = await state(page);
    return s.id === 's' + s.act && Math.abs(s.dx) <= 2;
  }, { timeout: 4000, message: 'focused slide is the active one in place' });
  await page.close();
});

test('ビルボードの下のバナー: 別サブドメイン・新しいタブで開くリンクにはフォーカスしない', async () => {
  const page = await openHome();
  const seen = new Set();
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp']) {
    await press(page, k, 150);
    seen.add(await id(page));
  }
  for (const bad of ['sub-banner', 'blank-link']) assert.ok(!seen.has(bad), `${bad} にフォーカスした: ${[...seen]}`);
  await page.close();
});
