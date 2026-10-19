// TVer 標準の詳細ポップアップ（エピソード一覧のカード）をフォーカスで出す E2E。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, tverReady } from './helpers.mjs';
import { seriesHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: seriesHtml({ count: 5 }) }),
  );
});
test.after(async () => {
  await env.close();
});

const POPUP = '[class*="SeasonEpisodeListItem_popup__"]';

async function open() {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/series/srtest');
  await tverReady(page);
  await until(async () => (await active(page))?.sv === 'eps1', { message: 'initial focus on the first episode' });
  return page;
}

/** ポップアップの状態: 数、持ち主（host の番号）、不透明度、リングの太さ。 */
const popupState = (page) =>
  page.evaluate((sel) => {
    const ps = document.querySelectorAll(sel);
    const p = ps[0];
    if (!p) return { count: 0 };
    const box = p.firstElementChild;
    const a = document.activeElement;
    return {
      count: ps.length,
      owner: p.closest('[data-host]')?.getAttribute('data-host'),
      activeHost: a && a.closest('[data-host]') ? a.closest('[data-host]').getAttribute('data-host') : null,
      opacity: Number(getComputedStyle(p).opacity),
      ring: getComputedStyle(box).outlineWidth,
      ringStyle: getComputedStyle(box).outlineStyle,
      cardOutline: getComputedStyle(a).outlineStyle,
      cardTransform: getComputedStyle(a).transform,
    };
  }, POPUP);

test('フォーカスしたカードに、TVer 標準の詳細ポップアップが出る（リングはポップアップに付く）', async () => {
  const page = await open();
  const st = await until(async () => {
    const s = await popupState(page);
    return s.count === 1 && s.opacity === 1 ? s : null;
  }, { message: 'popup visible' });
  assert.equal(st.owner, st.activeHost);
  assert.equal(st.ring, '6px', 'リングの太さは 0.375u（720px で 6px。/tv と同じ）');
  assert.equal(st.ringStyle, 'solid');
  assert.equal(st.cardOutline, 'none', 'カード自身のリングは消し、ポップアップに付ける');
  assert.equal(st.cardTransform, 'none', 'ポップアップを出している間は拡大しない');
  await page.close();
});

test('↑↓ でカードを移ると、ポップアップも付いて移る（常に 1 つ）', async () => {
  const page = await open();
  for (const [key, want] of [['ArrowDown', 'eps2'], ['ArrowDown', 'eps3'], ['ArrowUp', 'eps2'], ['ArrowUp', 'eps1']]) {
    await press(page, key, 300);
    assert.equal((await active(page)).sv, want);
    const st = await popupState(page);
    assert.equal(st.count, 1, `${want}: ポップアップは 1 つだけ`);
    assert.equal(st.owner, st.activeHost, `${want}: ポップアップはフォーカス中のカードのもの`);
  }
  await page.close();
});

test('ポップアップの中のリンク・ボタンへはフォーカスしない（十字キーでも、フォーカスは常にカード）', async () => {
  const page = await open();
  for (const key of ['ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    await press(page, key, 150);
    const a = await active(page);
    assert.ok(!a || !a.sv.startsWith('pop-'), `ポップアップの中 (${a?.sv}) にフォーカスしない`);
  }
  await page.close();
});

test('レールへ出るとポップアップは消える', async () => {
  const page = await open();
  await press(page, 'ArrowLeft', 300);
  assert.match((await active(page)).sv, /^rail-/);
  assert.equal((await popupState(page)).count, 0);
  await page.close();
});

test('Enter はカードのリンク先（エピソード）へ移る。ポップアップの中ではなくカードに効く', async () => {
  const page = await open();
  await press(page, 'ArrowDown', 300);
  assert.equal((await active(page)).href, '/episodes/eps2');
  await page.keyboard.press('Enter');
  await until(() => page.url().endsWith('/episodes/eps2'), { message: 'navigated to the episode' });
  await page.close();
});
