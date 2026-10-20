/*
 * YouTube /tv のページ側（MAIN world）。/tv は、トップ画面で「戻る」（Esc）を押すと、アプリを終わらせるつもりで window.close() を呼ぶ。
 * キオスクでタブが 1 つだと、これでブラウザごと終了してしまう（Esc の長押しで「落ちる」）。
 * 閉じる代わりに、ハブへ戻す（拡張側の content.js が postMessage を受けて SV.goHub）。
 */
(function () {
  'use strict';
  window.close = function () {
    window.postMessage({ svExit: 1 }, location.origin);
  };
})();
