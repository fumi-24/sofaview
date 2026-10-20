// TVer の視聴画面（プレイヤー）の E2E。再現ページ（tests/fixtures/tver-player.mjs）は実サイトの構造と挙動
// （PlayerLayout_jail のマスク・VodController の表示タイマー・document の keydown・[js-fullscreen-target] の全画面・Radix 風のポップアップ・
// ミニプレイヤー・次のエピソード）を再現している。拡張は TVer 自身のプレイヤーを /tv と同じ見た目・操作にする（docs/SPEC.md 9.5）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, until, press, FIXTURES, tverReady } from './helpers.mjs';
import { episodeHtml } from '../fixtures/tver.mjs';

const VIDEO = fs.readFileSync(path.join(FIXTURES, 'media', 'test.webm'));
let env;

/** パスごとの再現ページの設定。 */
const PAGES = {
  '/episodes/eptest': {},
  '/episodes/quest': { questionnaire: true },
  '/episodes/auto': { autoplay: true, autoplayDelay: 6500 }, // ユーザー操作の窓（約 5 秒）が過ぎてから再生が始まる
  '/episodes/endsoon': { nextWait: 3 },
  '/episodes/keeppanel': { nextWait: 3, cancelKeepsPanel: true }, // 「閉じる」のあとも案内が残る場合
};

test.before(async () => {
  env = await launch({ viewport: { width: 1280, height: 720 } });
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
    const body = episodeHtml(PAGES[u.pathname] || {});
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
});
test.after(async () => {
  await env.close();
});

// ---------------------------------------------------------------- 道具

const vid = (page, expr) => page.evaluate(`(() => { const v = document.querySelector('video'); return ${expr}; })()`);
/** 視聴画面の状態（html[data-sv-ui] / [data-sv-focus]）。 */
const ui = (page) => page.evaluate(() => `${document.documentElement.dataset.svUi}/${document.documentElement.dataset.svFocus}`);
/** フォーカス中の要素の名前（ボタンはアイコンの ARIA ラベル）。 */
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    if (/VodController_container/.test(a.className)) return 'container';
    return (a.querySelector && a.querySelector('svg')?.getAttribute('aria-label')) || a.getAttribute('aria-label') || a.id || a.tagName;
  });
const fxState = (page) => page.evaluate(() => window.__fx.state());
const fxLog = (page, ev) => page.evaluate((ev) => window.__fx.log.filter((l) => l.ev === ev), ev);
const rect = (page, sel) =>
  page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100);
  }, sel);

async function openEpisode(p = '/episodes/eptest') {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto('https://tver.jp' + p);
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement && document.activeElement.id === 'episode-play'), { message: 'TVer のポスターの再生ボタンにフォーカス' });
  return page;
}

/** 再生を始めて、視聴画面（html.sv-watch）になるまで進める。 */
async function openWatch(p) {
  const page = await openEpisode(p);
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'sv-watch' });
  await until(() => vid(page, '!v.paused && v.currentTime > 0.1'), { message: 'playing' });
  await page.waitForTimeout(150);
  return page;
}

async function setSettings(patch) {
  await env.sw.evaluate((p) => new Promise((r) => chrome.storage.local.set({ 'sv.settings': p }, r)), patch);
}
async function clearSettings() {
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('sv.settings', r)));
}

// ---------------------------------------------------------------- 開始・全画面・劇場表示

test('エピソード: 初期フォーカスは TVer 自身の再生ボタン。拡張はプレイヤーに独自の枠・属性を足さない', async () => {
  const page = await openEpisode();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svPage), 'episode');
  assert.equal(await vid(page, 'v.paused'), true, '手動では自動再生しない');
  assert.equal(await page.evaluate(() => document.querySelectorAll('[data-sv-player-target], [data-sv-fs-target], #sv-shell').length), 0, '旧 HUD の名残がない');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('episode-app-link')).display), 'none', '「アプリで視聴する」は隠れる');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), false, '再生前は視聴画面ではない（ページの普通の操作）');
  await page.close();
});

test('OK で再生が始まる → 視聴画面: TVer 自身の全画面（host）・操作盤は隠れた状態（H）・実フォーカスは操作盤', async () => {
  const page = await openWatch();
  const s = await fxState(page);
  assert.equal(s.view, 'vod');
  assert.equal(s.fullscreenIsHost, true, 'TVer 自身の全画面ボタンで [js-fullscreen-target] が全画面になる（html ではない）');
  assert.equal(await ui(page), 'H/row');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[class*="VodController_container__"]')).opacity), '0', '操作盤は隠れている（H）');
  assert.equal(await focused(page), 'container');
  const g = await page.evaluate(() => {
    const host = document.querySelector('[js-fullscreen-target]');
    const r = host.getBoundingClientRect();
    const j = getComputedStyle(document.querySelector('[class*="PlayerLayout_jail__"]'));
    const c = document.querySelector('[class*="VodController_container__"]');
    return { host: [r.left, r.top, r.width, r.height], mask: j.maskImage, dataFs: c.getAttribute('data-fullscreen'), logged: window.__fx.log.filter((l) => l.ev === 'fullscreen-toggle').length };
  });
  assert.deepEqual(g.host, [0, 0, 1280, 720]);
  assert.equal(g.mask, 'none');
  assert.equal(g.dataFs, 'true', 'TVer の状態（data-fullscreen）も全画面になっている');
  assert.equal(g.logged, 1, 'TVer の全画面ボタンが 1 回だけ押された');
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('全画面にしない設定でも、劇場表示（画面いっぱい・マスク解除）。ページはスクロールしてもミニプレイヤーにならない', async () => {
  await setSettings({ tver: { nativeFullscreen: false } });
  const page = await openEpisode();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'sv-watch' });
  await page.waitForTimeout(300);
  assert.equal((await fxState(page)).fullscreen, false, '設定で全画面にしない');
  const g = await page.evaluate(() => {
    const r = document.querySelector('[js-fullscreen-target]').getBoundingClientRect();
    const vr = document.querySelector('video').getBoundingClientRect();
    return { host: [r.left, r.top, r.width, r.height], video: [vr.left, vr.top, vr.width, vr.height], mask: getComputedStyle(document.querySelector('[class*="PlayerLayout_jail__"]')).maskImage, overflow: getComputedStyle(document.documentElement).overflow };
  });
  assert.deepEqual(g.host, [0, 0, 1280, 720]);
  assert.deepEqual(g.video, [0, 0, 1280, 720], 'マスクが外れ、映像も画面いっぱい');
  assert.equal(g.mask, 'none');
  assert.equal(g.overflow, 'hidden');
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.querySelector('[js-fullscreen-target]').getAttribute('data-mini-player')), 'false', 'スクロールしてもミニプレイヤーにならない');
  assert.equal((await fxLog(page, 'mini')).length, 0);
  await page.close();
  await clearSettings();
});

