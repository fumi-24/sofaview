// 画面上のキーボード（common/osk.js）の E2E: 検索ピルからの検索と、入力欄（アンケート）への入力。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, until, press, tverReady } from './helpers.mjs';
import { homeHtml, episodeHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch({ viewport: { width: 1280, height: 720 } });
  await env.ctx.route('https://tver.jp/**', (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname.startsWith('/episodes/') ? episodeHtml({ questionnaire: true }) : homeHtml();
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
});
test.after(async () => {
  await env.close();
});

const oskOpen = (page) => page.evaluate(() => !!document.getElementById('sv-osk'));
const oskText = (page) => page.evaluate(() => document.querySelector('#sv-osk .sv-osk-text')?.textContent);
const focusPos = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    const m = a && a.getAttribute && /^(\d+):(\d+)$/.exec(a.getAttribute('data-pos') || '');
    return m ? { r: +m[1], i: +m[2], label: a.textContent } : null;
  });

/** OSK のキー（表示の文字で指定）まで、十字キーで動いて着く（要素へ直接フォーカスしない）。 */
async function goKey(page, label) {
  const target = await page.evaluate((label) => {
    const b = Array.from(document.querySelectorAll('#sv-osk .sv-osk-key')).find((x) => x.textContent === label);
    const m = b && /^(\d+):(\d+)$/.exec(b.getAttribute('data-pos'));
    return m ? { r: +m[1], i: +m[2] } : null;
  }, label);
  assert.ok(target, `キー「${label}」がある`);
  for (let n = 0; n < 40; n++) {
    const cur = await focusPos(page);
    assert.ok(cur, 'OSK のキーにフォーカスがある');
    if (cur.r === target.r && cur.i === target.i) return;
    const key = cur.r < target.r ? 'ArrowDown' : cur.r > target.r ? 'ArrowUp' : cur.i < target.i ? 'ArrowRight' : 'ArrowLeft';
    await page.keyboard.press(key);
  }
  assert.fail(`キー「${label}」に着けない`);
}

async function openHome() {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await until(() => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body), { message: 'initial focus' });
  return page;
}

/** 検索ピルまで ↑ で上がって、OK でキーボードを開く。 */
async function openSearchOsk(page) {
  for (let n = 0; n < 12; n++) {
    if (await page.evaluate(() => document.activeElement?.hasAttribute('data-sv-search'))) break;
    await press(page, 'ArrowUp', 120);
  }
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-sv-search')), true, '検索ピルにフォーカス');
  await page.keyboard.press('Enter');
  await until(() => oskOpen(page), { message: 'OSK が開く' });
}

test('検索: ピルで OK → キーボード。ひらがな・゛・カナへの切り替えで入力し、検索で結果ページへ（サイトの検索フォーム経由）', async () => {
  const page = await openHome();
  await openSearchOsk(page);
  assert.equal(await page.evaluate(() => document.querySelector('#sv-osk .sv-osk-title').textContent), '検索');
  assert.deepEqual((await focusPos(page)).label, 'あ', '最初のキーにフォーカス');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('sv-osk')).position), 'fixed');
  await goKey(page, 'か');
  await press(page, 'Enter', 60);
  await goKey(page, '゛');
  await press(page, 'Enter', 60);
  assert.equal(await oskText(page), 'が');
  await goKey(page, 'カナ');
  await press(page, 'Enter', 60);
  assert.equal(await page.evaluate(() => document.getElementById('sv-osk').dataset.mode), 'kata');
  assert.equal((await focusPos(page)).label, 'ABC', '切り替えたあとも、切り替えキーにフォーカスが残る（次の種類の名前に変わる）');
  await goKey(page, 'ア');
  await press(page, 'Enter', 60);
  assert.equal(await oskText(page), 'がア');
  await goKey(page, '検索');
  await press(page, 'Enter', 60);
  assert.equal(await oskOpen(page), false, '閉じる');
  await until(() => page.evaluate(() => decodeURIComponent(location.pathname) === '/search/がア'), { message: '結果ページへ' });
  assert.deepEqual(await page.evaluate(() => window.__searches), ['がア'], 'サイトの検索フォームに入力して送られた');
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('検索: 入力欄は左詰め。右端の検索アイコン（最上段のキーから ↑）でも検索できる', async () => {
  const page = await openHome();
  await openSearchOsk(page);
  await page.keyboard.type('ab');
  const g = await page.evaluate(() => {
    const f = document.querySelector('#sv-osk .sv-osk-field').getBoundingClientRect();
    const t = document.querySelector('#sv-osk .sv-osk-text').getBoundingClientRect();
    const i = document.querySelector('#sv-osk .sv-osk-icon').getBoundingClientRect();
    return { textGap: t.left - f.left, iconGap: f.right - i.right, iconW: i.width };
  });
  assert.ok(g.textGap < 40, '文字は左詰め: ' + g.textGap);
  assert.ok(g.iconGap < 16 && g.iconW > 20, '検索アイコンは右端: ' + JSON.stringify(g));
  assert.equal((await focusPos(page)).label, 'あ', '最初のフォーカスはアイコンではない');
  await press(page, 'ArrowUp', 80);
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('sv-osk-icon')), true, '↑ でアイコンへ');
  await press(page, 'ArrowDown', 80);
  assert.equal((await focusPos(page)).r, 1, '↓ で戻る');
  await press(page, 'ArrowUp', 80);
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => decodeURIComponent(location.pathname) === '/search/ab'), { message: 'アイコンで検索' });
  assert.equal(await oskOpen(page), false);
  await page.close();
});

