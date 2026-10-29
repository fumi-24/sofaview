// 実サイト（youtube.com/tv・tver.jp・open.spotify.com）に対するスモークテスト。DOM の変更を早く検知するためのもの。
// 実行: npm run test:live（LIVE=1 とネットワークが必要）。TVer の実際の再生は日本国内IP・DRM が要るため対象外。
// ただし視聴画面は、地域制限で 403 になる再生 API（playback.api.streaks.jp）だけを偽の応答に差し替えれば、実サイトの JS・Streaks SDK のまま再生できるので、
// 実 DOM での干渉（マスク・操作盤の表示・全画面・キー処理）をそれで確かめる（再生 API の偽装は検証用で、拡張には入っていない）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, active, until, press, settleScroll, ROOT } from '../e2e/helpers.mjs';

const LIVE = process.env.LIVE === '1';
const OUT = path.join(ROOT, 'test-results', 'live');
const opts = { skip: !LIVE ? 'LIVE=1 を付けて実行してください' : false, timeout: 180000 };

let env;
test.before(async () => {
  if (!LIVE) return;
  fs.mkdirSync(OUT, { recursive: true });
  env = await launch();
});
test.after(async () => {
  if (env) await env.close();
});

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, name + '.png') }).catch(() => {});
}

async function openTver(pathname) {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp' + pathname, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1'), { timeout: 30000, message: 'sv ready' });
  // 初期フォーカス（コンテンツの描画を待つ）
  await until(() => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body), { timeout: 30000, message: 'initial focus' });
  return page;
}

const inContent = (page) => page.evaluate(() => !!document.activeElement.closest('main'));

test('YouTube /tv: 拡張機能の UA 偽装で TV 向け UI が起動し、十字キー・Enter が公式のまま効く。Home でハブへ', opts, async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://www.youtube.com/tv', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await until(() => page.evaluate(() => !!document.querySelector('ytlr-app')), { timeout: 40000, message: 'ytlr-app' });
  const info = await page.evaluate(() => ({ ua: navigator.userAgent, cls: document.documentElement.className, title: document.title }));
  assert.match(info.ua, /Tizen/);
  assert.match(info.cls, /sv-yt/);

  await until(() => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body), { timeout: 20000, message: 'focus in /tv' });
  await page.waitForTimeout(1500);
  await shot(page, 'youtube-1-boot');
  // Enter → アカウント選択（QR コード + yt.be/activate。表示言語に依存しない判定）
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => /yt\.be\/activate/.test(document.body.innerText)), { timeout: 20000, message: 'activation screen' });
  await shot(page, 'youtube-2-activate');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape'); // 公式の「戻る」
  await page.waitForTimeout(800);
  assert.match(page.url(), /youtube\.com\/tv/);

  await page.keyboard.press('Home'); // /tv は Home を処理しない → 拡張がハブへ
  await page.waitForURL(env.hubUrl, { timeout: 10000 });
  await page.close();
});

