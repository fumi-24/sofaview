// ツールバーのアイコンから開く設定の小窓（extension/popup）の E2E。ネットワーク不要。
import test from 'node:test';
import assert from 'node:assert/strict';
import { launch, until } from './helpers.mjs';

let env;
test.before(async () => {
  env = await launch({ viewport: { width: 420, height: 700 } });
});
test.after(async () => {
  await env.close();
});

const popupUrl = () => `chrome-extension://${env.extId}/popup/popup.html`;
const stored = () => env.sw.evaluate(() => new Promise((r) => chrome.storage.local.get('sv.settings', (v) => r(v['sv.settings'] || null))));
async function open() {
  const page = await env.ctx.newPage();
  page.__errors = [];
  page.on('pageerror', (e) => page.__errors.push(e.message));
  await page.goto(popupUrl());
  await until(() => page.evaluate(() => document.querySelectorAll('#rows .row').length > 0), { message: '行が出る' });
  return page;
}

test('manifest: ツールバーのアイコンは小窓（popup）を開く。ページは開かない', async () => {
  const m = JSON.parse(await env.sw.evaluate(async () => JSON.stringify(chrome.runtime.getManifest())));
  assert.equal(m.action.default_popup, 'popup/popup.html');
  assert.equal(m.options_page, 'hub/settings.html', '従来の設定ページ（リモコン向け）も残る');
});

test('小窓: 設定の項目が並び、スイッチで切り替えると保存される（ページを開かずに）', async () => {
  const page = await open();
  assert.match(await page.evaluate(() => document.getElementById('ver').textContent), /^v\d/);
  const sw = (id) => page.locator(`.row[data-id="${id}"] .switch`);
  assert.equal(await sw('tver.hideHeader').getAttribute('aria-checked'), 'true', '既定はオン');
  await sw('tver.hideHeader').click();
  assert.equal(await sw('tver.hideHeader').getAttribute('aria-checked'), 'false');
  await until(async () => (await stored())?.tver?.hideHeader === false, { message: '保存された' });
  await sw('youtube.redirect').click();
  await until(async () => (await stored())?.youtube?.redirect === true, { message: 'YouTube の転送' });
  assert.equal(await page.evaluate(() => new Set(Array.from(document.querySelectorAll('.row')).map((r) => r.dataset.id)).size > 5), true);
  assert.deepEqual(page.__errors, []);
  await page.close();
});

test('小窓: 画面倍率の 3 択。「固定」のときだけ倍率の選択が出る', async () => {
  const page = await open();
  assert.equal(await page.locator('.row[data-id="zoom.factor"]').count(), 0, '自動のときは出ない');
  await page.locator('.row[data-id="zoom.mode"] .seg button', { hasText: '固定' }).click();
  await until(async () => (await stored())?.zoom?.mode === 'fixed');
  assert.equal(await page.locator('.row[data-id="zoom.factor"]').count(), 1);
  await page.locator('.row[data-id="zoom.factor"] select').selectOption('2');
  await until(async () => (await stored())?.zoom?.factor === 2, { message: '固定倍率 2×' });
  assert.equal(await page.locator('.row[data-id="zoom.mode"] .seg button[aria-pressed="true"]').textContent(), '固定');
  await page.close();
});

test('小窓: 設定ページで変えた値にも追従する。初期化は 2 回押して実行', async () => {
  const page = await open();
  await env.sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ 'sv.settings': { tver: { hideAppCta: false } } }, r)));
  await until(() => page.evaluate(() => document.querySelector('.row[data-id="tver.hideAppCta"] .switch').getAttribute('aria-checked') === 'false'), { message: '他で変えた値に追従' });
  await page.click('#reset');
  assert.equal(await page.evaluate(() => document.getElementById('reset').textContent), 'もう一度押すと初期化');
  assert.notEqual(await stored(), null, '1 回目ではまだ初期化しない');
  await page.click('#reset');
  await until(async () => (await stored()) === null, { message: '初期化' });
  assert.equal(await page.locator('.row[data-id="tver.hideAppCta"] .switch').getAttribute('aria-checked'), 'true');
  await page.close();
});

test('小窓: 「ハブを開く」「キー割り当て」「キー診断」「すべての設定」は、新しいタブで開く（開いたら小窓は閉じる）', async () => {
  for (const [id, path] of [['open-hub', 'hub/index.html'], ['open-keys', 'hub/keys.html'], ['open-diag', 'hub/diag.html'], ['open-all', 'hub/settings.html']]) {
    const page = await open();
    const [tab] = await Promise.all([env.ctx.waitForEvent('page'), page.click('#' + id)]);
    await tab.waitForLoadState();
    assert.equal(tab.url(), `chrome-extension://${env.extId}/${path}`, id);
    await until(() => page.isClosed(), { message: '小窓は閉じる' });
    await tab.close();
  }
});
