// TVer の画面が変わっても動き続けるか（SPEC 9.7）。再現ページの HTML を変形して、同じ操作で確かめる。
//  - 全面的に追従できる変更: ハッシュ・寸法・テーマの保存キー  → スキンも含めて変わらない
//  - 劣化しても操作はできる変更: コンポーネント名・<nav> の廃止 → 非表示や拡大は失われても、移動・フォーカス枠・レールは使える
//  - エピソードページ: URL の体系・プレイヤーのクラス名・コンポーネント名の変更 → 視聴画面のキー操作が使える（見た目はクラス名が変わると劣化してよい）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, active, until, press, FIXTURES, tverReady } from './helpers.mjs';
import { homeHtml, episodeHtml } from '../fixtures/tver.mjs';

const VIDEO = fs.readFileSync(path.join(FIXTURES, 'media', 'test.webm'));
const swap = (pairs) => (html) => pairs.reduce((s, [a, b]) => s.split(a).join(b), html);

/** ホームの変更。skin: true は、非表示とカードの拡大まで保たれるべき変更。 */
const HOME_CHANGES = [
  { title: 'CSS Modules のハッシュが全部変わる', skin: true, f: (h) => h.replace(/([A-Za-z]+_[A-Za-z]+__)[A-Za-z0-9_]{5}\b/g, '$1Q9q9Q') },
  {
    title: 'レイアウトの寸法が変わる（カード幅・高さ・間隔・ビルボード幅）',
    skin: true,
    f: swap([
      ['li.Carousel_item__PVkWB { flex: none; width: 300px; }', 'li.Carousel_item__PVkWB { flex: none; width: 220px; }'],
      ['display: block; height: 200px; background: #2a2a2a;', 'display: block; height: 260px; background: #2a2a2a;'],
      ['ul.Carousel_list__8Pj28 { display: flex; gap: 12px;', 'ul.Carousel_list__8Pj28 { display: flex; gap: 24px;'],
      ['flex: none; width: 520px; height: 280px;', 'flex: none; width: 700px; height: 280px;'],
    ]),
  },
  {
    title: 'ダークテーマの保存キーが変わる（appearanceMode を読まなくなる）',
    skin: true,
    f: swap([["localStorage.getItem('appearanceMode')", "localStorage.getItem('uiTheme_v2')"]]),
  },
  { title: 'カードとビルボードのコンポーネント名が変わる', skin: false, f: swap([['ContentCard_', 'Tile_'], ['BillboardList_', 'Hero_']]) },
  {
    title: 'コンポーネント名が全面的に変わる',
    skin: false,
    f: swap([
      ['ContentCard_', 'Tile_'], ['BillboardList_', 'Hero_'], ['Carousel_', 'Row_'], ['AppLayout_', 'Shell_'], ['AppBanner_', 'PromoBar_'],
      ['WatchOnApp_', 'AppPromo_'], ['Episode_player__', 'Watch_stage__'], ['EpisodeDescription_', 'Info_'], ['SearchForm_', 'Query_'],
      ['PurposeSearchSection_', 'Purpose_'], ['Navigation_', 'SideNav_'], ['LiveItem_', 'Live_'],
    ]),
  },
  {
    title: '左レールが <nav> でなく <div role="navigation"> になる',
    skin: false,
    f: swap([
      ['<nav class', '<div role="navigation" class'], ['</nav>', '</div>'], ['nav.AppLayout_navigation', 'div.AppLayout_navigation'],
      ['nav ul', '[role=navigation] ul'], ['nav a', '[role=navigation] a'], ['nav .Navigation_category', '[role=navigation] .Navigation_category'],
    ]),
  },
];