test('検索: 戻る（Esc）で取り消し。検索しない・フォーカスはピルに戻る。何も入れずに検索しても移動しない', async () => {
  const page = await openHome();
  await openSearchOsk(page);
  await goKey(page, 'あ');
  await press(page, 'Enter', 60);
  await press(page, 'Escape', 150);
  assert.equal(await oskOpen(page), false);
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-sv-search')), true, 'ピルに戻る');
  assert.equal(await page.evaluate(() => (window.__searches || []).length), 0);
  await page.keyboard.press('Enter');
  await until(() => oskOpen(page));
  assert.equal(await oskText(page), '', '開き直したら空');
  await goKey(page, '検索');
  await press(page, 'Enter', 400);
  assert.equal(await oskOpen(page), false);
  assert.equal(await page.evaluate(() => location.pathname), '/', '空のまま検索しても移動しない');
  await page.close();
});

test('検索: 物理キーボード（開発用）でも入る。Backspace は 1 文字消し、空なら閉じる。キーは背景のページへ漏れない', async () => {
  const page = await openHome();
  const before = await page.evaluate(() => scrollY);
  await openSearchOsk(page);
  await page.keyboard.type('abc');
  assert.equal(await oskText(page), 'abc');
  await page.keyboard.press('Backspace');
  assert.equal(await oskText(page), 'ab');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  assert.equal(await oskText(page), '');
  assert.equal(await oskOpen(page), true, '消している間は開いたまま');
  await page.keyboard.press('Backspace');
  assert.equal(await oskOpen(page), false, '空で Backspace は閉じる');
  assert.equal(await page.evaluate(() => location.pathname), '/', 'Backspace が「戻る」としてページ遷移しない');
  assert.equal(await page.evaluate(() => scrollY), before);
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('入力欄（アンケート）: OK で数字キー。入れた数字はその場で欄に入る。Esc で閉じて欄に戻り、↓ で欄の外へ出られる', async () => {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto('https://tver.jp/episodes/quest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.activeElement?.name === 'birthYear'), { message: 'アンケートの欄にフォーカス' });
  await press(page, 'Enter', 150); // OK: キーボードを開く（送信はしない）
  assert.equal(await oskOpen(page), true);
  assert.equal(await page.evaluate(() => document.getElementById('sv-osk').dataset.mode), 'num', '数字だけの欄は数字キー');
  assert.equal(await page.evaluate(() => !!document.querySelector('#sv-osk [data-fn="mode"]')), false, '種類の切り替えはない');
  for (const d of ['1', '9', '9', '5']) {
    await goKey(page, d);
    await press(page, 'Enter', 40);
  }
  assert.equal(await page.evaluate(() => document.querySelector('input[name="birthYear"]').value), '1995', '入れた数字はその場で欄に入る');
  await goKey(page, '削除');
  await press(page, 'Enter', 40);
  await page.keyboard.type('0'); // 物理キーボード
  assert.equal(await page.evaluate(() => document.querySelector('input[name="birthYear"]').value), '1990');
  await page.keyboard.type('x'); // 数字欄に文字は入らない
  assert.equal(await oskText(page), '1990');
  await goKey(page, '完了');
  await press(page, 'Enter', 150);
  assert.equal(await oskOpen(page), false);
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'birthYear', '欄にフォーカスが戻る');
  assert.equal(await page.evaluate(() => !!document.querySelector('[role="dialog"] form')), true, 'OK でアンケートを送信しない');
  // 欄の外へ: ↓（単一行の欄は上下に動けるので、そのまま次の要素へ）
  await press(page, 'ArrowDown', 200);
  assert.notEqual(await page.evaluate(() => document.activeElement?.name), 'birthYear', '↓ で欄から出られる');
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), true, 'モーダルの中にとどまる');
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('入力欄: 文字がある間の ← → は、これまでどおりキャレットの移動（OSK を使わず物理キーボードで打つ人の邪魔をしない）', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/episodes/quest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.activeElement?.name === 'birthYear'));
  await page.keyboard.type('1990');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'birthYear', '文字の中の ← はキャレット');
  assert.equal(await page.evaluate(() => document.activeElement.selectionStart), 3);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(() => document.activeElement.selectionStart), 2);
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'birthYear');
  await page.close();
});
