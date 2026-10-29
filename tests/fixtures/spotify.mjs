// Spotify Web プレーヤー（open.spotify.com）の構造を縮小した再現ページ。ログアウト状態の実サイトで確かめた data-testid を使う。
// 実サイトにだけある要素は、ライブスモーク（tests/live）で見つかる。
export function spotifyHtml() {
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
    <div><a href="/album/np1">テスト曲のタイトル</a><span data-testid="now-playing-widget-v2-byline"><a href="/artist/np2">テスト歌手</a></span></div>
  </div>
  <div data-testid="player-controls">
    <button data-testid="control-button-skip-back" aria-label="前へ">⏮</button>
    <button data-testid="control-button-playpause" aria-label="再生">⏯</button><span data-testid="playback-position">0:50</span><span data-testid="playback-duration">2:55</span>
    <button data-testid="control-button-skip-forward" aria-label="次へ">⏭</button>
    <div data-testid="playback-progressbar" class="bar"><label class="hidden-visually">曲の再生位置を変える<input type="range" min="0" max="175797" step="5000" value="50000"></label><div data-testid="progress-bar" class="track"></div></div>
  </div>
  <div data-testid="volume-bar"><button data-testid="volume-bar-toggle-mute-button" aria-label="ミュート">🔈</button><div><div><label class="hidden-visually">音量を変える<input type="range" min="0" max="1" step="0.1" value="1"></label><div data-testid="progress-bar" class="track"></div></div></div></div>
  <button data-testid="lyrics-button" aria-pressed="false" aria-label="歌詞">歌</button>
  <button data-testid="whats-new-feed-button" aria-label="最新情報">新</button>
  </aside>
</div>
<script>
  window.__fx = { log: [], inputs: [] };
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
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/"]');
    if (a && a.getAttribute('target') !== '_blank') {
      e.preventDefault();
      history.pushState({}, '', a.getAttribute('href'));
      log('navigate', { to: location.pathname });
      render();
      return;
    }
    const b = e.target.closest('button');
    if (b && b.dataset.testid === 'lyrics-button') {
      // 歌詞は、歌詞ボタンが押されている間だけ DOM にある（サイトと同じ）。色の変数と、いまの行の色も同じ作り
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      const old = document.getElementById('lyr');
      if (old) old.remove();
      if (on) {
        const box = document.createElement('div');
        box.id = 'lyr';
        box.setAttribute('style', '--lyrics-color-active: rgba(255, 255, 255, 1); --lyrics-color-inactive: rgba(200, 209, 184, 1); position: fixed; left: -9999px');
        ['一行目の歌詞', '二行目の歌詞', '三行目（いま）', '四行目の歌詞', '五行目の歌詞', '六行目の歌詞'].forEach((t, i) => {
          const l = document.createElement('div');
          l.setAttribute('data-testid', 'lyrics-line');
          l.setAttribute('dir', 'auto');
          l.innerHTML = '<div style="color: ' + (i === 2 ? 'rgb(255, 255, 255)' : 'rgb(200, 209, 184)') + '">' + t + '</div>';
          box.appendChild(l);
        });
        document.body.appendChild(box);
      }
      log('lyrics', { on });
    }
    if (b && b.dataset.testid === 'control-button-playpause') b.setAttribute('aria-label', b.getAttribute('aria-label') === '再生' ? '一時停止' : '再生');
    if (b) log('click', { id: b.dataset.testid || (b.dataset.trackPlay ? 'track-' + b.dataset.trackPlay : b.getAttribute('aria-label')) });
  });
  addEventListener('popstate', () => { log('popstate', { to: location.pathname }); render(); });
  document.querySelectorAll('input[type=range]').forEach((r) => { r.addEventListener('input', () => window.__fx.log.push({ ev: 'range', kind: r.max === '1' ? 'volume' : 'seek', value: Number(r.value) })); });
  document.querySelector('[data-testid="search-input"]').addEventListener('input', (e) => window.__fx.inputs.push(e.target.value));
  render();
</script></body></html>`;
}
