// TVer の構造を再現したページでの E2E（ネットワーク不要）: スキン・ズーム・空間ナビ・遷移・フォーカス復元。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, press, settleScroll, tverReady } from './helpers.mjs';
import { homeHtml, searchHtml, episodeHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) => {
    const u = new URL(route.request().url());
    let body;
    if (u.pathname === '/') body = homeHtml();
    else if (u.pathname === '/search') body = searchHtml();
    else if (u.pathname.startsWith('/episodes/')) body = episodeHtml();
    else body = '<!doctype html><title>other</title><main><a href="/" data-id="home-link">home</a></main>';
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
});
test.after(async () => {
  await env.close();
});

async function openHome() {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  // 初期フォーカス（DOM が落ち着くまで待つ）
  await until(async () => (await active(page)) !== null, { message: 'initial focus' });
  return page;
}

const id = async (page) => (await active(page))?.sv;

test('スキン: ダークテーマ・画面倍率・非表示・マウスカーソル', async () => {
  const page = await openHome();
  const info = await page.evaluate(() => {
    const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el) : null; };
    return {
      cls: document.documentElement.className,
      stored: localStorage.getItem('appearanceMode'),
      appBanner: cs('[class*="AppBanner_"]').display,
      carouselCtl: cs('[class*="Carousel_control"]').display,
      hamburger: cs('[class*="AppLayout_icon__"]').display,
      actions: cs('[class*="AppLayout_actions__"]').display,
      logo: cs('[class*="AppLayout_homeLink__"]').display,
      cursor: getComputedStyle(document.body).cursor,
      focusColor: getComputedStyle(document.documentElement).getPropertyValue('--color-state-focused').trim(),
    };
  });
  assert.match(info.cls, /\bdark\b/);
  assert.match(info.cls, /\bsv-tv\b/);
  assert.equal(info.stored, 'dark');
  assert.equal(info.appBanner, 'none');
  assert.equal(info.carouselCtl, 'none');
  assert.equal(info.hamburger, 'none');
  assert.equal(info.actions, 'none');
  assert.notEqual(info.logo, 'none', 'ロゴは残す');
  assert.equal(info.cursor, 'none');
  assert.equal(info.focusColor, 'transparent', 'サイト標準のフォーカスリングは透明化');

  // 画面倍率: 1080p → CSS ビューポート高さ 720（Service Worker が chrome.tabs.setZoom で適用）
  await until(async () => (await page.evaluate(() => window.innerHeight)) === 720, { message: 'zoom applied' });
  assert.equal(await page.evaluate(() => Math.round(window.devicePixelRatio * 100)), 150);
  await page.close();
});

test('初期フォーカスは画面内で最も左上のビルボード（DOM 先頭の複製ではない）', async () => {
  const page = await openHome();
  assert.equal(await id(page), 'b1');
  await page.close();
});

test('空間ナビ: 行内の左右・行間の上下（別の行へは、その行で最後にいたカード／初めてなら先頭へ）', async () => {
  const page = await openHome();
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'b2');
  await press(page, 'ArrowLeft');
  assert.equal(await id(page), 'b1');

  await press(page, 'ArrowDown'); // ビルボード → 1 行目
  assert.match(await id(page), /^epd\d$/);
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'epd3');

  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'epv1', '初めての行は先頭のカード（列は引き継がない。/tv と同じ）');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'epv2');
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'srs1');
  await press(page, 'ArrowUp');
  assert.equal(await id(page), 'epv2', '行は最後にいたカードを覚えている');
  await press(page, 'ArrowUp');
  assert.equal(await id(page), 'epd3', '1 行目も最後にいたカードへ');
  await page.close();
});

test('空間ナビ: 端では移動しない（ラップしない）', async () => {
  const page = await openHome();
  await press(page, 'ArrowUp'); // ビルボードの上は「検索」のピル（/tv と同じ。上部バー）
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-sv-search')), true, '上は検索ピル');
  await press(page, 'ArrowUp'); // その上は何もない（ヘッダーは対象外）
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-sv-search')), true);
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'b1', '下へ戻るとビルボード');
  await press(page, 'ArrowRight');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'b3');
  await press(page, 'ArrowRight'); // 右端（複製 clone は画面の外だが候補になり得る）
  const after = await id(page);
  assert.ok(['b3', 'clone'].includes(after), after);
  await page.close();
});

test('横スクロール行: 右へ進むとフォーカス要素が画面内に入るようにスクロールされる', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  for (let i = 0; i < 7; i++) await press(page, 'ArrowRight', 120);
  await settleScroll(page);
  await page.waitForTimeout(400);
  const vis = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    const list = el.closest('ul');
    return { left: r.left, right: r.right, vw: window.innerWidth, scrollLeft: list.scrollLeft, sv: el.getAttribute('data-id') };
  });
  assert.ok(vis.scrollLeft > 200, `carousel scrolled: ${vis.scrollLeft}`);
  assert.ok(vis.left >= 0 && vis.right <= vis.vw, `focused card visible: ${vis.left}..${vis.right} / ${vis.vw}`);
  assert.equal(vis.sv, 'epd8');
  await page.close();
});

