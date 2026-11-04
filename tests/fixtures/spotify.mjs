// Spotify Web プレーヤー（open.spotify.com）の構造を縮小した再現ページ。ログアウト状態の実サイトで確かめた data-testid を使う。
// 実サイトにだけある要素は、ライブスモーク（tests/live）で見つかる。
export function spotifyHtml(opt) {
  const o = opt || {};
  const card = (id, title) =>
    `<div class="card"><a href="/album/${id}" data-testid="card-click-handler" data-card="${id}"><span class="img"></span><span>${title}</span></a>` +
    `<button data-testid="play-button" aria-label="${title}を再生">▶</button></div>`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>Spotify fixture</title>
<style>
  body { margin: 0; background: #000; color: #fff; font: 16px sans-serif; }
  [data-testid="global-nav-bar"] { position: fixed; top: 0; left: 0; right: 0; height: 56px; display: flex; gap: 16px; align-items: center; padding: 0 16px; }
  nav.side { position: fixed; top: 64px; left: 8px; width: 220px; bottom: 88px; overflow: hidden; }
  nav.side a { display: block; padding: 8px; color: #fff; }
  main { position: fixed; top: 64px; left: 236px; right: 8px; bottom: 88px; overflow: auto; }
  .shelf { display: flex; gap: 16px; padding: 8px; }
  .card { position: relative; width: 150px; }
  .card a { display: block; color: #fff; text-decoration: none; }
  .card .img { display: block; width: 150px; height: 150px; background: #444; }
  .card button { position: absolute; right: 8px; top: 108px; width: 32px; height: 32px; border-radius: 16px; }
  [data-testid="now-playing-bar"] { position: fixed; left: 0; right: 0; bottom: 0; height: 80px; display: flex; gap: 16px; align-items: center; justify-content: center; }
  [data-testid="general-controls"] { display: inline-flex; gap: 4px; }
  [data-testid="now-playing-widget-v2"] { display: flex; align-items: center; gap: 8px; margin-right: 24px; }
  [data-testid="cover-art-button"] img { width: 48px; height: 48px; background: #555; }
  [role="row"] { display: flex; gap: 12px; padding: 8px; }
  h2 { margin: 12px 8px 0; }
  .hidden-visually { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .bar { display: inline-block; width: 300px; } .track { height: 4px; background: #666; }
  [data-testid="volume-bar"] { display: flex; align-items: center; gap: 8px; width: 160px; } [data-testid="volume-bar"] > div { width: 100px; }
</style></head><body>
<div data-testid="root">
  <header data-testid="global-nav-bar">
    <a data-testid="home-button" href="/" aria-label="ホーム">ホーム</a>
    <input data-testid="search-input" type="search" placeholder="何を再生したいですか？" aria-label="検索">
    <a href="https://www.spotify.com/jp/premium/" data-id="ext">Premium</a>
    <button data-testid="more-button" aria-label="その他のオプション">…</button>
    ${o.loggedOut ? '<button data-testid="login-button">ログイン</button>' : '<button data-testid="user-widget-link" aria-label="アカウント">人</button>'}
  </header>
  <nav class="side" aria-label="メインナビゲーション">
    <a href="/collection/playlists" data-id="lib">マイライブラリ</a>
    <a href="https://www.spotify.com/legal/" data-id="legal">法的情報</a>
    <a href="/other" target="_blank" data-id="blank">新しいタブ</a>
  </nav>
  <main id="main"></main>
  <aside data-testid="now-playing-bar" aria-label="再生中バー">
  <div data-testid="now-playing-widget-v2" role="region" aria-label="再生中">
    <div data-testid="cover-art-container"><button data-testid="cover-art-button" aria-label="再生中ビュー"><img data-testid="cover-art-image" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs="></button></div>
    ${o.noTrack || o.plain ? '<div></div>' : '<div><a href="/album/np1">テスト曲のタイトル</a><span data-testid="now-playing-widget-v2-byline"><a href="/artist/np2">テスト歌手</a></span></div>'}
    <button aria-checked="false" aria-label="お気に入りに追加" data-like>♡</button>
  </div>
  <div data-testid="player-controls"><div data-testid="general-controls">
    <button aria-label="シャッフル">⇄</button>
    <button data-testid="control-button-skip-back" aria-label="前へ">⏮</button>
    <button data-testid="control-button-playpause" aria-label="再生">⏯</button>
    <button data-testid="control-button-skip-forward" aria-label="次へ">⏭</button>
    <button data-testid="control-button-repeat" role="checkbox" aria-checked="false" aria-label="リピートを無効にする">↻</button>
    </div><span data-testid="playback-position">0:50</span><span data-testid="playback-duration">2:55</span>
    <div data-testid="playback-progressbar" class="bar"><label class="hidden-visually">曲の再生位置を変える<input type="range" min="0" max="175797" step="5000" value="50000"></label><div data-testid="progress-bar" class="track"></div></div>
  </div>
  <div data-testid="volume-bar"><button data-testid="volume-bar-toggle-mute-button" aria-label="ミュート">🔈</button><div><div><label class="hidden-visually">音量を変える<input type="range" min="0" max="1" step="0.1" value="1"></label><div data-testid="progress-bar" class="track"></div></div></div></div>
  <button data-testid="lyrics-button" aria-pressed="false" aria-label="歌詞">歌</button>
  <button data-testid="whats-new-feed-button" aria-label="最新情報">新</button>
  </aside>
</div>
<script>
  document.querySelectorAll('[data-testid]').forEach((e) => { e.dataset.fx = e.dataset.testid; });
  window.__fx = { log: [], inputs: [], setTrack: (t) => { const a = document.querySelector('[data-fx="now-playing-widget-v2"] a, [data-testid="now-playing-widget-v2"] a'); if (a) a.textContent = t; if (navigator.mediaSession.metadata) navigator.mediaSession.metadata = new MediaMetadata({ title: t, artist: 'テスト歌手', artwork: [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=' }] }); } };
  // 歌詞の画面（React の部品）の再現: 本物の React と同じく、起動時に DevTools の入口へ自分を登録し、画面を更新するたびに根（FiberRoot）を知らせる。
  // 歌詞の行の部品は、外側と内側が同じ props（text / start / onObserve）を持つ（本物と同じ）。歌詞を出す間だけ、部品の木に行がある
  const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const fakeRoot = { current: { memoizedProps: null, child: null, sibling: null } };
  const rid = hook ? hook.inject({}) : 0;
  if (hook) hook.onCommitFiberRoot(rid, fakeRoot);
  function setLyrics(on) {
    if (!hook) return;
    const lines = on ? ['一行目の歌詞', '二行目の歌詞', '三行目（いま）', '四行目の歌詞', '五行目の歌詞', '六行目の歌詞'].map((t, i) => {
      const props = { text: t, start: i * 20000, onObserve() {}, translationText: undefined };
      return { memoizedProps: props, child: { memoizedProps: props, child: null, sibling: null }, sibling: null };
    }) : [];
    lines.forEach((l, i) => { if (i) lines[i - 1].sibling = l; });
    fakeRoot.current = { memoizedProps: null, child: { memoizedProps: {}, child: lines[0] || null, sibling: null }, sibling: null };
    hook.onCommitFiberRoot(rid, fakeRoot);
  }
  const log = (ev, d) => window.__fx.log.push({ ev, ...(d || {}) });
  const main = document.getElementById('main');
  function render() {
    const p = location.pathname;
    if (p.startsWith('/album/')) {
      main.innerHTML = '<h2>アルバム ' + p.split('/')[2] + '</h2>' +
        [1, 2, 3].map((i) => '<div role="row" tabindex="0" data-testid="tracklist-row" data-track="' + i + '"><button aria-label="曲' + i + 'を再生" data-track-play="' + i + '">▶</button><span>曲' + i + '</span></div>').join('');
    } else {
      main.innerHTML = '<div data-testid="home-page"><h2>人気の楽曲</h2><div class="shelf">' +
        ${JSON.stringify([['a1', '曲A'], ['a2', '曲B'], ['a3', '曲C']].map(([i, t]) => card(i, t)).join(''))} +
        '</div><h2>人気のアーティスト</h2><div class="shelf">' +
        ${JSON.stringify([['b1', '人D'], ['b2', '人E'], ['b3', '人F']].map(([i, t]) => card(i, t)).join(''))} + '</div></div>';
    }
  }
  const appRoot = document.querySelector('[data-testid="root"]'); // React 17+ は、根の要素でイベントを受ける（取り外された木の上でも動く）
  appRoot.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (a && a.getAttribute('target') !== '_blank') {
      e.preventDefault();
      history.pushState({}, '', a.getAttribute('href'));
      log('navigate', { to: location.pathname });
      render();
      return;
    }
    const b = e.target.closest('button');
    if (b && b.dataset.fx === 'more-button' && !document.getElementById('ctx')) {
      // サイトのコンテキストメニュー: role=menu。Esc で閉じる。外のものも候補になる（後ろに動かないことを確かめる）
      const m = document.createElement('div');
      m.id = 'ctx';
      m.setAttribute('role', 'menu');
      m.setAttribute('style', 'position: fixed; right: 20px; top: 60px; background: #333; padding: 8px; width: 200px; z-index: 50');
      ['プレイリストに追加', 'キューに追加', 'シェア'].forEach((t) => {
        const i = document.createElement('button');
        i.setAttribute('role', 'menuitem');
        i.textContent = t;
        i.style.display = 'block';
        m.appendChild(i);
      });
      document.body.appendChild(m);
      m.firstChild.focus();
      log('menu-open');
      return;
    }
    if (b && b.dataset.fx === 'login-button') log('login');
    if (b && b.getAttribute('role') === 'menuitem') { log('menu-item', { text: b.textContent }); }
    if (b && b.dataset.fx === 'lyrics-button') {
      // 歌詞は、歌詞ボタンが押されている間だけ DOM にある（サイトと同じ）。色の変数と、いまの行の色も同じ作り
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      setLyrics(on);
      log('lyrics', { on });
    }
    if (b && (b.hasAttribute('data-like') || b.dataset.fx === 'control-button-repeat')) b.setAttribute('aria-checked', String(b.getAttribute('aria-checked') !== 'true'));
    if (b && b.dataset.fx === 'control-button-playpause') b.setAttribute('aria-label', b.getAttribute('aria-label') === '再生' ? '一時停止' : '再生');
    if (b) log('click', { id: b.dataset.fx || (b.dataset.trackPlay ? 'track-' + b.dataset.trackPlay : b.getAttribute('aria-label')) });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.getElementById('ctx')) { document.getElementById('ctx').remove(); log('menu-close'); } });
  addEventListener('popstate', () => { log('popstate', { to: location.pathname }); render(); });
  document.querySelectorAll('input[type=range]').forEach((r) => { r.addEventListener('input', () => window.__fx.log.push({ ev: 'range', kind: r.max === '1' ? 'volume' : 'seek', value: Number(r.value) })); });
  document.querySelector('[data-testid="search-input"]').addEventListener('input', (e) => window.__fx.inputs.push(e.target.value));
  render();
  ${o.noSession || o.plain ? '' : `
  // 実サイトと同じく、メディアセッションに、曲の情報・再生状態・再生位置・操作の処理（ハンドラ）を登録する
  const ms = navigator.mediaSession;
  const L = (a, d) => window.__fx.log.push(Object.assign({ ev: 'ms', action: a }, d || {}));
  ${o.noTrack ? '' : `ms.metadata = new MediaMetadata({ title: 'テスト曲のタイトル', artist: 'テスト歌手', artwork: [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=' }] });`}
  ms.playbackState = 'paused';
  ms.setActionHandler('play', () => { ms.playbackState = 'playing'; L('play'); });
  ms.setActionHandler('pause', () => { ms.playbackState = 'paused'; L('pause'); });
  ms.setActionHandler('nexttrack', () => L('next'));
  ms.setActionHandler('previoustrack', () => L('prev'));
  ms.setActionHandler('seekto', (d) => { ms.setPositionState({ duration: 175.797, position: d.seekTime, playbackRate: 1 }); L('seekto', { time: d.seekTime }); });
  ms.setPositionState({ duration: 175.797, position: 50, playbackRate: 1 });
  `}
  ${o.plain ? `
  // 「サイトの作りが変わった」再現: 目印（data-testid）を全部外し、クラス名も意味のないものにする。曲の情報は mediaSession と audio、操作はボタンの表示名と範囲入力の並びだけで見つかる
  const strip = () => document.querySelectorAll('[data-testid]').forEach((e) => { e.removeAttribute('data-testid'); e.className = 'x' + Math.random().toString(36).slice(2, 7); });
  strip();
  new MutationObserver(strip).observe(document.body, { childList: true, subtree: true });
  // 本物の audio 要素（拡張は別の世界から見るので、ページ側で定義したプロパティは見えない）。20 秒の無音の WAV。再生・一時停止はボタンの押下に連動
  const au = document.createElement('audio');
  au.muted = true;
  const wav = (sec) => { const rate = 8000, n = rate * sec, b = new ArrayBuffer(44 + n), v = new DataView(b); const w = (o, t) => Array.from(t).forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); new Uint8Array(b, 44).fill(128); return b; };
  au.src = URL.createObjectURL(new Blob([wav(20)], { type: 'audio/wav' }));
  au.addEventListener('loadedmetadata', () => { au.currentTime = 10; });
  document.body.appendChild(au);
  document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.fx === 'control-button-playpause') { if (au.paused) au.play(); else au.pause(); } });
  ${o.noTrack ? '' : `navigator.mediaSession.metadata = new MediaMetadata({ title: 'テスト曲のタイトル', artist: 'テスト歌手', artwork: [{ src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=' }] });`}
  ` : ''}
</script></body></html>`;
}
