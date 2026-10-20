/*
 * SofaView 共通: スマホのリモコン。
 * スマホの YouTube アプリの「テレビで見る」のリモコン（十字キー・決定・戻る）は、YouTube /tv が dpadCommand として受け取り、
 * ページの中でキーイベント（key なし・keyCode のみ・合成）として出す。拡張はそれを横取りして、いま見ているページ（TVer・ハブ）へ渡す。
 * 外部への通信は増えない（YouTube /tv が自分で行っている通信を、そのまま使う）。
 *
 *   YouTube /tv のタブ: remote-main.js（MAIN world）→ watchYoutube()  → background（sv:remote）→ 前面のタブ: listen() → inject()
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  /** /tv が dpadCommand で出す keyCode（実測）→ 論理名と、再現するキーイベントの値。 */
  const KEYS = Object.freeze({
    38: { name: 'UP', key: 'ArrowUp', code: 'ArrowUp' },
    40: { name: 'DOWN', key: 'ArrowDown', code: 'ArrowDown' },
    37: { name: 'LEFT', key: 'ArrowLeft', code: 'ArrowLeft' },
    39: { name: 'RIGHT', key: 'ArrowRight', code: 'ArrowRight' },
    13: { name: 'ENTER', key: 'Enter', code: 'Enter' },
    27: { name: 'BACK', key: 'Escape', code: 'Escape' },
  });
  const BY_NAME = Object.freeze(Object.fromEntries(Object.entries(KEYS).map(([kc, v]) => [v.name, { ...v, keyCode: Number(kc) }])));

  /**
   * YouTube /tv のページで、スマホのリモコンから来たキーイベントなら論理名（UP など）を返す。
   * 実際のキーボードのイベントは isTrusted、/tv 自身の合成イベントは key を持たないので、それで見分ける。
   */
  function nameFromYoutube(ev) {
    if (!ev || ev.isTrusted !== false || ev.key) return null;
    if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.shiftKey) return null;
    const k = KEYS[ev.keyCode];
    return k ? k.name : null;
  }

  const CLICKABLE = 'a[href], button, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="radio"], [role="checkbox"], input[type="checkbox"]';

  /**
   * 前面のページで、リモコンのキーを押したことにする。keydown → keyup の順に、フォーカス中の要素へ送る。
   * 合成イベントにはブラウザ標準の動作（Enter でリンクを開く）が付かないので、Enter はここで click する。
   */
  function inject(name, doc) {
    const spec = BY_NAME[name];
    const d = doc || (typeof document !== 'undefined' ? document : null);
    if (!spec || !d) return false;
    const target = d.activeElement || d.body;
    const init = { key: spec.key, code: spec.code, keyCode: spec.keyCode, which: spec.keyCode, bubbles: true, cancelable: true, composed: true };
    const down = SV.keys.allowSynthetic(new KeyboardEvent('keydown', init));
    target.dispatchEvent(down);
    const up = SV.keys.allowSynthetic(new KeyboardEvent('keyup', init));
    target.dispatchEvent(up);
    if (spec.name === 'ENTER' && !down.defaultPrevented) {
      const a = d.activeElement;
      if (a && a.matches && a.matches(CLICKABLE)) a.click();
    }
    return true;
  }

  /** YouTube /tv のタブ（isolated world）: MAIN world の remote-main.js からのキーを受けて、論理名で send する。send は (name) => void。 */
  function watchYoutube(win, send) {
    const onMsg = (m) => {
      if (m.source !== win || !m.data || m.data.svRemoteKey !== 1) return;
      const name = nameFromYoutube(m.data.ev);
      if (name) send(name);
    };
    win.addEventListener('message', onMsg);
    return () => win.removeEventListener('message', onMsg);
  }

  /** 前面のページ: background から届いたキーを inject する。 */
  function listen() {
    if (!SV.hasChrome() || !chrome.runtime.onMessage) return;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'sv:remoteKey' && typeof msg.name === 'string') inject(msg.name);
    });
  }

  SV.remote = { KEYS, nameFromYoutube, inject, watchYoutube, listen };
  if (typeof module === 'object' && module.exports) module.exports = SV.remote;
})(typeof self !== 'undefined' ? self : globalThis);
