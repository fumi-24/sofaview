/*
 * YouTube /tv のページ側（MAIN world）。スマホのリモコン（dpadCommand）で /tv が出す合成キーイベントは、
 * keyCode をページ側で付けているため、拡張側（isolated world）からは読めない。ここで読んで、postMessage で渡す。
 * 判定は common/remote.js の nameFromYoutube（ここでは合成・key なしのものだけ絞って渡す）。
 */
(function () {
  'use strict';
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isTrusted || e.key || !e.keyCode) return;
      window.postMessage({ svRemoteKey: 1, ev: { isTrusted: false, key: '', keyCode: e.keyCode, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey, shiftKey: e.shiftKey } }, location.origin);
    },
    true,
  );
})();
