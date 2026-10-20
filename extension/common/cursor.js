/*
 * マウスカーソルの自動非表示。テレビでは、マウスを動かしていないときにカーソルが残らないようにする。
 * マウスを動かすと出て、最後に動かしてから 3 秒で消える。最初（読み込み直後）は隠す。
 * 隠すのは html.sv-cursor-hidden（common/base.css が cursor: none にする）。動かしたときのイベントは、本物のマウスの移動だけを見る
 * （描画の変化でブラウザが出す疑似的な移動・拡張が送る合成イベントでは、出さない）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});
  const HIDE_MS = 3000;
  const CLASS = 'sv-cursor-hidden';

  /**
   * @param {{document?:Document, hideMs?:number}} [options]
   * @returns {{show:()=>void, hide:()=>void, dispose:()=>void}}
   */
  function init(options) {
    const o = options || {};
    const doc = o.document || root.document;
    const win = doc.defaultView || root;
    const html = doc.documentElement;
    const ms = o.hideMs || HIDE_MS;
    let timer = 0;
    let last = null; // 直前の位置（動いていない移動イベントは無視する）

    const hide = () => {
      clearTimeout(timer);
      timer = 0;
      html.classList.add(CLASS);
    };
    const show = () => {
      html.classList.remove(CLASS);
      clearTimeout(timer);
      timer = setTimeout(hide, ms);
    };

    const onMove = (e) => {
      if (!e.isTrusted) return;
      const p = [e.screenX, e.screenY];
      const moved = !last || last[0] !== p[0] || last[1] !== p[1];
      last = p;
      if (moved) show();
    };
    const onDown = (e) => {
      if (e.isTrusted) show();
    };

    win.addEventListener('mousemove', onMove, { capture: true, passive: true });
    win.addEventListener('mousedown', onDown, { capture: true, passive: true });
    win.addEventListener('wheel', onDown, { capture: true, passive: true });
    hide();

    return {
      show,
      hide,
      dispose() {
        clearTimeout(timer);
        win.removeEventListener('mousemove', onMove, true);
        win.removeEventListener('mousedown', onDown, true);
        win.removeEventListener('wheel', onDown, true);
        html.classList.remove(CLASS);
      },
    };
  }

  SV.cursor = { HIDE_MS, CLASS, init };
  // 読み込まれたら自動で始める（拡張ページ・コンテンツスクリプト共通）。テストからは document を渡して init を呼ぶ
  if (typeof document !== 'undefined' && document.documentElement) SV.cursor.instance = init();
  if (typeof module === 'object' && module.exports) module.exports = SV.cursor;
})(typeof self !== 'undefined' ? self : globalThis);
