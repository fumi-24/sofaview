// 画面倍率（SPEC 7.3）: ページ側とタブの倍率が食い違った標本が来ても、二重に拡大せず、最後は正しい倍率（高さ 720）に落ち着く。
// 実際に起きた不具合: 読み込み直後はページ側の innerHeight が 1 倍のままで、タブは 1.5 倍（前のページで保存された倍率）という標本が届き、
// 「1080 の画面」と見て 2.25 倍にしていた（高負荷で 200 回中 4 回。CI の E2E が 1 回だけ落ちた原因）。
// ここでは Service Worker の getZoom を 1 回だけ偽の値にして、その食い違いを決まった形で再現する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, until, tverReady } from './helpers.mjs';
import { homeHtml } from '../fixtures/tver.mjs';

const route = (env) =>
  env.ctx.route('https://tver.jp/**', (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: homeHtml() }));

/** setZoom の呼び出しを記録し、getZoom を 1 回だけ偽の値にできるようにする（Service Worker 内）。 */
const instrument = (env) =>
  env.sw.evaluate(() => {
    self.__zooms = [];
    const set = chrome.tabs.setZoom.bind(chrome.tabs);
    chrome.tabs.setZoom = (id, z) => {
      self.__zooms.push(z);
      return set(id, z);
    };
    self.__getZoom = chrome.tabs.getZoom.bind(chrome.tabs);
  });
const fakeFirstGetZoom = (env, value) =>
  env.sw.evaluate((v) => {
    let n = 0;
    chrome.tabs.getZoom = (id) => (n++ === 0 ? Promise.resolve(v) : self.__getZoom(id));
  }, value);
const unfake = (env) => env.sw.evaluate(() => { chrome.tabs.getZoom = self.__getZoom; });
const zooms = (env) => env.sw.evaluate(() => self.__zooms.slice());
const clearZooms = (env) => env.sw.evaluate(() => { self.__zooms.length = 0; });

/** tver.jp の倍率（Chromium が保存する）を 1 倍に戻す。 */
async function resetZoom(env) {
  const page = await env.ctx.newPage();
  await page.goto('https://tver.jp/');
  await tverReady(page);
  await env.sw.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://tver.jp/*' });
    for (const t of tabs) await chrome.tabs.setZoom(t.id, 1);
  });
  await until(async () => (await page.evaluate(() => innerHeight)) === 1080, { message: 'zoom reset' });
  await page.close();
}

test('画面倍率: 初回は 1.5 倍（高さ 720）にして、確認まで終わる', async () => {
  const env = await launch();
  try {
    await route(env);
    await instrument(env);
    const page = await env.ctx.newPage();
    await page.goto('https://tver.jp/');
    await tverReady(page);
    assert.equal(await page.evaluate(() => innerHeight), 720);
    assert.deepEqual(await zooms(env), [1.5], '倍率を変えたのは 1 回だけ');
    await page.close();
  } finally {
    await env.close();
  }
});

test('画面倍率: ページ側が遅れた標本（ページは 1 倍、タブは 1.5 倍と答える）は使わず、二重に拡大しない', async () => {
  const env = await launch();
  try {
    await route(env);
    await instrument(env);
    await fakeFirstGetZoom(env, 1.5); // 実際のタブは 1 倍。ページの DPR は 1 → 「DPR ÷ タブの倍率」が 1 未満で矛盾と分かる
    const page = await env.ctx.newPage();
    await page.goto('https://tver.jp/');
    await tverReady(page);
    assert.equal(await page.evaluate(() => innerHeight), 720);
    assert.deepEqual(await zooms(env), [1.5], '2.25 倍にはしていない');
    await page.close();
  } finally {
    await env.close();
  }
});

test('画面倍率: 矛盾に見えない古い標本で誤って拡大しても、落ち着いてからの確認で直る（OS の表示倍率 2 の画面）', async () => {
  const env = await launch({ deviceScaleFactor: 2 });
  try {
    await route(env);
    await instrument(env);
    await fakeFirstGetZoom(env, 1.5); // ページの DPR は 2 → 2 ÷ 1.5 ≥ 0.9 で矛盾と分からず、2.25 倍にしてしまう
    const page = await env.ctx.newPage();
    await page.goto('https://tver.jp/');
    await tverReady(page);
    await until(async () => (await page.evaluate(() => innerHeight)) === 720, { message: 'settled at 720' });
    assert.deepEqual(await zooms(env), [2.25, 1.5], '誤って 2.25 倍にした後、確認で 1.5 倍へ戻す');
    await page.close();
  } finally {
    await env.close();
  }
});

test('画面倍率: 保存された 1.5 倍のページを開き直しても、倍率は変わらない', async () => {
  const env = await launch();
  try {
    await route(env);
    await instrument(env);
    for (let i = 0; i < 3; i++) {
      const page = await env.ctx.newPage();
      await page.goto('https://tver.jp/');
      await tverReady(page);
      assert.equal(await page.evaluate(() => innerHeight), 720);
      await page.close();
    }
    assert.deepEqual(await zooms(env), [1.5], '最初の 1 回だけ変える');
  } finally {
    await env.close();
  }
});
