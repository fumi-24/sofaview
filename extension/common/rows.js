/*
 * 横スクロールの行（棚）のスクロール位置の規則。youtube.com/tv の実測（docs/NOTES.md）に合わせる。
 *  - フォーカス中の行の見出しは、画面の上から 15%（高さ 720px で 108px）に固定する。前の行は上へ流れて消える。
 *  - 行の中では、先頭のカードは 1 枚目の位置、2 枚目以降は **2 枚目の位置** にフォーカスを保つ（行のほうが動く）。
 * DOM には触らない純粋な計算だけ（実際のスクロールは sites/tver/content.js）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  /** フォーカス中の行の見出しを置く、画面高さに対する位置（/tv: 108 ÷ 720）。 */
  const ROW_TOP_RATIO = 0.15;

  /**
   * 画面を縦にどれだけスクロールすれば、行の見出し（なければ行の上端）が決まった位置に来るか。
   * @param {number} top 見出しの現在の上端（viewport 座標）
   * @param {number} viewportHeight
   * @returns {number} スクロール量（正 = 下へ）。小さい差（1px 未満）は 0
   */
  function pinDelta(top, viewportHeight) {
    const d = top - viewportHeight * ROW_TOP_RATIO;
    return Math.abs(d) < 1 ? 0 : d;
  }

  /**
   * 行の横スクロール量（scrollLeft）。index 番目のカードを 1 枚目（index 0）／2 枚目（index 1 以降）の位置に置く。
   * @param {number} index フォーカスしたカードの番号（0 始まり）
   * @param {number[]} lefts 各カードの左端（行の左端からの距離。scrollLeft が 0 のときの位置）
   * @returns {number}
   */
  function slotScrollLeft(index, lefts) {
    if (!lefts || index <= 1 || lefts.length < 2) return 0;
    const i = Math.min(index, lefts.length - 1);
    return Math.max(0, lefts[i] - lefts[1]);
  }

  const api = { ROW_TOP_RATIO, pinDelta, slotScrollLeft };
  SV.rows = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