test('画面の縦横比が 16:9 でなくても、/tv と同じ舞台（80 x 45 を中央）に UI が載る', async () => {
  await setSettings({ zoom: { mode: 'off' }, tver: { nativeFullscreen: false } });
  const page = await env.ctx.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('https://tver.jp/episodes/eptest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const g = {
    video: await rect(page, 'video'),
    ctl: await rect(page, '[class*="VodController_container__"]'),
    meta: await rect(page, '#sv-watch-ui .sv-w-meta'),
    progress: await rect(page, '#sv-watch-ui .sv-w-progress'),
    row: await rect(page, '[class*="VodController_buttons__"]'),
  };
  assert.deepEqual(g.video, [0, 40, 1280, 720], '映像は 16:9 で縦の中央（上下に黒い帯）');
  assert.deepEqual(g.ctl, [0, 40, 1280, 720], '操作盤の舞台は映像と同じ');
  assert.deepEqual([g.meta[0], g.meta[1], g.meta[2]], [64, 104, 768], 'タイトル: x4 y4 幅 48（舞台の左上から）');
  assert.deepEqual(g.progress, [64, 466, 1152, 68], '進行バー: x4 y26.625 幅 72 高さ 4.25');
  assert.deepEqual(g.row, [64, 534, 1152, 64], 'ボタン列: x4 y30.875 幅 72 高さ 4');
  await page.close();
  await clearSettings();
});

// ---------------------------------------------------------------- /tv と同じ配置

test('/tv と同じ配置（1280x720 = 1u 16px）: 中央の 3 つは画面の真ん中・再生は 4u の円・速度/画質は右端・時間はバーの上の黒い帯', async () => {
  const page = await openWatch();
  await page.keyboard.press('ArrowDown'); // 操作画面（C）。ボタン列の再生にフォーカス
  await page.waitForTimeout(200);
  const g = await page.evaluate(() => {
    const R = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 100) / 100); };
    const q = (s) => document.querySelector(s);
    const btn = (label) => Array.from(document.querySelectorAll('[class*="VodController_buttons__"] button')).find((b) => (b.querySelector('svg')?.getAttribute('aria-label') || b.getAttribute('aria-label')) === label);
    const cs = (el) => getComputedStyle(el);
    const track = q('#sv-watch-ui .sv-w-track');
    const play = Array.from(document.querySelectorAll('[class*="VodController_buttons__"] button')).find((b) => /Play_icon/.test(b.className));
    return {
      back: R(btn('10秒戻る')), play: R(play), fwd: R(btn('10秒進む')), speed: R(btn('再生速度の選択')), quality: R(btn('画質を選択')),
      visible: Array.from(document.querySelectorAll('[class*="VodController_buttons__"] button')).filter((b) => b.getClientRects().length).length,
      title: R(q('#sv-watch-ui .sv-w-title')), titleFont: [cs(q('#sv-watch-ui .sv-w-title')).fontSize, cs(q('#sv-watch-ui .sv-w-title')).fontWeight, cs(q('#sv-watch-ui .sv-w-title')).lineHeight],
      titleBg: cs(q('#sv-watch-ui .sv-w-title span')).backgroundColor, sub: R(q('#sv-watch-ui .sv-w-sub')),
      track: R(track), trackBg: cs(track).backgroundColor, played: cs(q('#sv-watch-ui .sv-w-played')).backgroundColor,
      cur: R(q('#sv-watch-ui .sv-w-cur')), dur: R(q('#sv-watch-ui .sv-w-dur')), curBg: cs(q('#sv-watch-ui .sv-w-cur')).backgroundColor,
      playBg: cs(play).backgroundColor, playFg: cs(play).color, backBg: cs(btn('10秒戻る')).backgroundColor,
      focusRing: cs(play).outlineStyle,
    };
  });
  // 中央の 3 つ: 幅 3 + 0.75 + 4 + 0.75 + 3 = 11.5u（184px）で画面の真ん中（x 640）
  assert.equal(g.play[2], 64);
  assert.equal(g.play[3], 64);
  assert.equal(g.back[2], 48);
  assert.equal(g.fwd[2], 48);
  assert.equal(g.play[0] + g.play[2] / 2, 640, '再生ボタンの中心は画面の真ん中');
  assert.equal(g.fwd[0] - (g.back[0] + g.back[2]), 64 + 24, '「戻る」と「進む」の間 = 再生 4u + 余白 0.75u × 2');
  assert.equal(g.visible, 5, 'ボタンは 5 つだけ（音量・全画面は /tv にない）');
  assert.equal(g.speed[0] + g.speed[2] + 0 < g.quality[0] + g.quality[2], true);
  assert.equal(g.quality[0] + g.quality[2], 1216, '画質は右端（x 76u）');
  assert.equal(g.speed[3], 48, '速度・画質のピルは高さ 3u');
  // タイトル: 1.75u / 2.375u / 太字・黒い背景
  assert.equal(g.titleFont[0], '28px');
  assert.equal(g.titleFont[2], '38px');
  assert.ok(Number(g.titleFont[1]) >= 700);
  assert.equal(g.titleBg, 'rgb(0, 0, 0)');
  // 進行バー: 太さ 0.375u（6px）・時間は 0.875u の黒い帯
  assert.equal(g.track[3], 6);
  assert.equal(g.trackBg, 'rgb(96, 96, 96)');
  assert.equal(g.played, 'rgb(241, 241, 241)');
  assert.equal(g.curBg, 'rgb(0, 0, 0)');
  assert.ok(g.cur[1] < g.track[1], '時間はバーの上');
  assert.equal(g.dur[0] + g.dur[2], 1216, '全体の長さは右端');
  // フォーカス: 白地・黒い文字（リングではない）
  assert.equal(g.playBg, 'rgb(241, 241, 241)');
  assert.equal(g.playFg, 'rgb(15, 15, 15)');
  assert.equal(g.backBg, 'rgb(55, 55, 55)');
  assert.equal(g.focusRing, 'none');
  await page.close();
});

