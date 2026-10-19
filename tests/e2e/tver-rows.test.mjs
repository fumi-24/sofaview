// 横スクロールの行（棚）の位置の規則（YouTube /tv に合わせる。SPEC 9.4c）の E2E。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, settleScroll, tverReady } from './helpers.mjs';
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

async function openHome() {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await until(async () => (await active(page)) !== null, { message: 'initial focus' });
  return page;
}

const id = async (page) => (await active(page))?.sv;

/** フォーカス中のカードの行: 見出しの上端・カードの左端・行の scrollLeft・先頭／2 枚目のカードの未スクロール位置。 */
const geom = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const list = a.closest('[class*="Carousel_list__"]');
    const section = list.closest('[class*="Carousel_carousel__"]');
    const caption = section.previousElementSibling;
    const items = Array.from(list.children);
    const base = list.getBoundingClientRect().left - list.scrollLeft;
    return {
      captionTop: Math.round(caption.getBoundingClientRect().top),
      cardLeft: Math.round(a.getBoundingClientRect().left),
      scrollLeft: Math.round(list.scrollLeft),
      first: Math.round(items[0].getBoundingClientRect().left - base + 0),
      second: Math.round(items[1].getBoundingClientRect().left - base),
      vh: window.innerHeight,
    };
  });

test('フォーカス中の行の見出しは、画面の上から 15% に固定される（行を移るたびに行のほうが動く）', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await settleScroll(page);
  let g = await geom(page);
  assert.ok(Math.abs(g.captionTop - g.vh * 0.15) <= 2, `1 行目の見出し ${g.captionTop} ≒ ${g.vh * 0.15}`);
  await press(page, 'ArrowDown');
  await settleScroll(page);
  g = await geom(page);
  assert.ok(Math.abs(g.captionTop - g.vh * 0.15) <= 2, `2 行目の見出し ${g.captionTop} ≒ ${g.vh * 0.15}`);
  await press(page, 'ArrowUp');
  await settleScroll(page);
  g = await geom(page);
  assert.ok(Math.abs(g.captionTop - g.vh * 0.15) <= 2, `1 行目へ戻っても ${g.captionTop} ≒ ${g.vh * 0.15}`);
  await page.close();
});

test('行の中: 先頭は 1 枚目、2 枚目以降は 2 枚目の位置にフォーカスを保つ', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await settleScroll(page);
  const g0 = await geom(page);
  assert.equal(g0.scrollLeft, 0);
  const slot1 = g0.cardLeft;
  await press(page, 'ArrowRight');
  const g1 = await geom(page);
  assert.equal(g1.scrollLeft, 0, '2 枚目へは動かない');
  const slot2 = g1.cardLeft;
  assert.ok(slot2 > slot1);
  for (let i = 2; i <= 4; i++) {
    await press(page, 'ArrowRight', 150);
    const g = await geom(page);
    assert.ok(Math.abs(g.cardLeft - slot2) <= 1, `${i + 1} 枚目 ${g.cardLeft} は 2 枚目の位置 ${slot2}`);
  }
  await page.close();
});

test('別の行へ上下で入ると、その行で最後にいたカードへ。戻ると元の行の位置も保たれる', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  for (let i = 0; i < 3; i++) await press(page, 'ArrowRight', 150);
  const first = await id(page);
  await press(page, 'ArrowDown');
  assert.match(await id(page), /^epv1$/, '初めての行は先頭');
  await press(page, 'ArrowUp');
  assert.equal(await id(page), first, '元の行の最後にいたカード');
  await settleScroll(page);
  const g = await geom(page);
  assert.ok(g.scrollLeft > 0, '元の行の横位置も保たれる');
  await page.close();
});