test('TVer ホーム: ダークテーマ・画面倍率・初期フォーカスがコンテンツ・十字キーで巡回できる', opts, async () => {
  const page = await openTver('/');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('dark')), { message: 'dark' });
  await until(() => page.evaluate(() => window.innerHeight === 720), { timeout: 15000, message: 'zoom 1.5 (innerHeight 720)' });
  await until(() => inContent(page), { timeout: 20000, message: 'initial focus is in main content' });
  await shot(page, 'tver-1-home');

  // フォーカスのリング: 通常は outline。ビルボード（スライダー）は、画像に隠れないよう、スライドの疑似要素で上に重ねる
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    if (cs.outlineStyle === 'solid') return { kind: 'outline', color: cs.outlineColor };
    // ビルボード: リンク自身の ::after（サイトがリング用に持っている。画像の上に重なる）に描く
    const own = getComputedStyle(el, '::after');
    return own.content !== 'none' ? { kind: 'overlay', color: own.boxShadow } : null;
  });
  assert.ok(ring, 'フォーカス中の要素にリングがある');
  assert.ok(ring.color.includes('rgb(241, 241, 241)'), JSON.stringify(ring));

  // 隠すもの
  const hidden = await page.evaluate(() => {
    const disp = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).display : 'absent'; };
    return { banner: disp('[class*="AppBanner_"]'), actions: disp('[class*="AppLayout_actions__"]'), hamburger: disp('[class*="AppLayout_icon__"]') };
  });
  assert.ok(['none', 'absent'].includes(hidden.banner), 'app banner ' + hidden.banner);
  assert.equal(hidden.actions, 'none');
  assert.equal(hidden.hamburger, 'none');

  // 巡回: 常に画面内の内部リンク/ボタンにフォーカスし、外部リンク・ヘッダー・フッターには行かない
  const seen = [];
  const keys = ['ArrowDown', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowDown'];
  for (const k of keys) {
    await press(page, k, 350);
    await settleScroll(page);
    const a = await page.evaluate(() => {
      const el = document.activeElement;
      const r = el.getBoundingClientRect();
      return { href: el.href || '', inMain: !!el.closest('main'), inFooter: !!el.closest('footer'), inHeader: !!el.closest('header'), visible: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth, text: (el.textContent || '').trim().slice(0, 20) };
    });
    seen.push(a);
    assert.equal(a.inFooter || a.inHeader, false, JSON.stringify(a));
    assert.ok(a.visible, 'focused element is on screen: ' + JSON.stringify(a));
    if (a.href) assert.match(new URL(a.href).host, /(^|\.)tver\.jp$/, 'internal link only: ' + a.href);
  }
  assert.ok(new Set(seen.map((s) => s.href)).size >= 5, '十字キーで複数の要素を巡回できる');
  await shot(page, 'tver-2-home-after-nav');
  await page.close();
});

test('TVer: 左端で ← → レール、Enter でカテゴリへ遷移し、遷移先のコンテンツにフォーカスが移る', opts, async () => {
  const page = await openTver('/');
  await until(() => inContent(page), { timeout: 20000 });
  await press(page, 'ArrowDown', 500); // ビルボードは ← → でループするので、先頭の行へ下りてから左端へ（/tv と同じ行の作り）
  for (let i = 0; i < 12 && (await inContent(page)); i++) await press(page, 'ArrowLeft', 200);
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('nav')), true, 'レールにフォーカス');
  await shot(page, 'tver-3-rail');
  // 「ドラマ」まで下へ
  for (let i = 0; i < 8; i++) {
    const href = await page.evaluate(() => document.activeElement.getAttribute('href'));
    if (href === '/categories/drama') break;
    await press(page, 'ArrowDown', 150);
  }
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('href')), '/categories/drama');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/categories/drama', null, { timeout: 20000 });
  // レールで選んだら、フォーカスはレールに残る（勝手に内容へ動かさない）。→ で新しいページの内容へ入る
  await page.waitForFunction(() => document.documentElement.dataset.svPage === 'list', null, { timeout: 20000 });
  await page.waitForTimeout(2500); // 描画・初期フォーカスの試行が落ち着くまで
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('nav')), true, 'フォーカスはレールに残る');
  await press(page, 'ArrowRight', 400);
  await until(() => inContent(page), { timeout: 20000, message: 'focus moved into the category content' });
  await shot(page, 'tver-4-category');
  // 戻る: ホームへ
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => location.pathname === '/', null, { timeout: 20000 });
  await page.close();
});

test('TVer さがす: 文字入力欄ではなくボタン・リンクに初期フォーカスし、十字キーで移動できる', opts, async () => {
  const page = await openTver('/search');
  await until(() => inContent(page), { timeout: 20000, message: 'focus in main' });
  const tag = await page.evaluate(() => document.activeElement.tagName);
  assert.ok(['A', 'BUTTON'].includes(tag), tag);
  const before = await active(page);
  await press(page, 'ArrowRight', 300);
  await press(page, 'ArrowDown', 300);
  const after = await active(page);
  assert.notDeepEqual(before, after, 'フォーカスが動く');
  await shot(page, 'tver-5-search');
  await page.close();
});