test('縦スクロール: 下の行へ進んでもフォーカス要素が画面内に見える。固定ヘッダーとレールは動かない', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  assert.match(await id(page), /^srs\d$/);
  await settleScroll(page);
  const r = await page.evaluate(() => {
    const el = document.activeElement.getBoundingClientRect();
    const nav = document.querySelector('nav').getBoundingClientRect();
    return { top: el.top, bottom: el.bottom, vh: window.innerHeight, scrollY: window.scrollY, navTop: nav.top };
  });
  assert.ok(r.scrollY > 0, 'ページがスクロールした');
  assert.ok(r.top >= 0 && r.bottom <= r.vh, `visible: ${r.top}..${r.bottom} / ${r.vh}`);
  assert.ok(Math.abs(r.navTop) < 1, 'レール（sticky）は動かない');
  await page.close();
});

test('領域間の移動: 左端で ← → レール、レールで → → 直前のコンテンツへ。レールは上下に移動', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown'); // epv1（2 行目の左端）
  assert.equal(await id(page), 'epv1');
  await press(page, 'ArrowLeft');
  const rail = await active(page);
  assert.equal(rail.sv, 'rail-home', 'レールでは現在ページ（ホーム）が優先');
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'rail-search');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  assert.equal(await id(page), 'rail-drama');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'epv1', '直前のコンテンツ位置へ戻る');
  await page.close();
});

test('ビルボードの左端で ←: 横にスクロールした別の行の（見えなくなった）カードではなく、レールへ出る', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown'); // 1 行目
  for (let i = 0; i < 5; i++) await press(page, 'ArrowRight', 150); // 1 行目を右へスクロール（左側のカードが画面外になる）
  await press(page, 'ArrowUp'); // ビルボードへ
  for (let i = 0; i < 4 && (await id(page)) !== 'b1'; i++) await press(page, 'ArrowLeft', 200);
  assert.equal(await id(page), 'b1');
  await press(page, 'ArrowLeft');
  assert.match(await id(page), /^rail-/, `レールへ出る（実際: ${await id(page)}）`);
  await page.close();
});

test('左レールは普段はアイコンだけ（104px）、フォーカスが来たら 340px に広がって内容を 252px 押し出し、離れたら戻る（/tv と同じ）', async () => {
  const page = await openHome();
  const geo = () => page.evaluate(() => ({ nav: Math.round(document.querySelector('nav').getBoundingClientRect().width), main: Math.round(document.querySelector('main').getBoundingClientRect().left) }));
  await until(async () => (await geo()).nav === 104, { message: 'collapsed while focus is in the content' });
  const before = await geo();
  assert.equal(before.main, 104, '内容の左端は折りたたみレールの幅（/tv は 6.5u = 104px）');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowLeft'); // 1 行目の先頭 → レール
  assert.match(await id(page), /^rail-/);
  await until(async () => (await geo()).nav === 340, { message: 'expanded while focus is in the rail' });
  assert.equal((await geo()).main, before.main + 252, '内容は 252px 押し出される（重ならない）');
  // 折りたたみ中はアイコンだけ・展開中は文字も見える
  const labels = await page.evaluate(() => getComputedStyle(document.querySelector('nav li > a > span')).display);
  assert.notEqual(labels, 'none', '展開中は文字が見える');
  await press(page, 'ArrowRight');
  await until(async () => (await geo()).nav === 104, { message: 'collapsed again' });
  assert.equal((await geo()).main, before.main, '戻る');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('nav li > a > span')).display), 'none', '折りたたみ中は文字を隠す（アイコンだけ）');
  await page.close();
});

test('左レール: 素早く出入りしても、最後はフォーカスの位置に合った幅になる（サイトの状態は触らない）', async () => {
  const page = await openHome();
  const navW = () => page.evaluate(() => Math.round(document.querySelector('nav').getBoundingClientRect().width));
  await press(page, 'ArrowDown', 100);
  for (let i = 0; i < 3; i++) {
    await press(page, 'ArrowLeft', 30);
    await press(page, 'ArrowRight', 30);
  }
  await press(page, 'ArrowLeft', 30);
  await until(async () => (await navW()) === 340, { timeout: 4000, message: 'expanded because focus ended in the rail' });
  await press(page, 'ArrowRight', 30);
  await until(async () => (await navW()) === 104, { timeout: 4000, message: 'collapsed because focus ended in the content' });
  await page.close();
});

