/*
 * YouTube /tv のページ側（MAIN world）。スマホからのキャスト待機のため:
 *  - 裏のタブでも「見えている」扱いにする（見えなくなったと判断して接続を閉じるのを防ぐ）
 *  - 診断用に、スマホから届いた命令の名前（remoteConnected・setPlaylist など）だけを知らせる
 */
(function () {
  'use strict';
  // 裏のタブになったとき、/tv が「画面が見えなくなった」と判断して、スマホとの接続を閉じることがある。いつも見えている扱いにする
  const fixed = { hidden: false, visibilityState: 'visible', webkitHidden: false, webkitVisibilityState: 'visible' };
  for (const k of Object.keys(fixed)) {
    try {
      Object.defineProperty(Document.prototype, k, { configurable: true, get: () => fixed[k] });
    } catch (e) {
      /* 差し替えられない環境では何もしない */
    }
  }
  document.addEventListener('visibilitychange', (e) => e.stopImmediatePropagation(), true);

  // 診断用: スマホから /tv に届いた命令の名前（setPlaylist など）だけを知らせる。内容は読まない
  const send = XMLHttpRequest.prototype.send;
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__svLounge = /\/api\/lounge\/bc\/bind/.test(String(url));
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__svLounge) {
      let seen = 0;
      const scan = () => {
        try {
          const t = this.responseText || '';
          if (t.length <= seen) return;
          const fresh = t.slice(seen);
          seen = t.length;
          const names = [];
          fresh.replace(/\[\d+,\["([A-Za-z]{3,})"/g, (_, n) => names.push(n));
          if (names.length) window.postMessage({ svLoungeSeen: 1, names }, location.origin);
        } catch (e) {
          /* responseType が text でないとき */
        }
      };
      this.addEventListener('progress', scan);
      this.addEventListener('readystatechange', scan);
      this.addEventListener('load', scan);
    }
    return send.apply(this, arguments);
  };
})();