test('TVer 番組ページ・エピソードページ: フォーカスが付き、エピソードの初期フォーカスは TVer 自身の再生ボタン', opts, async () => {
  const home = await openTver('/');
  const links = await home.evaluate(() => ({
    series: document.querySelector('a[href^="/series/"]')?.getAttribute('href'),
    episode: document.querySelector('a[href^="/episodes/"]')?.getAttribute('href'),
  }));
  await home.close();
  assert.ok(links.series && links.episode, JSON.stringify(links));

  const series = await openTver(links.series);
  await until(() => inContent(series), { timeout: 20000, message: 'focus in series content' });
  assert.equal(await series.evaluate(() => document.documentElement.dataset.svPage), 'series');
  await press(series, 'ArrowDown', 300);
  assert.equal(await series.evaluate(() => !!document.activeElement.closest('main')), true);
  await shot(series, 'tver-6-series');
  await series.close();

  const ep = await openTver(links.episode);
  assert.equal(await ep.evaluate(() => document.documentElement.dataset.svPage), 'episode');
  // 日本国内なら、TVer 自身が autoFocus する再生ボタンに、拡張の初期フォーカスが重なる（旧: 拡張がプレイヤー枠にフォーカスしていた）。
  // 国外 IP では再生 API が 403 になり、TVer 自身が「通信エラー」のモーダルを出す（そのときはモーダルの中にフォーカスがあってよい）
  await until(() => ep.evaluate(() => document.activeElement?.id === 'episode-play' || !!document.activeElement?.closest('[class*="Modal_content"]')), { timeout: 30000, message: 'poster play button (or TVer error dialog) focused' });
  await shot(ep, 'tver-7-episode');
  const errors = [];
  ep.on('pageerror', (e) => errors.push(e.message));
  await ep.keyboard.press('Enter'); // 再生ボタン → TVer 自身が再生を始める（初回はアンケート）／エラーのモーダル → OK で閉じる
  await ep.waitForTimeout(2500);
  await shot(ep, 'tver-8-episode-ok');
  await press(ep, 'ArrowDown', 400);
  assert.equal(await ep.evaluate(() => document.documentElement.dataset.svReady), '1');
  assert.deepEqual(errors.filter((m) => /sv-|SV\./.test(m)), [], '拡張由来の例外がない');
  await ep.close();
});

test('TVer 番組ページ: エピソード一覧のカードにフォーカスすると、TVer 標準の詳細ポップアップが出る（Linux でも出る）', opts, async () => {
  const home = await openTver('/');
  const series = await home.evaluate(() => document.querySelector('a[href^="/series/"]')?.getAttribute('href'));
  await home.close();
  assert.ok(series, '番組ページへのリンク');
  const page = await openTver(series);
  // 端末判定（UA）: Linux の Chromium でも、TVer 自身が「その他」と判定して詳細ポップアップを出せる
  assert.doesNotMatch(await page.evaluate(() => navigator.userAgent), /Linux|HeadlessChrome/);
  await page.waitForSelector('[class*="SeasonEpisodeListItem_popupContainer__"]', { state: 'attached', timeout: 30000 });
  // 初期フォーカスがエピソード一覧のカードになる番組ページなら、すぐ出る。そうでなければ ↓ で一覧のカードへ
  const onCard = () => page.evaluate(() => !!document.activeElement.closest('[class*="SeasonEpisodeListItem_popupContainer__"]'));
  for (let i = 0; i < 12 && !(await onCard()); i++) await press(page, 'ArrowDown', 350);
  assert.equal(await onCard(), true, '一覧のカードにフォーカスできる');
  await until(
    () =>
      page.evaluate(() => {
        const host = document.activeElement.closest('[class*="SeasonEpisodeListItem_popupContainer__"]');
        const p = host && host.querySelector('[class*="SeasonEpisodeListItem_popup__"]');
        return !!p && Number(getComputedStyle(p).opacity) === 1 && document.querySelectorAll('[class*="SeasonEpisodeListItem_popup__"]').length === 1;
      }),
    { timeout: 8000, message: 'detail popup for the focused card' },
  );
  const ring = await page.evaluate(() => {
    const p = document.activeElement.closest('[class*="SeasonEpisodeListItem_popupContainer__"]').querySelector('[class*="SeasonEpisodeListItem_popup__"] > div');
    return getComputedStyle(p).outlineStyle + ' ' + getComputedStyle(p).outlineWidth;
  });
  assert.equal(ring, 'solid 6px', 'リングはポップアップに付く');
  await shot(page, 'tver-9b-detail-popup');
  await page.close();
});