test('操作盤の出し入れは拡張の状態だけで決める（TVer 自身の表示タイマー・スクリム・トランジションは使わない。/tv にはアニメーションも暗い帯もない）', async () => {
  const page = await openWatch();
  const read = () =>
    page.evaluate(() => {
      const c = document.querySelector('[class*="VodController_container__"]');
      const cs = getComputedStyle(c);
      return { opacity: cs.opacity, transition: cs.transitionDuration, scrim: getComputedStyle(c, '::before').display, tverActive: c.classList.contains('VodController_active__Sjkyk') };
    });
  // H: TVer 自身は「表示中」（再生が始まると操作盤にフォーカスして 30 秒表示する）でも、拡張の状態（H）で隠れる
  const h = await read();
  assert.equal(h.tverActive, true, '（TVer 自身は表示のつもり）');
  assert.equal(h.opacity, '0');
  await press(page, 'ArrowDown', 100);
  const c = await read();
  assert.equal(c.opacity, '1');
  assert.equal(c.transition, '0s', 'フェードしない');
  assert.equal(c.scrim, 'none', '暗い帯（スクリム）はない');
  // C: TVer 自身が隠しても（操作盤内の Esc の処理）、拡張の状態（C）の間は出たまま（同じ瞬間に読む。拡張がフォーカスを戻すと TVer はまた表示する）
  const hidden = await page.evaluate(() => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    const c = document.querySelector('[class*="VodController_container__"]');
    return { tverActive: c.classList.contains('VodController_active__Sjkyk'), opacity: getComputedStyle(c).opacity };
  });
  assert.equal(hidden.tverActive, false, '（TVer 自身は隠した）');
  assert.equal(hidden.opacity, '1', '拡張の状態では出ている');
  assert.equal((await ui(page)).split('/')[0], 'C');
  await page.close();
});

// ---------------------------------------------------------------- キー操作（/tv の実測どおり）

test('H（非表示）: OK・↑・↓ は操作画面（再生にフォーカス）、← → は進行バーにフォーカスするだけでシークしない', async () => {
  const page = await openWatch();
  for (const k of ['Enter', 'ArrowUp', 'ArrowDown']) {
    await press(page, k, 150);
    assert.equal(await ui(page), 'C/row', k);
    assert.equal(await focused(page), '一時停止', k + ': 再生/一時停止にフォーカス');
    await press(page, 'Escape', 150);
    assert.equal((await ui(page)).split('/')[0], 'H', k + ' → 戻るで隠す');
  }
  const t0 = await vid(page, 'v.currentTime');
  await press(page, 'ArrowRight', 200);
  assert.equal(await ui(page), 'C/bar');
  assert.ok(Math.abs((await vid(page, 'v.currentTime')) - t0) < 1, 'シークしない');
  assert.equal(await vid(page, '!v.paused'), true, '再生はそのまま');
  await page.close();
});

test('TVer 自身のキー処理と二重にならない: ← → で ±10 秒・↑ ↓ で音量・Enter/Space で再生/一時停止は、拡張が止める', async () => {
  const page = await openWatch();
  await vid(page, '(v.currentTime = 20)');
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.__fx.log.length = 0; });
  const t0 = await vid(page, 'v.currentTime');
  await press(page, 'ArrowRight', 200); // H → C/bar（シークしない）
  await press(page, 'Escape', 150);
  await press(page, 'ArrowDown', 200); // → C/row
  await press(page, 'Escape', 150);
  await press(page, 'ArrowUp', 150);
  await press(page, 'Escape', 150);
  assert.equal(await vid(page, 'v.volume'), 1, '↑ ↓ で TVer が音量を変えない（音量はテレビのリモコン）');
  assert.ok((await vid(page, 'v.currentTime')) - t0 < 2, '← で TVer の ±10 秒が走らない');
  const keys = (await fxLog(page, 'key')).filter((l) => l.act);
  assert.deepEqual(keys, [], 'TVer の keydown ハンドラには何も届いていない: ' + JSON.stringify(keys));
  // 拡張が扱わないキー（f・m）は TVer にそのまま届く
  await press(page, 'm', 150);
  assert.equal(await vid(page, 'v.muted'), true, 'm（ミュート）は TVer 自身の処理');
  await press(page, 'm', 150);
  await page.close();
});

