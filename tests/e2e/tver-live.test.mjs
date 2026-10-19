// リアルタイム配信（/live/局）の E2E。再現ページ（tests/fixtures/tver.mjs の liveHtml + tver-player.mjs の live: true）は、
// 実サイトの構造（チャンネルのタブ・プレイヤー・番組表、LiveController）を再現している（docs/SPEC.md 7.5）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, until, press, FIXTURES, tverReady } from './helpers.mjs';
import { liveHtml } from '../fixtures/tver.mjs';

const VIDEO = fs.readFileSync(path.join(FIXTURES, 'media', 'test.webm'));
let env;

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
        return route.fulfill({ status: 206, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${VIDEO.length}` }, body: VIDEO.subarray(start, end + 1) });
      }
      return route.fulfill({ status: 200, headers: { 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' }, body: VIDEO });
    }
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: liveHtml() });
  });
});
test.after(async () => {
  await env.close();
});

const vid = (page, expr) => page.evaluate(`(() => { const v = document.querySelector('video'); return ${expr}; })()`);
const ui = (page) => page.evaluate(() => `${document.documentElement.dataset.svUi}/${document.documentElement.dataset.svFocus}`);
const fxState = (page) => page.evaluate(() => window.__fx.state());
const fxLog = (page, ev) => page.evaluate((ev) => window.__fx.log.filter((l) => l.ev === ev), ev);
const focused = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    if (a.matches('[data-fullscreen]')) return 'controller';
    return (a.querySelector && a.querySelector('svg')?.getAttribute('aria-label')) || a.getAttribute('aria-label') || a.getAttribute('data-id') || a.tagName;
  });

/** チャンネルのページを開く。再生は自動で始まる（実サイトと同じ）。 */
async function openLive() {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto('https://tver.jp/live/ntv');
  await tverReady(page);
  await until(() => vid(page, '!v.paused && v.currentTime > 0.1'), { message: '自動再生' });
  await until(() => page.evaluate(() => !!document.querySelector('[data-fullscreen]')), { message: '操作盤' });
  await page.waitForTimeout(300);
  return page;
}

/** プレイヤー（操作盤）にフォーカスが来るまで ↓ で降りる。 */
async function focusPlayer(page) {
  for (let i = 0; i < 6 && (await focused(page)) !== 'controller'; i++) await press(page, 'ArrowDown', 150);
  assert.equal(await focused(page), 'controller', 'プレイヤーにフォーカスできる');
}

test('チャンネルのページ: 開いただけでは視聴画面（劇場表示）にならない。自動再生は続き、タブ・番組表を使える', async () => {
  const page = await openLive();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.svPage), 'live');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-watch')), false, '視聴画面ではない');
  assert.equal(await vid(page, '!v.paused'), true, '再生は続く');
  const r = await page.evaluate(() => { const b = document.querySelector('[js-fullscreen-target]').getBoundingClientRect(); return [b.width, b.height]; });
  assert.ok(r[0] < 1280, 'ページの中のプレイヤー（画面いっぱいではない）: ' + r);
  assert.match((await focused(page)) || '', /^tab\d$/, '初期フォーカスはチャンネルのタブ');
  await press(page, 'ArrowRight', 150);
  assert.equal(await focused(page), 'tab1', '← → で局を切り替える（タブ）');
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('プレイヤーで OK → 視聴画面（全画面・劇場表示）。LIVE の表示・タイトル。進行バーと時間はない', async () => {
  const page = await openLive();
  await focusPlayer(page);
  await press(page, 'Enter', 400);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'sv-watch' });
  assert.equal((await fxState(page)).fullscreenIsHost, true, 'TVer 自身の全画面');
  assert.equal(await ui(page), 'H/row', '最初は操作盤が隠れている');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('sv-live')), true);
  await press(page, 'ArrowDown', 150);
  assert.equal((await ui(page)).split('/')[0], 'C');
  const g = await page.evaluate(() => {
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    const ctl = document.querySelector('[data-fullscreen]');
    const play = ctl.querySelector('[class*="Play_icon__"]').getBoundingClientRect();
    return {
      opacity: cs('[data-fullscreen]').opacity,
      badge: cs('#sv-watch-ui .sv-w-livebadge').display,
      progress: cs('#sv-watch-ui .sv-w-progress').display,
      liveLabel: cs('[class*="LiveController_liveLabel__"]').display,
      title: document.querySelector('#sv-watch-ui .sv-w-title span').textContent,
      sub: document.querySelector('#sv-watch-ui .sv-w-sub span').textContent,
      playCenter: play.left + play.width / 2,
      win: innerWidth,
      visible: Array.from(ctl.querySelectorAll('button')).filter((b) => b.getClientRects().length).length,
    };
  });
  assert.equal(g.opacity, '1', '操作画面（C）で操作盤が見える（LiveController にも /tv の見た目）');
  assert.notEqual(g.badge, 'none', 'LIVE のバッジ');
  assert.equal(g.progress, 'none', '進行バーは出さない');
  assert.equal(g.liveLabel, 'none', 'TVer 自身の LIVE 表示は隠す（覆いのバッジに置き換える）');
  assert.equal(g.title, 'テスト番組（リアルタイム）');
  assert.match(g.sub, /テスト放送局/);
  assert.ok(Math.abs(g.playCenter - g.win / 2) < 3, '停止ボタンは画面の真ん中: ' + g.playCenter);
  assert.equal(g.visible, 2, '停止・画質（音量と全画面は /tv にない）');
  await page.close();
});

test('停止ボタンは、進行バーの OK・メディアキーでは押さない（押すと配信が終わるため）。ボタンに合わせた OK だけが押す', async () => {
  const page = await openLive();
  await focusPlayer(page);
  await press(page, 'Enter', 400);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await press(page, 'ArrowDown', 150); // C/row（停止）
  assert.equal(await focused(page), '停止');
  await press(page, 'ArrowUp', 150); // 進行バー
  assert.equal(await ui(page), 'C/bar');
  await press(page, 'Enter', 300);
  assert.equal((await fxLog(page, 'dispose')).length, 0, '進行バーの OK では停止しない');
  const cdp = await env.ctx.newCDPSession(page);
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'MediaPlayPause', code: 'MediaPlayPause', windowsVirtualKeyCode: 179 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'MediaPlayPause', code: 'MediaPlayPause', windowsVirtualKeyCode: 179 });
  await page.waitForTimeout(300);
  assert.equal((await fxLog(page, 'dispose')).length, 0, 'メディアキーでも停止しない');
  assert.equal(await vid(page, '!v.paused'), true);
  // ← → はシークしない（ライブ）
  await press(page, 'ArrowRight', 200);
  assert.equal((await ui(page)).split('/')[0], 'C', 'スクラブに入らない');
  assert.equal(await vid(page, '!v.paused'), true);
  // ボタンに合わせて OK = 停止
  await press(page, 'ArrowDown', 150);
  assert.equal(await focused(page), '停止');
  await press(page, 'Enter', 400);
  assert.equal((await fxLog(page, 'dispose')).length, 1, '停止ボタンの OK で配信を止める（TVer 自身の動き）');
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('sv-watch')), { message: '操作盤が消えたら視聴画面も終わる' });
  await page.close();
});

test('戻る: 操作画面 → 隠す → 視聴画面をやめてページに戻る（配信は続く・全画面は終わる・履歴は戻らない）。そこから局の切り替えへ', async () => {
  const page = await openLive();
  await focusPlayer(page);
  await press(page, 'Enter', 400);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')));
  await press(page, 'ArrowDown', 150);
  await press(page, 'Escape', 200);
  assert.equal((await ui(page)).split('/')[0], 'H');
  assert.equal(await page.evaluate(() => location.pathname), '/live/ntv', '1 回目は隠すだけ');
  await press(page, 'Escape', 600);
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('sv-watch')), { message: '視聴画面が終わる' });
  assert.equal(await page.evaluate(() => location.pathname), '/live/ntv', 'ページは変わらない');
  assert.equal((await fxState(page)).fullscreen, false, '全画面は終わる');
  assert.equal(await vid(page, '!v.paused'), true, '配信は続く');
  assert.equal(await focused(page), 'controller', 'プレイヤーにフォーカスが残る');
  for (let i = 0; i < 6 && !/^tab\d$/.test((await focused(page)) || ''); i++) await press(page, 'ArrowUp', 150);
  assert.match((await focused(page)) || '', /^tab\d$/, '↑ でタブへ戻れる（局を切り替えられる）');
  // もう一度入れる
  await focusPlayer(page);
  await press(page, 'Enter', 400);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'もう一度視聴画面へ' });
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('TVer 自身の全画面（f）でも視聴画面になる。全画面を終えると、ページに戻る', async () => {
  const page = await openLive();
  await focusPlayer(page);
  await press(page, 'f', 500);
  await until(() => page.evaluate(() => document.documentElement.classList.contains('sv-watch')), { message: 'f の全画面で視聴画面' });
  await press(page, 'f', 500);
  await until(() => page.evaluate(() => !document.documentElement.classList.contains('sv-watch')), { message: '全画面を終えるとページに戻る' });
  assert.equal(await page.evaluate(() => location.pathname), '/live/ntv');
  await page.close();
});

test('番組表の番組（/live/simul/…）へも、方向キーで行ける', async () => {
  const page = await openLive();
  await focusPlayer(page);
  for (let i = 0; i < 4 && !/^tl\d$/.test((await focused(page)) || ''); i++) await press(page, 'ArrowRight', 150);
  assert.match((await focused(page)) || '', /^tl\d$/, '→ で右の番組表へ');
  await page.close();
});
