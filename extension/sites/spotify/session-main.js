/*
 * Spotify のページ側（MAIN world、document_start）。ブラウザの標準の「メディアセッション」API（OS のメディアキー・ロック画面の操作用）を橋にする。
 * Spotify は、ここに再生・一時停止・前・次・シークの処理（ハンドラ）を登録する。画面の作り（ボタン・目印）が変わっても、この API は変わらない。
 *  - 登録されるハンドラを覚えて、拡張側（nowplaying.js）の依頼で呼ぶ（OS のメディアキーが押されたのと同じ）
 *  - setPositionState（再生位置・長さ）を覚えて、拡張側へ知らせる（再生位置の読み取り用）
 * 音量だけはメディアセッションにないので、最後に再生された音声の volume を（画面の音量の棒がないときの最後の手段として）直接動かせるようにする。
 * メタデータ（曲名・アーティスト・ジャケット）と再生状態は、拡張側が navigator.mediaSession から直接読める。
 */
(function () {
  'use strict';
  const ms = navigator.mediaSession;
  if (!ms) return;
  const proto = Object.getPrototypeOf(ms);
  const handlers = {};
  let pos = null;
  let media = null; // 最後に再生された音声（audio/video）。音量の操作の最後の手段（画面の音量の棒がないとき）

  const announce = () => window.postMessage({ svMs: 'caps', actions: Object.keys(handlers).filter((k) => handlers[k]), pos, vol: media ? media.volume : null }, location.origin);

  const seen = new WeakSet();
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    media = this;
    if (!seen.has(this)) {
      seen.add(this);
      this.addEventListener('volumechange', announce);
    }
    return origPlay.apply(this, arguments);
  };

  const origSet = proto.setActionHandler;
  proto.setActionHandler = function (action, fn) {
    handlers[action] = typeof fn === 'function' ? fn : null;
    announce();
    return origSet.apply(this, arguments);
  };

  const origPos = proto.setPositionState;
  proto.setPositionState = function (st) {
    pos = st && Number.isFinite(st.duration) ? { duration: st.duration, position: Number(st.position) || 0, rate: Number(st.playbackRate) || 1, at: Date.now() } : null;
    announce();
    return origPos.apply(this, arguments);
  };

  // 曲の情報・再生状態が変わったことも知らせる（画面の DOM が変わらなくても、曲の変化に気づけるように）
  for (const name of ['metadata', 'playbackState']) {
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || !d.set) continue;
    Object.defineProperty(proto, name, {
      configurable: true,
      enumerable: d.enumerable,
      get: d.get,
      set(v) {
        d.set.call(this, v);
        announce();
      },
    });
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.svMsHello) return announce();
    if (e.data.svMsVolume != null) {
      if (media) media.volume = Math.min(1, Math.max(0, Number(e.data.svMsVolume) || 0));
      return;
    }
    const fn = e.data.svMsCall && handlers[e.data.svMsCall];
    if (typeof fn !== 'function') return;
    try {
      fn(Object.assign({ action: e.data.svMsCall }, e.data.details || {}));
    } catch (err) {
      console.error('[SV] media session handler', err);
    }
  });
})();
