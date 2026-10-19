/*
 * 画面倍率（10フィート表示用）の計算。
 * 基準: CSS ビューポート高さが targetHeight（既定 720px）になる倍率。
 *   1080p → 1.5倍 / 2160p(DPR1) → 3倍 / すでに 720 前後なら 1倍（触らない）。
 * 実際の適用は Service Worker が chrome.tabs.setZoom で行う（追加権限は不要）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  /**
   * @param {object} p
   * @param {number} p.innerHeight  現在の window.innerHeight（CSS px、現在のズーム適用後）
   * @param {number} p.currentZoom  現在のタブのズーム倍率
   * @param {'auto'|'off'|'fixed'} [p.mode]
   * @param {number} [p.targetHeight]
   * @param {number} [p.factor]     mode=fixed のときの倍率
   * @param {number} [p.min]
   * @param {number} [p.max]
   * @returns {number|null} 適用すべき倍率。触らない場合は null
   */
  function compute(p) {
    const mode = p.mode || 'auto';
    if (mode === 'off') return null;
    if (mode === 'fixed') return round(clamp(p.factor || 1, 0.25, 5));
    const current = p.currentZoom > 0 ? p.currentZoom : 1;
    const inner = p.innerHeight > 0 ? p.innerHeight : 0;
    if (!inner) return null;
    const baseHeight = inner * current; // ズーム 1 倍のときのビューポート高さ
    const target = p.targetHeight || 720;
    const min = p.min == null ? 1 : p.min;
    const max = p.max == null ? 4 : p.max;
    return round(clamp(baseHeight / target, min, max));
  }

  /**
   * ページ読み込み直後は、ページ側（innerHeight / DPR）にタブの倍率がまだ反映されていないことがある。
   * その標本で compute すると、すでに 1.5 倍のタブを「1080 の画面」と見て 2.25 倍にしてしまう。
   * 「DPR ÷ タブの倍率」は OS の表示倍率（通常 1 以上）。1 を大きく下回るなら、ページ側が遅れている。
   * すべての食い違いを検出できるわけではない（OS の表示倍率が 2 のときは見逃す）ので、本体は落ち着いてからの再確認（fit）。
   */
  function isConsistent(dpr, currentZoom) {
    if (!(dpr > 0) || !(currentZoom > 0)) return true;
    return dpr / currentZoom >= 0.9;
  }

  function shouldApply(current, target, eps) {
    if (target == null) return false;
    return Math.abs(current - target) > (eps == null ? 0.03 : eps);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // Chromium のズームは 0.05 刻みで丸めると扱いやすい
  function round(v) {
    return Math.round(v * 20) / 20;
  }

  // ---- 画面倍率を合わせる手順（content script 側）。時間と通信は env で差し替えられる（単体テスト用）。

  /** viewport の高さが quietMs の間変わらなくなるまで待つ（最大 maxMs）。 */
  async function waitStable(env, quietMs, maxMs) {
    const t0 = env.now();
    let last = env.height();
    let since = t0;
    while (env.now() - t0 < maxMs) {
      await env.sleep(50);
      const h = env.height();
      if (h !== last) {
        last = h;
        since = env.now();
      } else if (env.now() - since >= quietMs) {
        return true;
      }
    }
    return false;
  }

  /** viewport の高さが from から変わるまで待つ（最大 maxMs）。 */
  async function waitChange(env, from, maxMs) {
    const t0 = env.now();
    while (env.now() - t0 < maxMs) {
      if (env.height() !== from) return true;
      await env.sleep(50);
    }
    return false;
  }

  /**
   * 画面倍率を合わせる。要求は 1 つずつ順番に出す（同時に出すと、同じ古い標本から別々に計算して二重に拡大する）。
   * 倍率を変えたら、画面に反映されて落ち着くのを待ち、落ち着いた標本でもう一度確認する。
   * 最初の標本が古くて誤った倍率を適用しても、この確認で直る（最大 3 回で打ち切る）。
   * @param {object} env
   * @param {() => number} env.height       現在の window.innerHeight
   * @param {() => number} env.dpr          現在の window.devicePixelRatio
   * @param {(msg: object) => Promise<object|undefined>} env.request  Service Worker への要求
   * @param {() => number} [env.now]
   * @param {(ms: number) => Promise<void>} [env.sleep]
   */
  async function fit(env) {
    const e = Object.assign({ now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, env);
    let result = null;
    for (let i = 0; i < 3; i++) {
      const before = e.height();
      const r = await e.request({ type: 'sv:zoom', innerHeight: before, dpr: e.dpr(), settled: i > 0 });
      result = r;
      if (!r || !r.ok || r.mode !== 'auto') return r; // 触らない設定（off / fixed）・応答なし
      if (i > 0 && !r.applied) return r; // 落ち着いた標本で変更不要 → 完了
      if (r.applied) await waitChange(e, before, 1500);
      await waitStable(e, 250, 2000);
    }
    return result;
  }

  const api = { compute, shouldApply, isConsistent, fit, waitStable, waitChange };
  SV.zoom = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