test('C: ↑ で進行バー → もう一度 ↑ で隠れる。↓ でボタン列。ボタン列は ← → で移動（端で止まる・音量と全画面は含まない）', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 150);
  assert.equal(await ui(page), 'C/row');
  const order = [];
  for (let i = 0; i < 5; i++) {
    order.push(await focused(page));
    await press(page, 'ArrowRight', 100);
  }
  assert.deepEqual(order, ['一時停止', '10秒進む', '再生速度の選択', '画質を選択', '画質を選択'], '再生 → +10 → 速度 → 画質 で止まる（折り返さない）');
  for (let i = 0; i < 6; i++) await press(page, 'ArrowLeft', 100);
  assert.equal(await focused(page), '10秒戻る', '左端で止まる');
  await press(page, 'ArrowUp', 150);
  assert.equal(await ui(page), 'C/bar');
  assert.equal(await focused(page), 'container');
  await press(page, 'ArrowDown', 150);
  assert.equal(await ui(page), 'C/row');
  await press(page, 'ArrowUp', 150);
  await press(page, 'ArrowUp', 150);
  assert.equal((await ui(page)).split('/')[0], 'H', '進行バーから ↑ で隠れる');
  await page.close();
});

test('OK: 進行バーなら再生/一時停止、ボタンならそのボタン（TVer 自身のボタンを押す）。Space・メディアキーでも', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 150); // C/row（再生）
  await press(page, 'Enter', 250);
  assert.equal(await vid(page, 'v.paused'), true, '再生ボタンの OK で一時停止');
  assert.equal(await page.evaluate(() => document.querySelector('[class*="Play_icon__"] svg').getAttribute('aria-label')), '再生', 'TVer の状態（ボタンの表示）も追随');
  await press(page, 'Enter', 250);
  assert.equal(await vid(page, 'v.paused'), false);
  await press(page, 'ArrowUp', 150); // 進行バー
  await press(page, 'Enter', 250);
  assert.equal(await vid(page, 'v.paused'), true, '進行バーの OK も再生/一時停止');
  await press(page, 'Space', 250);
  assert.equal(await vid(page, 'v.paused'), false, 'Space');
  const cdp = await env.ctx.newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'MediaPlayPause', code: 'MediaPlayPause', windowsVirtualKeyCode: 179 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'MediaPlayPause', code: 'MediaPlayPause', windowsVirtualKeyCode: 179 });
  await until(() => vid(page, 'v.paused'), { message: 'MediaPlayPause で一時停止' });
  assert.equal((await ui(page)).split('/')[0], 'C', 'メディアキーは操作画面を出す');
  // -10 / +10 のボタン
  await vid(page, '(v.currentTime = 30)');
  await page.waitForTimeout(150);
  for (let i = 0; i < 3; i++) await press(page, 'ArrowDown', 80);
  await press(page, 'ArrowDown', 150);
  await press(page, 'ArrowLeft', 100);
  assert.equal(await focused(page), '10秒戻る');
  await press(page, 'Enter', 300);
  assert.ok(Math.abs((await vid(page, 'v.currentTime')) - 20) < 1.5, '-10 秒');
  await page.close();
});

test('操作画面は最後のキーから 5 秒で隠れる。一時停止中は隠れない', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 100);
  assert.equal((await ui(page)).split('/')[0], 'C');
  await page.waitForTimeout(3500);
  assert.equal((await ui(page)).split('/')[0], 'C', '3.5 秒ではまだ出ている');
  await press(page, 'ArrowRight', 100); // キーで延長される（5 秒の起点が動く）
  await page.waitForTimeout(3500);
  assert.equal((await ui(page)).split('/')[0], 'C', '最後のキーから 3.5 秒');
  await until(async () => (await ui(page)).split('/')[0] === 'H', { timeout: 3000, message: '5 秒で隠れる' });
  // 一時停止中は隠れない
  await press(page, 'Space', 200);
  assert.equal(await vid(page, 'v.paused'), true);
  await page.waitForTimeout(5600);
  assert.equal((await ui(page)).split('/')[0], 'C', '一時停止中は出しっぱなし');
  // 再開すると隠れる側に戻る
  await press(page, 'Space', 200);
  await until(async () => (await ui(page)).split('/')[0] === 'H', { timeout: 7000, message: '再開後に隠れる' });
  await page.close();
});

test('スクラブ: 進行バーで → → → ＝ 10 秒ずつ（映像は止まる）。OK で確定して再生・隠れる。戻るで取り消し（位置はそのまま・再生が再開）', async () => {
  const page = await openWatch();
  await vid(page, '(v.currentTime = 10)');
  await page.waitForTimeout(250);
  await press(page, 'ArrowRight', 150); // H → C/bar
  await press(page, 'ArrowRight', 150); // S（+10 秒）
  assert.equal((await ui(page)).split('/')[0], 'S');
  assert.equal(await vid(page, 'v.paused'), true, '探している間は映像が止まる');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[class*="VodController_container__"]')).opacity), '0', 'S では操作盤（ボタン列）は隠れる');
  const label = () => page.evaluate(() => document.querySelector('#sv-watch-ui .sv-w-ptime').textContent);
  assert.equal(await label(), '0:20');
  await press(page, 'ArrowRight', 150);
  await press(page, 'ArrowRight', 150);
  assert.equal(await label(), '0:40');
  await press(page, 'ArrowLeft', 150);
  assert.equal(await label(), '0:30');
  const g = await page.evaluate(() => ({
    title: getComputedStyle(document.querySelector('#sv-watch-ui .sv-w-meta')).display,
    times: getComputedStyle(document.querySelector('#sv-watch-ui .sv-w-times')).display,
    played: getComputedStyle(document.querySelector('#sv-watch-ui .sv-w-played')).backgroundImage,
    preview: getComputedStyle(document.querySelector('#sv-watch-ui .sv-w-preview')).display,
  }));
  assert.equal(g.title, 'none', 'S ではタイトルが隠れる');
  assert.equal(g.times, 'none', 'S では時間の表示が隠れる');
  assert.match(g.played, /linear-gradient/, '進行バーは赤のグラデーション（フォーカスの見た目）');
  assert.notEqual(g.preview, 'none');
  assert.ok(Math.abs((await vid(page, 'v.currentTime')) - 10) < 1, '確定するまで位置は動かない');
  await press(page, 'Enter', 400);
  const t = await vid(page, 'v.currentTime');
  assert.ok(t >= 30 && t < 32, '確定: 0:30 から再生: ' + t);
  assert.equal(await vid(page, 'v.paused'), false, '確定すると再生する');
  assert.equal((await ui(page)).split('/')[0], 'H', '確定すると隠れる');

  // 取り消し
  await press(page, 'ArrowLeft', 150); // C/bar
  await press(page, 'ArrowLeft', 150); // S（-10 秒）
  assert.equal((await ui(page)).split('/')[0], 'S');
  const before = await vid(page, 'v.currentTime');
  await press(page, 'Escape', 300);
  assert.equal(await ui(page), 'C/bar', '取り消すと進行バーにフォーカスした操作画面に戻る');
  assert.ok(Math.abs((await vid(page, 'v.currentTime')) - before) < 2, '位置はそのまま');
  assert.equal(await vid(page, 'v.paused'), false, '再生が再開する');
  await page.close();
});