/** エピソードの変更（ページ全体の文字列置換。再現ページの CSS・マークアップ・動作のスクリプトを同時に置き換えるので、サイトが全面的に作り直された状況になる）。epPath は開く URL。skin: true は、見た目も保たれるべき変更。 */
const EPISODE_CHANGES = [
  { title: 'エピソードの URL の体系が変わる（/episodes/ → /watch/）', epPath: '/watch/eptest', skin: true, f: swap([['/episodes/', '/watch/']]) },
  { title: 'CSS Modules のハッシュが全部変わる', epPath: '/episodes/eptest', skin: true, f: (h) => h.replace(/([A-Za-z]+_[A-Za-z]+__)[A-Za-z0-9_]{5}\b/g, '$1Q9q9Q') },
  { title: 'プレイヤーのクラス名が変わる（video-js・streaks-player・vjs-*）', epPath: '/episodes/eptest', skin: true, f: swap([['video-js', 'pl-root'], ['streaks-player', 'pl-core'], ['vjs-', 'pl-']]) },
  {
    title: 'プレイヤーのコンポーネント名が全面的に変わる（PlayerLayout・VodController・Speed・Skip など）',
    epPath: '/episodes/eptest',
    skin: false,
    f: swap([
      ['PlayerLayout_', 'Stage_'], ['VodController_', 'Ctl_'], ['MiniPlayerLayout_', 'Mini_'], ['EpisodePlayer_', 'Pl_'], ['Speed_', 'Rate_'], ['Quality_', 'Res_'],
      ['Skip_icon', 'Jump_icon'], ['Play_icon', 'Toggle_icon'], ['SeekBar_', 'Seek_'], ['TimeLabel_', 'Time_'], ['Tooltip_', 'Tip_'], ['Radio_', 'Choice_'], ['Popover_', 'Pop_'],
      ['Episode_player__', 'Watch_stage__'], ['EpisodeDescription_', 'Info_'], ['WatchOnApp_', 'AppPromo_'], ['AppLayout_', 'Shell_'], ['Carousel_', 'Row_'],
    ]),
  },
];

let env;
let change = (h) => h;

