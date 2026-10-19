/*
 * SofaView 共通: 名前空間と小さなユーティリティ。
 * すべての共通モジュールはクラシックスクリプト（ビルド不要）で、`SV` 名前空間に自分を登録する。
 * Node の単体テストからも `require` できるよう UMD 形式にしている。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  SV.VERSION = '0.1.0';
  SV.HUB_PATH = 'hub/index.html';
  SV.debug = false;

  SV.hasChrome = function hasChrome() {
    return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
  };

  SV.log = function log(...args) {
    if (SV.debug && typeof console !== 'undefined') console.log('[SV]', ...args);
  };

  SV.clamp = function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  };

  SV.sleep = function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  };

  /** Service Worker へメッセージを送る。失敗しても例外にしない（拡張の再読み込み直後など）。 */
  SV.sendMessage = function sendMessage(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError; // 受信側がいない場合の警告を握りつぶす
          resolve(resp);
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  };

  /** ハブ（共通ホーム）へ戻る。 */
  SV.goHub = function goHub() {
    return SV.sendMessage({ type: 'sv:goHub' });
  };

  /** イベントを「処理済み」にしてサイト側へ渡さない。 */
  SV.consume = function consume(ev) {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    ev.stopPropagation();
  };

  /** 秒数を m:ss / h:mm:ss に整形する。 */
  SV.formatTime = function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
  };

  if (typeof module === 'object' && module.exports) module.exports = SV;
})(typeof self !== 'undefined' ? self : globalThis);