test('スクラブは 0〜動画の長さに収まる', async () => {
  const page = await openWatch();
  await vid(page, '(v.currentTime = 5)');
  await page.waitForTimeout(250);
  await press(page, 'ArrowLeft', 150);
  await press(page, 'ArrowLeft', 150);
  assert.equal(await page.evaluate(() => document.querySelector('#sv-watch-ui .sv-w-ptime').textContent), '0:00', '先頭で止まる');
  for (let i = 0; i < 8; i++) await press(page, 'ArrowRight', 120);
  const dur = await vid(page, 'v.duration');
  assert.equal(await page.evaluate(() => document.querySelector('#sv-watch-ui .sv-w-ptime').textContent), `${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}`, '末尾で止まる');
  await press(page, 'Escape', 200);
  await page.close();
});

test('スクラブは押しっぱなし（キーリピート）でも動く。間隔が空くと加速しない', async () => {
  const page = await openWatch();
  await vid(page, '(v.currentTime = 1)');
  await page.waitForTimeout(250);
  await press(page, 'ArrowRight', 150); // C/bar
  await press(page, 'ArrowRight', 150); // S +10
  // リピート: 同じキーの down を続けて送る（2 回目以降は repeat = true）。拡張は毎秒 12 回までに間引く
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 3; i++) {
    await page.waitForTimeout(100);
    await page.keyboard.down('ArrowRight');
  }
  await page.keyboard.up('ArrowRight');
  const label = await page.evaluate(() => document.querySelector('#sv-watch-ui .sv-w-ptime').textContent);
  const sec = Number(label.split(':')[1]);
  assert.ok(sec >= 31 && sec <= 51, 'リピートでも 10 秒ずつ進む（最初の 14 回は一定）: ' + label);
  await press(page, 'Escape', 200);
  await page.close();
});

test('広告中はスクラブしない（広告のスキップは提供しない）。広告が終われば使える', async () => {
  const page = await openWatch();
  await vid(page, '(v.currentTime = 20)');
  await page.evaluate(() => document.querySelector('.video-js').classList.add('vjs-ad-playing'));
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-ad')), { message: 'sv-ad' });
  await press(page, 'ArrowRight', 150);
  await press(page, 'ArrowRight', 200);
  assert.equal(await ui(page), 'C/bar', '広告中は ← → でスクラブに入らない');
  assert.equal(await vid(page, 'v.paused'), false);
  assert.ok(Math.abs((await vid(page, 'v.currentTime')) - 20) < 2);
  await page.evaluate(() => document.querySelector('.video-js').classList.remove('vjs-ad-playing'));
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('sv-ad')), { message: 'ad off' });
  await press(page, 'ArrowRight', 200);
  assert.equal((await ui(page)).split('/')[0], 'S', '広告が終われば使える');
  await press(page, 'Escape', 200);
  await page.close();
});

test('広告中は、本編が止まっていても操作画面は 5 秒で隠れる（広告の再生を操作盤が覆い続けない）', async () => {
  const page = await openWatch();
  await page.evaluate(() => document.querySelector('.video-js').classList.add('vjs-ad-playing'));
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-ad')), { message: 'sv-ad' });
  await vid(page, 'v.pause()'); // 広告の間、本編の video は止まっていることがある
  await press(page, 'ArrowDown', 150);
  assert.equal((await ui(page)).split('/')[0], 'C');
  await until(async () => (await ui(page)).split('/')[0] === 'H', { timeout: 7500, message: '広告中は一時停止でも 5 秒で隠れる' });
  await page.close();
});

// ---------------------------------------------------------------- 再生速度・画質