test.before(async () => {
  env = await launch();
  await env.ctx.route('https://tver.jp/**', (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (u.pathname === '/__fx__/test.webm') {
      const range = req.headers().range;
      const m = range && /bytes=(\d+)-(\d*)/.exec(range);
      if (m) {
        const start = Number(m[1]);
        const end = m[2] ? Math.min(Number(m[2]), VIDEO.length - 1) : VIDEO.length - 1;
        return route.fulfill({
          status: 206,
          headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${VIDEO.length}` },
          body: VIDEO.subarray(start, end + 1),
        });
      }
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }, body: VIDEO });
    }
    const body = u.pathname === '/' ? homeHtml() : u.pathname.startsWith('/episodes/') || u.pathname.startsWith('/watch/') ? episodeHtml() : '<!doctype html><title>x</title>';
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: change(body) });
  });
});
test.after(async () => {
  await env.close();
});

const ready = (page) => tverReady(page);
const id = async (page) => (await active(page))?.sv;
const centerX = async (page) => {
  const a = await active(page);
  return a.x + a.w / 2;
};

/** フォーカス枠の見え方（線の種類・太さ・背景との明るさの比）。 */
const ringOf = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s);
      if (!m) return null;
      const p = m[1].split(',').map(parseFloat);
      return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const cs = getComputedStyle(el);
    let bg = [15, 15, 15];
    for (let n = el.parentElement; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.5) {
        bg = c.rgb;
        break;
      }
    }
    // /tv 風のリングはサムネイルの疑似要素（::after の border）。クラス名が変わって使えないときは、共通の outline が代わりに出る
    const head = el.querySelector('[class*="ContentCard_head__"]');
    const pseudo = head ? getComputedStyle(head, '::after') : null;
    const usesPseudo = !!pseudo && pseudo.content !== 'none' && pseudo.borderTopStyle === 'solid';
    const style = usesPseudo ? pseudo.borderTopStyle : cs.outlineStyle;
    const width = usesPseudo ? parseFloat(pseudo.borderTopWidth) : parseFloat(cs.outlineWidth);
    const fg = parse(usesPseudo ? pseudo.borderTopColor : cs.outlineColor);
    const [hi, lo] = [lum(fg.rgb), lum(bg)].sort((x, y) => y - x);
    return { style, width, contrast: (hi + 0.05) / (lo + 0.05), transform: cs.transform, usesPseudo };
  });

for (const c of HOME_CHANGES) {
  test(`ホーム: ${c.title} → 操作できる${c.skin ? '（スキンも保たれる）' : '（スキンは劣化しても可）'}`, async () => {
    change = c.f;
    const page = await env.ctx.newPage();
    await page.goto('https://tver.jp/');
    await ready(page);
    await until(async () => (await active(page)) !== null, { message: 'initial focus' });

    assert.equal(await id(page), 'b1', '初期フォーカスはコンテンツ（ビルボード）');
    await press(page, 'ArrowRight');
    assert.equal(await id(page), 'b2', '→ で隣へ');
    await press(page, 'ArrowDown');
    assert.match(await id(page), /^epd\d+$/, '↓ で 1 行目');
    await press(page, 'ArrowDown');
    assert.match(await id(page), /^epv\d+$/, '↓ で 2 行目');
    // 行をまたぐと、その行で最後にいた（初めてなら先頭の）カードへ移る（/tv と同じ。列は引き継がない）

    const ring = await ringOf(page);
    assert.equal(ring.style, 'solid', 'フォーカス枠が出る');
    assert.ok(ring.width >= 3, `枠の太さ ${ring.width}`);
    assert.ok(ring.contrast >= 3, `枠が背景から見分けられる（明るさの比 ${ring.contrast.toFixed(1)}）`);

    if (c.skin) {
      const hidden = await page.evaluate(() =>
        ['[data-id="app-banner"]', 'button[aria-label="次へ"]', '[data-id="hamburger"]', '[data-id="settings"]', 'input[placeholder]'].map(
          (sel) => document.querySelector(sel).getClientRects().length === 0,
        ),
      );
      assert.deepEqual(hidden, [true, true, true, true, true], 'バナー・矢印・ハンバーガー・設定・検索が隠れている');
      assert.equal(ring.usesPseudo, true, 'サムネイルの外側のリング（/tv と同じ）が出る');
      assert.equal(ring.transform, 'none', '拡大はしない');
    }

    // 実際のキー操作でビルボードの左端まで戻り、← でレールへ出られるか
    for (let i = 0; i < 4 && !/^b\d$/.test((await id(page)) || ''); i++) await press(page, 'ArrowUp', 300);
    assert.match(await id(page), /^b\d$/, '↑ でビルボードへ戻れる');
    for (let i = 0; i < 4 && (await id(page)) !== 'b1'; i++) await press(page, 'ArrowLeft', 250);
    assert.equal(await id(page), 'b1', 'ビルボードの左端に戻れる');
    await press(page, 'ArrowLeft');
    assert.match(await id(page), /^rail-/, '左端の ← でレールへ出られる');
    await page.close();
  });
}

for (const c of EPISODE_CHANGES) {
  test(`エピソード: ${c.title} → 視聴画面のキー操作が使える${c.skin ? '（見た目も保たれる）' : '（見た目は劣化しても可）'}`, async () => {
    change = c.f;
    const page = await env.ctx.newPage();
    page.__errors = [];
    page.on('pageerror', (e) => page.__errors.push(e.message));
    await page.goto('https://tver.jp' + c.epPath);
    await ready(page);
    // 初期フォーカスは TVer 自身の再生ボタン（id が目印。クラス名に依存しない）
    await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'), { message: 'poster play button focused' });
    await page.keyboard.press('Enter');
    await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'sv-watch' });
    await until(() => page.evaluate(() => { const v = document.querySelector('video'); return !v.paused && v.currentTime > 0.1; }), { message: 'playing' });
    const ui = () => page.evaluate(() => `${document.documentElement.dataset.svUi}/${document.documentElement.dataset.svFocus}`);
    const label = () => page.evaluate(() => { const a = document.activeElement; return (a.querySelector && a.querySelector('svg')?.getAttribute('aria-label')) || a.getAttribute('aria-label') || a.tagName; });
    assert.equal(await ui(), 'H/row');

    await press(page, 'ArrowDown', 200);
    assert.equal(await ui(), 'C/row', '↓ で操作画面');
    assert.equal(await label(), '一時停止', '再生/一時停止にフォーカス（ARIA ラベルで見つける）');
    await press(page, 'Enter', 250);
    assert.equal(await page.evaluate(() => document.querySelector('video').paused), true, 'OK で TVer のボタンを押して一時停止');
    await press(page, 'ArrowRight', 120);
    assert.equal(await label(), '10秒進む', '← → でボタンを移動');
    await press(page, 'ArrowUp', 150);
    assert.equal(await ui(), 'C/bar');
    await page.evaluate(() => { document.querySelector('video').currentTime = 10; });
    await page.waitForTimeout(250);
    await press(page, 'ArrowRight', 150); // スクラブ（+10 秒）
    assert.equal((await ui()).split('/')[0], 'S');
    await press(page, 'Enter', 400);
    const t = await page.evaluate(() => document.querySelector('video').currentTime);
    assert.ok(t >= 20 && t < 23, 'スクラブして確定: ' + t);
    assert.equal(await page.evaluate(() => !document.querySelector('video').paused), true, '確定すると再生する');

    if (c.skin) {
      const g = await page.evaluate(() => {
        const r = document.querySelector('[js-fullscreen-target]').getBoundingClientRect();
        const j = getComputedStyle(document.querySelector('[class*="PlayerLayout_jail__"], [class*="PlayerLayout_jail"]') || document.body);
        return { fills: [r.left, r.top, r.width, r.height].join(), mask: j.maskImage };
      });
      assert.equal(g.fills, '0,0,1280,720', '画面いっぱい');
    }
    assert.deepEqual(page.__errors, []);
    await page.close();
  });
}
