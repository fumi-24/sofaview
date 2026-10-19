// E2E 共通ヘルパー: 拡張機能を読み込んだ Chromium（新ヘッドレス）を起動する。
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXT = path.join(ROOT, 'extension');
export const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
export const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));

/** manifest の key から拡張 ID を求める（Chromium と同じ計算: SHA-256 の先頭 16 バイトを a-p に変換）。 */
export async function extensionIdFromKey(key) {
  const { createHash } = await import('node:crypto');
  const der = Buffer.from(key, 'base64');
  const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode('a'.charCodeAt(0) + parseInt(c, 16))).join('');
}

/**
 * 拡張を読み込んだコンテキストを返す。
 * @param {{viewport?:{width:number,height:number}, deviceScaleFactor?:number, proxy?:boolean}} [opts]
 */
export async function launch(opts = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-e2e-'));
  // Chromium は読み込んだ拡張のディレクトリに _metadata/ を生成するため、コピーを読み込んでリポジトリを汚さない
  const extDir = path.join(userDataDir, 'extension');
  fs.cpSync(EXT, extDir, { recursive: true });
  const proxy = opts.proxy !== false && process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium', // 新ヘッドレス（拡張機能が動く）
    headless: true,
    proxy,
    viewport: opts.viewport || { width: 1920, height: 1080 },
    deviceScaleFactor: opts.deviceScaleFactor,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--autoplay-policy=no-user-gesture-required'],
  });
  let sw = ctx.serviceWorkers()[0];
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  // Service Worker の起動直後は chrome.tabs などがまだ使えないことがある（CI で 1 回だけ undefined になった）。使えるまで待つ
  for (let i = 0; i < 100; i++) {
    const ready = await sw.evaluate(() => !!(self.chrome && chrome.tabs && chrome.tabs.setZoom && chrome.storage)).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const extId = new URL(sw.url()).host;
  return {
    ctx,
    sw,
    extId,
    hubUrl: `chrome-extension://${extId}/hub/index.html`,
    async close() {
      await ctx.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** フォーカス中の要素の概要。 */
export async function active(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const r = a.getBoundingClientRect();
    return {
      tag: a.tagName.toLowerCase(),
      id: a.id || '',
      cls: typeof a.className === 'string' ? a.className : '',
      href: a.getAttribute('href') || '',
      label: (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      sv: a.getAttribute('data-id') || '',
      x: Math.round(r.left),
      y: Math.round(r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
}

/** 条件が満たされるまで待つ（polling）。 */
export async function until(fn, { timeout = 8000, interval = 100, message = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${message} (last=${JSON.stringify(last)})`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * TVer のページの準備完了を待つ: 拡張の初期化（data-sv-ready）と、画面倍率の確認の完了（data-sv-zoom）。
 * 画面倍率はページの読み込み後に変わるので、これを待たずに操作すると、途中でレイアウトが変わってしまう。
 */
export function tverReady(page, message = 'sv ready') {
  return until(
    () =>
      page.evaluate(() => {
        const d = document.documentElement.dataset;
        return d.svReady === '1' && (d.svZoom === 'done' || d.svZoom === 'skipped');
      }),
    { message },
  );
}

/** キーを押してスクロール・アニメーションが落ち着くまで少し待つ。 */
export async function press(page, key, wait = 250) {
  await page.keyboard.press(key);
  await page.waitForTimeout(wait);
}

/** スクロール位置が止まるまで待つ。 */
export async function settleScroll(page) {
  let prev = -1;
  for (let i = 0; i < 30; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === prev) return y;
    prev = y;
    await page.waitForTimeout(80);
  }
  return prev;
}