test('再生速度: OK でポップアップ（1 列・白いフォーカス）→ ↑ ↓ でフォーカスを動かす（TVer/Radix 自身が処理）→ OK で選んで閉じる', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 150);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  assert.equal(await focused(page), '再生速度の選択');
  await press(page, 'Enter', 250);
  assert.equal((await fxState(page)).popup, true);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('role')), 'radio', 'TVer が現在の速度にフォーカスする');
  const g = await page.evaluate(() => ({
    cols: getComputedStyle(document.querySelector('[class*="Speed_radio__"]')).gridTemplateColumns.split(' ').length,
    bg: getComputedStyle(document.activeElement.closest('label')).backgroundColor,
  }));
  assert.equal(g.cols, 1, '2 列のグリッドを 1 列にする（↑ ↓ が見た目と一致する）');
  assert.equal(g.bg, 'rgb(241, 241, 241)', 'フォーカス中の項目は白地（/tv と同じ）');
  await press(page, 'ArrowUp', 200);
  await press(page, 'ArrowUp', 200);
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '再生速度 1.50', '↑ ↑ でフォーカスが 1.25 → 1.50 へ（Radix の矢印キーがそのまま効く）');
  assert.equal(await vid(page, 'v.playbackRate'), 1, '矢印では選ばれない（TVer の仕様）');
  await press(page, 'Enter', 300); // 拡張: フォーカス中の項目を選んで閉じる
  assert.equal(await vid(page, 'v.playbackRate'), 1.5, 'OK で選ぶ');
  assert.equal((await fxState(page)).popup, false, 'OK で閉じる');
  assert.equal(await focused(page), '再生速度の選択', 'フォーカスは速度ボタンに戻る');
  assert.equal(await page.evaluate(() => document.querySelector('[class*="Speed_label__"]').textContent), 'x1.50');
  await page.close();
});

test('ポップアップは戻るで閉じる（Backspace などの Esc 以外の戻るキーも）。閉じても操作画面は残る', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 150);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  assert.equal(await focused(page), '画質を選択');
  await press(page, 'Enter', 250);
  assert.equal((await fxState(page)).popup, true);
  await press(page, 'Backspace', 300);
  assert.equal((await fxState(page)).popup, false);
  assert.equal((await ui(page)).split('/')[0], 'C');
  assert.equal(await focused(page), '画質を選択');
  await press(page, 'Enter', 250);
  await press(page, 'Escape', 300);
  assert.equal((await fxState(page)).popup, false, 'Esc も同じ');
  assert.equal((await ui(page)).split('/')[0], 'C');
  await page.close();
});

test('ポップアップを開いている間は隠れない。閉じたあとは、最後のキーから 5 秒で隠れる', async () => {
  const page = await openWatch();
  await press(page, 'ArrowDown', 150);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  await press(page, 'Enter', 250);
  assert.equal((await fxState(page)).popup, true);
  await page.waitForTimeout(5800); // 5 秒を過ぎても、ポップアップを開いている間は操作画面が残る
  assert.equal((await fxState(page)).popup, true);
  assert.equal((await ui(page)).split('/')[0], 'C', '開いている間は隠れない');
  await press(page, 'Escape', 300);
  assert.equal((await fxState(page)).popup, false);
  assert.equal((await ui(page)).split('/')[0], 'C', '閉じた直後はまだ出ている');
  await until(async () => (await ui(page)).split('/')[0] === 'H', { timeout: 7000, message: '閉じたあと 5 秒で隠れる' });
  // 選んで閉じた場合も同じ
  await press(page, 'ArrowDown', 150);
  await press(page, 'ArrowRight', 100);
  await press(page, 'ArrowRight', 100);
  await press(page, 'Enter', 250);
  await press(page, 'Enter', 300); // 選んで閉じる
  assert.equal((await fxState(page)).popup, false);
  await until(async () => (await ui(page)).split('/')[0] === 'H', { timeout: 7000, message: '選んで閉じたあとも 5 秒で隠れる' });
  await page.close();
});

// ---------------------------------------------------------------- 全画面・戻る・離れる

test('TVer 自身の f（全画面の切り替え）と干渉しない: 全画面を出入りしても視聴画面は保たれ、劇場表示になる', async () => {
  const page = await openWatch();
  assert.equal((await fxState(page)).fullscreen, true);
  await press(page, 'f', 400);
  assert.equal((await fxState(page)).fullscreen, false, 'f で TVer が全画面を解除');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), true, '視聴画面はそのまま');
  assert.deepEqual(await rect(page, '[js-fullscreen-target]'), [0, 0, 1280, 720], '劇場表示で画面いっぱい');
  assert.equal(await page.evaluate(() => document.querySelector('[class*="VodController_container__"]').getAttribute('data-fullscreen')), 'false');
  await press(page, 'f', 400);
  assert.equal((await fxState(page)).fullscreenIsHost, true, 'もう一度 f で全画面');
  assert.equal(await vid(page, '!v.paused'), true, '再生は止まらない');
  assert.equal(await ui(page), 'H/row', '状態は変わらない');
  await page.close();
});

test('戻る: 操作画面 → 隠す → 画面を離れる（全画面も終わり、前のページへ）', async () => {
  const prev = await env.ctx.newPage();
  await prev.goto('https://tver.jp/episodes/prev');
  await tverReady(prev);
  await prev.goto('https://tver.jp/episodes/eptest');
  await tverReady(prev);
  await until(() => prev.evaluate(() => document.activeElement?.id === 'episode-play'));
  await prev.keyboard.press('Enter');
  await until(() => prev.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await press(prev, 'ArrowDown', 150);
  assert.equal((await ui(prev)).split('/')[0], 'C');
  await press(prev, 'Escape', 150);
  assert.equal((await ui(prev)).split('/')[0], 'H');
  assert.equal(prev.url(), 'https://tver.jp/episodes/eptest', '1 回目は隠すだけ');
  assert.equal(await vid(prev, '!v.paused'), true, '再生は続く');
  await press(prev, 'Escape', 100);
  await prev.waitForURL('https://tver.jp/episodes/prev');
  await prev.close();
});

test('スクラブの途中で画面を離れる（停止キー）と、映像は再開しない。戻った先で音が鳴らない', async () => {
  // TVer は SPA なので、同じページの中で「前の画面」へ戻る。履歴の 1 つ前を別の URL にしておく
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/episodes/eptest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.evaluate(() => {
    history.replaceState(null, '', '/');
    history.pushState(null, '', '/episodes/eptest');
  });
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'sv-watch' });
  await until(() => vid(page, '!v.paused && v.currentTime > 0.1'), { message: 'playing' });
  await press(page, 'ArrowRight', 150);
  await press(page, 'ArrowRight', 150);
  assert.equal((await ui(page)).split('/')[0], 'S');
  assert.equal(await vid(page, 'v.paused'), true, '探している間は止まっている');
  const cdp = await env.ctx.newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'MediaStop', code: 'MediaStop', windowsVirtualKeyCode: 178 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'MediaStop', code: 'MediaStop', windowsVirtualKeyCode: 178 });
  await until(() => page.evaluate(() => location.pathname === '/'), { message: '前の画面へ戻る' });
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('sv-watch')), { message: '視聴画面が終わる' });
  await page.waitForTimeout(1200);
  assert.equal(await vid(page, 'v.paused'), true, '離れたあとに再生が再開しない（スクラブの取り消しで再生しない）');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svUi), undefined, '視聴画面の状態が残らない');
  await page.close();
});