test('TVer リアルタイム: /live が表示され、タブやタイムラインにフォーカスできる', opts, async () => {
  const page = await openTver('/live');
  await until(() => inContent(page), { timeout: 20000, message: 'focus in live page' });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svPage), 'live');
  await press(page, 'ArrowRight', 300);
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('main')), true);
  await shot(page, 'tver-9-live');
  await page.close();
});

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,OPTIONS' };

/** 地域制限で 403 になる再生 API だけを偽の応答（ローカルの webm を 1 本）にする。広告・DRM は含まない。 */
async function fakePlayback(ctx) {
  const VIDEO = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'media', 'test.webm'));
  await ctx.route('https://playback.api.streaks.jp/**', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = { id: 'fake-media', name: 'fake', duration: 60, sources: [{ src: 'https://tver.jp/__fx__/test.webm', type: 'video/webm' }], ads: [], ad_fields: {}, tracks: [], thumbnails: [] };
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  });
  await ctx.route('https://tver.jp/__fx__/test.webm', (route) => {
    const range = route.request().headers().range;
    const m = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (m) {
      const start = Number(m[1]);
      const end = m[2] ? Math.min(Number(m[2]), VIDEO.length - 1) : VIDEO.length - 1;
      return route.fulfill({ status: 206, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${VIDEO.length}` }, body: VIDEO.subarray(start, end + 1) });
    }
    return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }, body: VIDEO });
  });
}

/** 初回に出る必須のアンケート（回答しないと再生されない）に答える。 */
async function answerQuestionnaire(page) {
  const dlg = page.locator('[role="dialog"]:has(form[id^="questionnaire-"])');
  if (!(await dlg.count())) return false;
  // 拡張の画面上のキーボードが自動で開いている（アンケートの自動入力）。ここでは Playwright が直接入力するので閉じる
  await page.locator('#sv-osk').waitFor({ state: 'attached', timeout: 3000 }).catch(() => {});
  if (await page.locator('#sv-osk').count()) await page.keyboard.press('Escape');
  await dlg.locator('input[name="birthYear"]').fill('1990');
  await dlg.locator('input[name="birthMonth"]').fill('4');
  await dlg.locator('button[role="radio"][value="1"]').click();
  await dlg.locator('input[name="postCode"]').fill('1050004');
  await dlg.locator('button[type="submit"]').click();
  return true;
}

test('実際の TVer のプレイヤー（再生 API だけ偽）で、視聴画面が /tv と同じ配置・操作になる。TVer 自身の全画面・操作盤・ポップアップと干渉しない', opts, async () => {
  await fakePlayback(env.ctx);
  const home = await openTver('/');
  const episode = await home.evaluate(() => document.querySelector('a[href^="/episodes/"]')?.getAttribute('href'));
  await home.close();
  const page = await openTver(episode);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'), { timeout: 30000, message: 'poster play button focused' });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await answerQuestionnaire(page);
  await page.waitForSelector('[class*="VodController_container__"]', { state: 'attached', timeout: 40000 });
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { timeout: 15000, message: 'sv-watch' });
  await until(() => page.evaluate(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.5; }), { timeout: 30000, message: 'playing' });
  await page.waitForTimeout(600);

  const ui = () => page.evaluate(() => `${document.documentElement.dataset.svUi}/${document.documentElement.dataset.svFocus}`);
  const label = () => page.evaluate(() => { const a = document.activeElement; return (a.querySelector && a.querySelector('svg')?.getAttribute('aria-label')) || a.getAttribute('aria-label') || a.className; });
  assert.equal(await ui(), 'H/row', '再生が始まると、操作盤は隠れている（/tv と同じ）');

  const g = await page.evaluate(() => {
    const host = document.querySelector('[js-fullscreen-target]');
    const r = host.getBoundingClientRect();
    const jail = getComputedStyle(document.querySelector('[class*="PlayerLayout_jail__"]'));
    const vr = document.querySelector('video').getBoundingClientRect();
    return { host: [r.left, r.top, r.width, r.height], video: [vr.left, vr.top, vr.width, vr.height], mask: jail.maskImage, win: [innerWidth, innerHeight], fs: document.fullscreenElement === host, mini: host.getAttribute('data-mini-player'), ctlFs: document.querySelector('[class*="VodController_container__"]').getAttribute('data-fullscreen') };
  });
  assert.deepEqual(g.host, [0, 0, g.win[0], g.win[1]], 'プレイヤーが画面いっぱい（マスクのクリップで 752x423 のままにならない）');
  assert.deepEqual(g.video, [0, 0, g.win[0], g.win[1]]);
  assert.equal(g.mask, 'none');
  assert.equal(g.mini, 'false');
  assert.ok(['true', 'false'].includes(g.ctlFs));
  await shot(page, 'tver-10-watch-H');

  await press(page, 'ArrowDown', 300);
  assert.equal(await ui(), 'C/row');
  assert.equal(await label(), '一時停止', '再生/一時停止にフォーカス');
  const c = await page.evaluate(() => {
    const ctl = document.querySelector('[class*="VodController_container__"]');
    const R = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10); };
    const play = Array.from(ctl.querySelectorAll('button')).find((b) => b.querySelector('svg')?.getAttribute('aria-label') === '一時停止');
    return { opacity: getComputedStyle(ctl).opacity, play: R(play), win: [innerWidth, innerHeight], playBg: getComputedStyle(play).backgroundColor, title: R(document.querySelector('#sv-watch-ui .sv-w-title')), visible: Array.from(ctl.querySelectorAll('button')).filter((b) => b.getClientRects().length).length };
  });
  assert.equal(c.opacity, '1', '操作画面（C）で操作盤が見える');
  assert.equal(c.play[0] + c.play[2] / 2, c.win[0] / 2, '再生ボタンは画面の真ん中');
  assert.equal(c.playBg, 'rgb(241, 241, 241)', 'フォーカス中は白地（/tv と同じ）');
  assert.equal(c.visible, 5, '-10 秒・再生・+10 秒・速度・画質（音量と全画面は /tv にない）');
  await shot(page, 'tver-11-watch-C');

  // ボタン列 → 再生速度のポップアップ（TVer の Radix。拡張は矢印に介入しない）
  await press(page, 'ArrowRight', 150);
  await press(page, 'ArrowRight', 150);
  assert.equal(await label(), '再生速度の選択');
  await press(page, 'Enter', 400);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'radio', 'ポップアップの現在の速度にフォーカス');
  await shot(page, 'tver-12-watch-speed');
  await press(page, 'ArrowUp', 300); // 矢印はフォーカスが動くだけ（TVer の仕様）
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '再生速度 1.25');
  assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 1);
  await press(page, 'Enter', 500); // 拡張: フォーカス中の項目を選んで閉じる
  assert.equal(await page.evaluate(() => document.querySelector('video').playbackRate), 1.25, 'OK で選ぶ');
  assert.equal(await page.evaluate(() => !document.querySelector('[js-fullscreen-target] [role="dialog"][data-state="open"]')), true, 'OK で閉じる');
  assert.equal(await label(), '再生速度の選択', 'フォーカスは速度ボタンに戻る');

  // スクラブ（進行バーで → → OK）
  await press(page, 'ArrowUp', 200);
  assert.equal(await ui(), 'C/bar');
  const t0 = await page.evaluate(() => document.querySelector('video').currentTime);
  await press(page, 'ArrowRight', 250);
  await press(page, 'ArrowRight', 250);
  assert.equal((await ui()).split('/')[0], 'S');
  assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, '探している間は止まる');
  await shot(page, 'tver-13-watch-scrub');
  await press(page, 'Enter', 700);
  const t1 = await page.evaluate(() => document.querySelector('video').currentTime);
  assert.ok(t1 > t0 + 18 && t1 < t0 + 24, `+20 秒: ${t0} → ${t1}`);
  assert.equal(await page.evaluate(() => !document.querySelector('video').paused), true);

  // TVer 自身の f（全画面の切り替え）と干渉しない
  const fs0 = await page.evaluate(() => !!document.fullscreenElement);
  await press(page, 'f', 500);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), !fs0, 'f で TVer が全画面を切り替える');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), true, '視聴画面は保たれる');
  assert.deepEqual(
    await page.evaluate(() => { const r = document.querySelector('[js-fullscreen-target]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }),
    [0, 0, g.win[0], g.win[1]],
    '全画面でも劇場表示でも画面いっぱい',
  );

  // 再生が終わる: 次のエピソードの案内 → 戻る 1 回で、TVer が自動再生を止めてプレイヤーを最初のポスターへ戻す（全画面も終わる）→ OK で見直し。
  // （推薦の取得に失敗・推薦がないときは、TVer が案内を出さずにすぐポスターへ戻す。その場合は戻る操作を省く）
  await page.evaluate(() => { const v = document.querySelector('video'); v.currentTime = Math.max(0, v.duration - 2); });
  await until(() => page.evaluate(() => !!document.querySelector('[js-fullscreen-target] button[aria-label$="を再生"]') || !!document.querySelector('#episode-play')), { timeout: 30000, message: 'end panel or poster' });
  if (await page.evaluate(() => !!document.querySelector('[js-fullscreen-target] button[aria-label$="を再生"]'))) {
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-ended')), true, '案内の間は sv-ended');
    await shot(page, 'tver-13b-watch-ended');
    await page.keyboard.press('Escape'); // TVer の「閉じる」
    await until(() => page.evaluate(() => !!document.querySelector('#episode-play')), { timeout: 15000, message: 'poster after close' });
  }
  await until(() => page.evaluate(() => !document.fullscreenElement && !document.documentElement.classList.contains('sv-watch')), { timeout: 10000, message: 'fullscreen and watch mode end' });
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'), { timeout: 10000, message: 'poster play button focused' });
  await page.keyboard.press('Enter'); // 見直し
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { timeout: 20000, message: 'sv-watch again' });
  await until(() => page.evaluate(() => { const v = document.querySelector('video'); return v && !v.paused && v.currentTime > 0.3 && v.currentTime < 30; }), { timeout: 20000, message: 'replaying from the start' });

  // 戻る: 隠す → 離れる（前のページへ。新しいタブの履歴には about:blank があるので、そこへ戻る）
  await press(page, 'ArrowDown', 200);
  await press(page, 'Escape', 200); // 操作画面を隠す
  assert.equal((await ui()).split('/')[0], 'H');
  await page.keyboard.press('Escape'); // 離れる
  await until(() => !page.url().includes('/episodes/'), { timeout: 15000, message: 'left the episode page' });
  assert.deepEqual(errors.filter((m) => /sv-|SV\./.test(m)), [], '拡張由来の例外がない');
  await page.close();
});

test('Spotify（ログアウト状態の Web プレーヤー）: 初期フォーカスが内容のカードに入り、OK でカードを開き、戻るで戻ると、またカードにフォーカスが入る。十字キーで移動でき、別サイトのリンクには止まらない', opts, async () => {
  const page = await env.ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const onCard = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('main') && document.activeElement.getAttribute('role') === 'row');
  await page.goto('https://open.spotify.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await until(() => page.evaluate(() => document.documentElement.dataset.svReady === '1'), { timeout: 30000, message: 'sv ready' });
  await until(onCard, { timeout: 30000, message: 'initial focus on a card' });
  await shot(page, 'spotify-1-initial');
  // OK でカードを開く → 戻るで戻る（戻った先でも、カードにフォーカスが入る）
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => /\/(album|playlist|track|artist)\//.test(location.pathname)), { timeout: 15000, message: 'card opened' });
  await shot(page, 'spotify-2-opened');
  await page.keyboard.press('Escape');
  await until(() => page.evaluate(() => /^\/(intl-[a-z-]+\/)?$/.test(location.pathname)), { timeout: 15000, message: 'back to home' });
  await until(onCard, { timeout: 30000, message: 'focus on a card after going back' });
  // 十字キーで移動できる
  const first = await page.evaluate(() => document.activeElement.textContent);
  await press(page, 'ArrowRight', 200);
  assert.notEqual(await page.evaluate(() => document.activeElement.textContent), first, '右のカードへ');
  await press(page, 'ArrowDown', 300);
  assert.ok(await page.evaluate(() => !!document.activeElement.closest('main')), '下の棚へ');
  const hrefs = new Set();
  for (let i = 0; i < 12; i++) {
    await press(page, i % 3 === 2 ? 'ArrowLeft' : 'ArrowUp', 150);
    hrefs.add(await page.evaluate(() => document.activeElement.getAttribute('href') || ''));
  }
  for (const h of hrefs) assert.ok(!h || h.startsWith('/') || h.includes('open.spotify.com'), '別サイトのリンクには止まらない: ' + h);
  assert.deepEqual(errors.filter((m) => /sv-|SV\./.test(m)), [], '拡張由来の例外がない');
  await page.close();
});