test('レールのフォーカスは白いピル（背景 #f1f1f1・文字 #0f0f0f）、カードはサムネイルの外側の白いリング（拡大なし・6px）', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await press(page, 'ArrowDown');
  await press(page, 'ArrowLeft'); // レール
  const rail = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement);
    return { bg: cs.backgroundColor, color: cs.color, outline: cs.outlineStyle, radius: cs.borderTopLeftRadius, h: Math.round(document.activeElement.getBoundingClientRect().height) };
  });
  assert.equal(rail.bg, 'rgb(241, 241, 241)');
  assert.equal(rail.outline, 'none');
  assert.equal(rail.radius, '12px', 'ピルの角丸は 0.75u');
  assert.equal(rail.h, 52, 'ピルの高さは 3.25u（/tv の 52px）');

  await press(page, 'ArrowRight');
  await page.waitForTimeout(300);
  const card = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    const ring = getComputedStyle(el.querySelector('[class*="ContentCard_head__"]'), '::after');
    return { outlineStyle: cs.outlineStyle, transform: cs.transform, ringWidth: ring.borderTopWidth, ringColor: ring.borderTopColor, ringStyle: ring.borderTopStyle, ringRadius: ring.borderTopLeftRadius, w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height), transition: cs.transitionDuration };
  });
  assert.equal(card.outlineStyle, 'none', 'カード全体は囲まない（リングはサムネイルだけ）');
  assert.equal(card.transform, 'none', '拡大しない');
  assert.equal(card.ringStyle, 'solid');
  assert.equal(card.ringWidth, '6px', 'リングは 0.375u（/tv の 9px @1080 = 6px @720）');
  assert.equal(card.ringColor, 'rgb(241, 241, 241)');
  assert.equal(card.ringRadius, '17.6px', 'リングの角丸は 1.1u');
  assert.equal(card.w, 352, 'カード幅は 22u');
  assert.equal(card.h, 328, 'カード高さは 20.5u');
  assert.equal(card.transition, '0s', 'アニメーションなし（/tv は 1 フレーム）');
  await page.close();
});

test('除外: ヘッダー・フッター・パンくず・外部リンク・アプリバナー・矢印には決してフォーカスしない', async () => {
  const page = await openHome();
  const seen = new Set();
  const keys = ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp', 'ArrowUp'];
  for (const k of keys) {
    await press(page, k, 150);
    seen.add(await id(page));
  }
  for (const bad of ['hamburger', 'logo', 'settings', 'x', 'tos', 'app-banner', 'crumb-home', 'crumb-drama']) assert.ok(!seen.has(bad), `${bad} にフォーカスした: ${[...seen]}`);
  await page.close();
});

test('Enter で遷移 → 戻る（Esc）で前のページへ戻り、フォーカスが復元される', async () => {
  const page = await openHome();
  await press(page, 'ArrowDown');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'epd2');
  await page.keyboard.press('Enter');
  await page.waitForURL('https://tver.jp/episodes/epd2');
  await tverReady(page);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svPage), 'episode');

  await page.keyboard.press('Escape'); // 戻る
  await page.waitForURL('https://tver.jp/');
  await until(async () => (await id(page)) === 'epd2', { message: 'focus restored on epd2', timeout: 8000 });
  await page.close();
});

test('ルート（ホーム）で戻る・どのページでも Home → ハブへ', async () => {
  const page = await openHome();
  await page.keyboard.press('Escape');
  await page.waitForURL(env.hubUrl);

  const p2 = await env.ctx.newPage();
  await p2.goto('https://tver.jp/search');
  await tverReady(p2);
  await p2.keyboard.press('Home');
  await p2.waitForURL(env.hubUrl);

  await page.close();
  await p2.close();
});

test('さがす: 初期フォーカスは「目的から探す」の最初のボタン。文字入力欄にはフォーカスしない', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/search');
  await tverReady(page);
  await until(async () => (await active(page)) !== null);
  assert.equal(await id(page), 'purpose-0');
  await press(page, 'ArrowRight');
  assert.equal(await id(page), 'purpose-1');
  await press(page, 'ArrowDown');
  assert.match(await id(page), /genre-/);
  await page.close();
});

test('ダイアログが開いているときの BACK は閉じる操作に回す（サイトの Esc 処理に任せる）', async () => {
  const page = await openHome();
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.setAttribute('role', 'dialog');
    d.id = 'dlg';
    d.style.cssText = 'position:fixed;left:300px;top:200px;width:400px;height:200px;background:#222;z-index:99';
    d.innerHTML = '<button data-id="dlg-ok" type="button">OK</button> <button data-id="dlg-cancel" type="button">キャンセル</button>';
    document.body.appendChild(d);
    window.__escCount = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { window.__escCount++; d.remove(); } });
  });
  await press(page, 'ArrowDown'); // ダイアログ内の候補だけが対象（フォーカストラップ）
  const a = await id(page);
  assert.ok(['dlg-ok', 'dlg-cancel'].includes(a), a);
  await page.keyboard.press('Backspace'); // Esc 以外の戻るキー → Esc として渡される
  await until(() => page.evaluate(() => window.__escCount >= 1), { message: 'site received Escape' });
  assert.equal(await page.evaluate(() => !!document.getElementById('dlg')), false);
  assert.equal(page.url(), 'https://tver.jp/', 'ページ遷移はしない');
  await page.close();
});