test('再生前のポスターでは、戻るは普通に前のページへ（視聴画面ではない）。Home はハブへ', async () => {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/episodes/prev2');
  await tverReady(page);
  await page.goto('https://tver.jp/episodes/eptest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.keyboard.press('Escape');
  await page.waitForURL('https://tver.jp/episodes/prev2');
  await page.goto('https://tver.jp/episodes/eptest');
  await tverReady(page);
  await until(() => page.evaluate(() => document.activeElement?.id === 'episode-play'));
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await page.keyboard.press('Home');
  await page.waitForURL(env.hubUrl);
  await page.close();
});

// ---------------------------------------------------------------- 再生が終わる・モーダル

test('再生が終わる: 次のエピソードの案内（TVer 自身）が劇場表示の中に出る。OK で次のエピソードへ', async () => {
  const page = await openWatch('/episodes/endsoon');
  await vid(page, '(v.currentTime = v.duration - 1.2)');
  await until(() => vid(page, 'v.ended'), { timeout: 8000, message: 'ended' });
  await until(() => page.evaluate(() => !!document.querySelector('[js-fullscreen-target] button[aria-label$="を再生"]')), { message: '次のエピソードの案内' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), true, '視聴画面（劇場表示）のまま');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-ended')), true);
  assert.equal(await page.evaluate(() => !document.querySelector('#sv-watch-ui') || getComputedStyle(document.querySelector('#sv-watch-ui .sv-w-meta')).display === 'none'), true, '拡張の覆い（タイトル・進行バー）は出ない');
  const r = await rect(page, '[class*="NextEpisodeThumbnail_nextEpisodeThumbnail__"]');
  assert.deepEqual(r, [0, 0, 1280, 720], '案内が画面いっぱいに見える（TVer の表示が隠されていない）');
  await press(page, 'ArrowLeft', 150);
  await press(page, 'ArrowDown', 150);
  assert.equal((await fxLog(page, 'navigate')).length, 0, '矢印では何も起きない');
  assert.equal((await fxState(page)).next, true, '案内はそのまま');
  await press(page, 'Enter', 500); // OK = 再生ボタン（次のエピソード）
  assert.equal((await fxLog(page, 'navigate')).length, 1, 'OK で次のエピソードへ');
  await page.close();
});

test('再生が終わる: 戻る 1 回で TVer が自動再生を止めてプレイヤーを初期状態（ポスター）へ戻す（全画面も終わる）。OK で見直せる', async () => {
  const page = await openWatch('/episodes/endsoon');
  await vid(page, '(v.currentTime = v.duration - 1.2)');
  await until(() => vid(page, 'v.ended'), { timeout: 8000, message: 'ended' });
  await until(() => page.evaluate(() => !!document.querySelector('[js-fullscreen-target] button[aria-label$="を再生"]')), { message: '次のエピソードの案内' });
  assert.equal((await fxState(page)).fullscreen, true);
  await press(page, 'Escape', 600); // TVer の「閉じる」を押す
  assert.equal((await fxLog(page, 'next-cancel')).length, 1);
  assert.equal((await fxLog(page, 'reset')).length, 1, 'TVer がプレイヤーを初期状態へ戻す（実サイトと同じ）');
  const s = await fxState(page);
  assert.equal(s.view, 'poster', 'ポスター（再生ボタン）に戻る');
  assert.equal(s.fullscreen, false, '全画面も終わる');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch') || document.documentElement.classList.contains('sv-ended')), false, '視聴画面は終わる（ページの普通の操作）');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'episode-play', '再生ボタンにフォーカス');
  await page.waitForTimeout(3500);
  assert.equal((await fxLog(page, 'navigate')).length, 0, '止めたので自動では進まない');
  assert.equal(page.url(), 'https://tver.jp/episodes/endsoon');
  // OK = もう一度見る
  await press(page, 'Enter', 400);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: '見直すと視聴画面' });
  await until(() => vid(page, '!v.paused && v.currentTime < 5'), { message: '最初から再生' });
  assert.equal((await fxState(page)).fullscreenIsHost, true, '見直すときも TVer の全画面');
  assert.deepEqual(page.__errors || [], []);
  await page.close();
});

