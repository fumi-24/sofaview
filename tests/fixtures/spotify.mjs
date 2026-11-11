// Spotify Web プレーヤー（open.spotify.com）の起動の再現ページ。実サイトの仕組みを縮小して再現する:
//   - rspack のチャンクの配列（rspackChunk）に、react-dom の client のモジュール（createRoot・hydrateRoot・createPortal を含む大きなモジュール）が push され、
//     アプリが createRoot(#main).render(<プラットフォームの Provider …/>) を 1 回呼ぶ。プラットフォームは getRegistry（名前つき Symbol の登録簿）・getSession・getHistory を持つ。
//   - 登録簿に、PlayerAPI（getState・pause・resume・skipToNext・skipToPrevious・seekTo）・PlaybackAPI（getVolume・setVolume）。
//   - 部品の木（React の DevTools の入口に知らせる fiber）に、歌詞の行・プレーヤーを props に持つ部品・プラットフォームの Provider がある。
//   - history.push('/lyrics') で、歌詞の部品ができる（歌詞の画面）。
//   - メディアセッション（曲の情報・再生状態・再生位置・処理）。
// オプション: loggedOut・noTrack・noApp（アプリのサービスが見つからない作り。メディアセッションの代わりの確認）・noSession（メディアセッションなし）
export function spotifyHtml(opt) {
  const o = opt || {};
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Spotify fixture</title></head><body>
<div id="main"><div id="skeleton">読み込みの骨組み</div></div>
<script>
  window.__fx = { log: [], render: null, setTrack: null };
  const log = (ev, d) => window.__fx.log.push(Object.assign({ ev }, d || {}));
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

  // ---- アプリ自身のサービス（状態を持つ）----
  const AP = { paused: true, pos: 50000, ts: Date.now(), title: 'テスト曲のタイトル', vol: 1, listeners: [] };
  const apNow = () => (AP.paused ? AP.pos : AP.pos + (Date.now() - AP.ts));
  const appLog = (action, arg) => log('app', { action, arg });
  const playerAPI = {
    getState() {
      return {
        isPaused: AP.paused, isBuffering: false, positionAsOfTimestamp: AP.pos, timestamp: AP.ts, duration: 175797, speed: 1, shuffle: false, repeat: 0,
        item: ${o.noTrack ? 'null' : "{ type: 'track', uri: 'spotify:track:abc', name: AP.title, mediaType: 'audio', duration: { milliseconds: 175797 }, album: { name: 'アルバム', images: [{ url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=', width: 640 }] }, artists: [{ name: 'テスト歌手' }], metadata: { secret: 'SECRET-VALUE' } }"},
        restrictions: { canSeek: true },
      };
    },
    pause() { AP.pos = apNow(); AP.ts = Date.now(); AP.paused = true; appLog('pause'); },
    resume() { AP.ts = Date.now(); AP.paused = false; appLog('resume'); },
    skipToNext() { appLog('next'); },
    skipToPrevious() { appLog('prev'); },
    seekTo(ms) { AP.pos = ms; AP.ts = Date.now(); appLog('seekTo', ms); },
    play() {}, skipTo() {}, seekForward() {}, seekBackward() {}, getQueue() {}, setShuffle() {}, setRepeat() {},
    getEvents() { return { addListener(type, cb) { appLog('subscribe:' + type); AP.listeners.push(cb); } }; },
  };
  const playbackAPI = { getVolume() { return Promise.resolve(AP.vol); }, setVolume(v) { AP.vol = v; appLog('volume', v); } };
  const standalonePlayer = { getVolume() { return Promise.resolve(AP.vol); }, setVolume() {}, pause() {}, activateElement() { appLog('activate'); } };
  const appHistory = { push(to) { window.history.pushState({}, '', to); log('nav', { to }); setLyrics(/^\\/intl-[a-z-]+\\/lyrics\\/?$/.test(to)); } };

  // ---- プラットフォームと登録簿（名前つき Symbol）----
  const registry = { _map: new Map(), resolve(k) { return this._map.get(k); } };
  ${o.noApp ? '' : "registry._map.set(Symbol('PlayerAPI'), playerAPI); registry._map.set(Symbol('PlaybackAPI'), playbackAPI);"}
  const platform = { getRegistry() { return registry; }, getSession() { return { isAnonymous: ${!!o.loggedOut}, market: 'SECRET-MARKET' }; }, getHistory() { return appHistory; }, getTransport() { return {}; }, token: 'SECRET-TOKEN' };

  // ---- 部品の木（DevTools の入口に知らせる）----
  const rid = hook ? hook.inject({}) : 0;
  const fakeRoot = { current: null };
  function setLyrics(on) {
    if (!hook) return;
    const texts = ['一行目の歌詞', '二行目の歌詞', '三行目（いま）', '四行目の歌詞', '五行目の歌詞', '六行目の歌詞'];
    // 行の部品（Spotify の歌詞の行と同じ props: text・start・onObserve）。dataOnly のときは描かれず、入れ物の props（data.lyrics）だけがある
    let lines = on && !${!!o.dataOnly} ? texts.map((t, i) => {
      const props = { text: t, start: i * 20000, onObserve() {}, translationText: undefined };
      return { memoizedProps: props, child: { memoizedProps: props, child: null, sibling: null }, sibling: null };
    }) : [];
    if (on && ${!!o.dataOnly}) lines = [{ memoizedProps: { trackUri: 'spotify:track:abc', data: { isTimeSynced: true, lyrics: texts.map((t, i) => ({ text: t, start: i * 20000, end: (i + 1) * 20000 })) } }, child: null, sibling: null }];
    lines.forEach((l, i) => { if (i) lines[i - 1].sibling = l; });
    const prov = { memoizedProps: { value: platform }, tag: 10, type: { _context: { displayName: 'PlatformContext' } }, child: null, sibling: null };
    const login = ${o.loggedOut ? "{ memoizedProps: { 'data-testid': 'login-button', onClick() { log('login'); } }, tag: 5, child: null, sibling: prov }" : 'prov'};
    const player = ${o.noApp ? 'null' : "{ memoizedProps: { playerAPI, standalonePlayer }, tag: 0, type: { name: 'PlayerHost' }, child: null, sibling: login }"};
    // 歌詞ボタン（アプリ自身の移り先を知っている）。lyricsBtn: 'onClick'（既定）/ 'href' / 'none'
    const mode = ${JSON.stringify(o.lyricsBtn || 'onClick')};
    const btnProps = mode === 'href' ? { 'data-testid': 'lyrics-button', 'aria-pressed': on, href: '/intl-ja/lyrics', onClick() { log('lyricsBtnClick'); } }
      : { 'data-testid': 'lyrics-button', 'aria-pressed': on, onClick(e) { log('lyricsBtnClick', { button: e && e.button }); appHistory.push('/intl-ja/lyrics'); } };
    const btn = mode === 'none' ? null : { memoizedProps: btnProps, tag: 5, type: 'button', child: null, sibling: player || login };
    fakeRoot.current = { memoizedProps: null, child: { memoizedProps: {}, child: lines[0] || null, sibling: btn || player || login }, sibling: null };
    hook.onCommitFiberRoot(rid, fakeRoot);
  }
  setLyrics(false);

  window.__fx.setTrack = (t) => {
    AP.title = t;
    AP.listeners.forEach((cb) => cb({ data: {} })); // アプリの更新イベント
    if (navigator.mediaSession.metadata) navigator.mediaSession.metadata = new MediaMetadata({ title: t, artist: 'テスト歌手', artwork: [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=' }] });
  };

  // ---- メディアセッション（実サイトと同じく、曲の情報・再生状態・再生位置・処理を登録する）----
  ${o.noSession ? '' : `
  const ms = navigator.mediaSession;
  const L = (a, d) => log('ms', Object.assign({ action: a }, d || {}));
  ${o.noTrack ? '' : "ms.metadata = new MediaMetadata({ title: 'テスト曲のタイトル', artist: 'テスト歌手', artwork: [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=' }] });"}
  ms.playbackState = 'paused';
  ms.setActionHandler('play', () => { ms.playbackState = 'playing'; L('play'); });
  ms.setActionHandler('pause', () => { ms.playbackState = 'paused'; L('pause'); });
  ms.setActionHandler('nexttrack', () => L('next'));
  ms.setActionHandler('previoustrack', () => L('prev'));
  ms.setActionHandler('seekto', (d) => { ms.setPositionState({ duration: 175.797, position: d.seekTime, playbackRate: 1 }); L('seekto', { time: d.seekTime }); });
  ms.setPositionState({ duration: 175.797, position: 50, playbackRate: 1 });
  `}

  // ---- 起動: rspack のチャンクの配列に react-dom の client のモジュールが push され、アプリが createRoot(#main).render(...) を 1 回呼ぶ ----
  const pad = '/*' + 'x'.repeat(60000) + '*/';
  const factory = new Function('module', 'exports', 'exports.createRoot = function (c, o) { return { render: function (el) { window.__fx.render(c, el); } }; }; exports.hydrateRoot = function () {}; exports.createPortal = function () {}; ' + pad);
  window.__fx.render = (container, el) => {
    // Spotify の画面は、ここ（文書の外の要素）に描かれる
    window.__fx.rendered = { containerConnected: container.isConnected, containerIsMain: container.id === 'main' };
    container.innerHTML = '<div data-testid="now-playing-bar"><button data-testid="control-button-playpause">再生</button></div><main>Spotify の画面</main>';
  };
  const entry = [['vendor'], { 77328: factory }];
  (window.rspackChunk = window.rspackChunk || []).push(entry);
  const m = { exports: {} };
  entry[1][77328](m, m.exports, null);
  m.exports.createRoot(document.getElementById('main')).render({ props: { children: { props: { value: platform } } } });
</script></body></html>`;
}
