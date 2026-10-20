// スマホのリモコン: YouTube /tv のタブが受け取ったキー（dpadCommand の合成イベント）を、前面の TVer・ハブへ渡す。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, active, until, tverReady } from './helpers.mjs';
import { homeHtml, episodeHtml } from '../fixtures/tver.mjs';

let env;
test.before(async () => {
  env = await launch();
  await env.ctx.route('https://www.youtube.com/tv**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>yt stub</title><body><h1>stub</h1></body>' }),
  );
  await env.ctx.route('https://tver.jp/**', (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname === '/' ? homeHtml() : u.pathname.startsWith('/episodes/') ? episodeHtml() : '<!doctype html><title>other</title><main></main>';
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });
});
test.after(async () => {
  await env.close();
});

/** YouTube /tv が dpadCommand で出すイベントと同じもの（合成・key なし・keyCode のみ）を、YouTube のタブで出す。 */
async function phoneKey(yt, keyCode) {
  await yt.evaluate((kc) => {
    const e = document.createEvent('Event');
    e.initEvent('keydown', true, true);
    e.keyCode = kc;
    (document.activeElement || document.body).dispatchEvent(e);
  }, keyCode);
}
const UP = 38, DOWN = 40, LEFT = 37, RIGHT = 39, ENTER = 13, BACK = 27;

async function setup() {
  const tver = await env.ctx.newPage();
  await tver.goto('https://tver.jp/');
  await tverReady(tver);
  await until(async () => (await active(tver)) !== null, { message: 'TVer の初期フォーカス' });
  const yt = await env.ctx.newPage();
  await yt.goto('https://www.youtube.com/tv');
  await until(() => yt.evaluate(() => document.documentElement.classList.contains('sv-yt')), { message: 'YouTube の拡張が読み込まれる' });
  await tver.bringToFront();
  return { tver, yt };
}

test('スマホのリモコン: YouTube のタブで受け取った十字キーが、前面の TVer を動かす。決定でリンクを開き、戻るで戻る', async () => {
  const { tver, yt } = await setup();
  const before = (await active(tver)).sv;
  await phoneKey(yt, RIGHT);
  await until(async () => (await active(tver)).sv !== before, { message: '右へ移動' });
  const moved = (await active(tver)).sv;
  await phoneKey(yt, LEFT);
  await until(async () => (await active(tver)).sv === before, { message: '左で戻る' });
  await phoneKey(yt, DOWN);
  await until(async () => (await active(tver)).sv !== before, { message: '下へ移動' });
  await phoneKey(yt, UP);
  await until(async () => (await active(tver)).sv === before, { message: '上で戻る' });
  assert.notEqual(moved, before);

  await phoneKey(yt, ENTER);
  await tver.waitForURL(/\/episodes\//, { timeout: 8000 });
  await phoneKey(yt, BACK);
  await tver.waitForURL('https://tver.jp/', { timeout: 8000 });
  await tver.close();
  await yt.close();
});

test('スマホのリモコン: 前面が YouTube のタブのときは、TVer へ渡さない。実際のキーボードの合成でない操作・key のある合成イベントは対象外', async () => {
  const { tver, yt } = await setup();
  const before = (await active(tver)).sv;
  await yt.bringToFront();
  await phoneKey(yt, RIGHT);
  await yt.waitForTimeout(500);
  await tver.bringToFront();
  assert.equal((await active(tver)).sv, before, '前面でない TVer は動かさない');
  // key を持つ合成イベント（拡張や他のスクリプトが出すもの）は、リモコンとして扱わない
  await yt.evaluate(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', keyCode: 39, bubbles: true })));
  await yt.waitForTimeout(500);
  assert.equal((await active(tver)).sv, before);
  await tver.close();
  await yt.close();
});

test('スマホのリモコン: ハブも動かせる', async () => {
  const hub = await env.ctx.newPage();
  await hub.goto(env.hubUrl);
  await until(() => hub.evaluate(() => document.documentElement.dataset.svReady === '1'), { message: 'hub ready' });
  const yt = await env.ctx.newPage();
  await yt.goto('https://www.youtube.com/tv');
  await until(() => yt.evaluate(() => document.documentElement.classList.contains('sv-yt')), { message: 'YouTube の拡張が読み込まれる' });
  await hub.bringToFront();
  const before = (await active(hub)).cls;
  await phoneKey(yt, RIGHT);
  await until(async () => (await active(hub)).cls !== before, { message: 'ハブで右へ移動' });
  await hub.close();
  await yt.close();
});

test('キー診断ページ: スマホのリモコンの状態（設定・/tv のタブ・最後に受け取ったキー・渡した数）が見える', async () => {
  const diag = await env.ctx.newPage();
  await diag.goto(env.hubUrl.replace('index.html', 'diag.html'));
  const yt = await env.ctx.newPage();
  await yt.goto('https://www.youtube.com/tv');
  await until(() => yt.evaluate(() => document.documentElement.classList.contains('sv-yt')), { message: 'YouTube の拡張が読み込まれる' });
  await diag.bringToFront();
  const text = () => diag.locator('#remote-status').innerText();
  await until(async () => /YouTube \/tv のタブ\s*裏/.test(await text()), { message: '裏の /tv のタブが見える' });
  await phoneKey(yt, DOWN);
  await until(async () => /最後に受け取ったキー\s*DOWN/.test(await text()), { message: '受け取ったキーが見える' });
  await diag.close();
  await yt.close();
});