test('再生が終わる: 「閉じる」のあとも案内が残る場合、2 回目の戻るで画面を離れる（同じ案内に戻り続けない）', async () => {
  const prev = await env.ctx.newPage();
  await prev.goto('https://tver.jp/episodes/prev3');
  await tverReady(prev);
  await prev.goto('https://tver.jp/episodes/keeppanel');
  await tverReady(prev);
  await until(() => prev.evaluate(() => document.activeElement?.id === 'episode-play'));
  await prev.keyboard.press('Enter');
  await until(() => prev.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await until(() => vid(prev, '!v.paused && v.currentTime > 0.1'));
  await vid(prev, '(v.currentTime = v.duration - 1.2)');
  await until(() => vid(prev, 'v.ended'), { timeout: 8000 });
  await until(() => prev.evaluate(() => !!document.querySelector('[js-fullscreen-target] button[aria-label$="を再生"]')));
  await press(prev, 'Escape', 400); // 1 回目: 自動再生を止める（案内は残る）
  assert.equal((await fxLog(prev, 'next-cancel')).length, 1);
  assert.equal((await fxState(prev)).next, true, '案内が残る');
  assert.equal(prev.url(), 'https://tver.jp/episodes/keeppanel');
  await press(prev, 'Escape', 100); // 2 回目: 離れる
  await prev.waitForURL('https://tver.jp/episodes/prev3');
  await prev.close();
});

test('再生が終わる: 何も押さなければ、TVer のカウントダウンで次へ進む（拡張は邪魔しない）', async () => {
  const page = await openWatch('/episodes/endsoon');
  await vid(page, '(v.currentTime = v.duration - 1.2)');
  await until(() => vid(page, 'v.ended'), { timeout: 8000 });
  await until(async () => (await fxLog(page, 'navigate')).length === 1, { timeout: 8000, message: 'auto navigate' });
  await page.close();
});

test('アンケート（サイトのモーダル）が出ている間は、視聴画面は関与しない。回答して再生が始まると視聴画面になる', async () => {
  const page = await openEpisode('/episodes/quest');
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => !!document.querySelector('[role="dialog"][data-state="open"] form')), { message: 'アンケート' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), false);
  await until(() => page.evaluate(() => !!document.getElementById('sv-osk')), { message: '自動で画面上のキーボードが開く' });
  await page.keyboard.type('1990');
  assert.equal(await page.evaluate(() => document.querySelector('input[name="birthYear"]').value), '1990', 'キー入力はモーダルへ');
  await page.keyboard.press('Escape'); // キーボードを閉じる（入れた値は残る）
  await page.keyboard.press('ArrowLeft'); // モーダルの中の矢印は、視聴画面にも空間ナビにも奪われない
  await page.locator('button[type="submit"]').click();
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: '回答後に視聴画面' });
  assert.equal((await fxState(page)).fullscreenIsHost, true, '回答のクリックの直後なので全画面にもなれる');
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('アンケート: 誕生年を入れるとサイトが誕生月へフォーカスを移し、モーダルは外へのフォーカスを戻す。それでも画面上のキーボードは矢印・OKで操作できる（リモコン）', async () => {
  const page = await openEpisode('/episodes/quest');
  await page.evaluate(() => localStorage.removeItem('fx-questionnaire')); // 回答済みでも、毎回アンケートを出す
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => !!document.getElementById('sv-osk')), { message: '自動で画面上のキーボードが開く' });
  const inOsk = () => page.evaluate(() => !!document.activeElement.closest('#sv-osk'));
  const keyAt = () => page.evaluate(() => document.activeElement.textContent.trim());
  await until(inOsk, { message: 'キーボードにフォーカス' });
  // 数字キーを矢印と OK で打つ（リモコンと同じ）: 1 → 9 → 9 → 0
  const goTo = async (label) => {
    for (let i = 0; i < 20 && (await keyAt()) !== label; i++) {
      const d = await page.evaluate((label) => {
        const t = Array.from(document.querySelectorAll('#sv-osk .sv-osk-key')).find((k) => k.textContent.trim() === label).getBoundingClientRect();
        const a = document.activeElement.getBoundingClientRect();
        return { dx: t.left - a.left, dy: t.top - a.top };
      }, label);
      await page.keyboard.press(Math.abs(d.dy) > 8 ? (d.dy > 0 ? 'ArrowDown' : 'ArrowUp') : d.dx > 0 ? 'ArrowRight' : 'ArrowLeft');
    }
    assert.equal(await keyAt(), label);
  };
  for (const c of '1990') {
    await goTo(c);
    await page.keyboard.press('Enter');
  }
  assert.equal(await page.evaluate(() => document.querySelector('input[name="birthYear"]').value), '1990');
  assert.equal(await inOsk(), true, 'サイトが誕生月へフォーカスを移しても、キーボードのフォーカスは戻らない');
  await goTo('完了');
  await page.keyboard.press('Enter');
  await until(() => page.evaluate(() => /誕生月/.test(document.querySelector('#sv-osk .sv-osk-title')?.textContent || '')), { message: '次の欄（誕生月）のキーボード' });
  assert.equal(await inOsk(), true);
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('自動再生で始まる場合（ユーザー操作なし）: 視聴画面にはなるが、全画面は最初のキー操作で入る（拒否されて例外にならない）', async () => {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto('https://tver.jp/episodes/auto'); // 6.5 秒後に自動で再生が始まる
  await tverReady(page);
  // Playwright の page.evaluate は「ユーザー操作」の扱い（約 5 秒の窓ができる）になるので、再生が始まるまで何も評価せずに待つ
  await page.waitForTimeout(9500);
  const early = await page.evaluate(() => ({
    watch: document.documentElement.classList.contains('sv-watch'),
    fullscreen: !!document.fullscreenElement,
    toggles: window.__fx.log.filter((l) => l.ev === 'fullscreen-toggle').length,
  }));
  assert.equal(early.watch, true, '自動再生で視聴画面になる');
  assert.equal(early.fullscreen, false, 'ユーザー操作なしでは全画面にしない');
  assert.equal(early.toggles, 0, '拒否されるリクエストを出さない');
  assert.deepEqual(page.__errors, []);
  await page.keyboard.press('ArrowDown'); // 最初のキー操作
  await until(async () => (await fxState(page)).fullscreenIsHost, { message: '最初のキーで全画面' });
  assert.equal((await ui(page)).split('/')[0], 'C');
  assert.deepEqual(page.__errors, []);
  await page.close();
});
