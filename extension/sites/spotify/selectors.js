/*
 * Spotify（open.spotify.com の Web プレーヤー）固有のセレクタ。**サイトの DOM 依存はここに集約する**。
 * data-testid（サイトのテスト用の属性。クラス名より安定）を使う。調査日: 2026-10-29（ログアウト状態の画面。ログイン後の画面は未確認 ❔）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  const SEL = Object.freeze({
    playPause: '[data-testid="control-button-playpause"]',
    next: '[data-testid="control-button-skip-forward"]',
    prev: '[data-testid="control-button-skip-back"]',
    searchInput: '[data-testid="search-input"]',
    trackRow: '[data-testid="tracklist-row"]',
    row: '[role="row"]', // 曲の行・棚のカード（サイトは role=row・tabindex=-1 で並べる）。行を 1 つの候補にする
    grid: '[role="grid"], [role="treegrid"]',
    playButton: '[data-testid="play-button"], button[data-testid="play-button"]',
    main: 'main',
    homePage: '[data-testid="home-page"]',
  });

  const HOST = 'open.spotify.com';

  /** 候補から外す: 画面に出ない補助の要素・別サイトへのリンク（遷移すると音楽が止まる・戻れなくなる）。 */
  function isExcluded(el) {
    if (!el || !el.matches) return true;
    if (el.matches('[data-testid$="sentinel"], [data-testid="LayoutResizer__resize-bar"], [data-testid="language-selection-modal"] *')) return true;
    if (el.closest('[aria-hidden="true"]')) return true;
    if (el.matches('a[href]')) {
      if (el.getAttribute('target') === '_blank') return true;
      try {
        if (new URL(el.href, location.href).host !== HOST) return true;
      } catch (e) {
        return true;
      }
    }
    return false;
  }

  /** ルート（ホーム）か。ここで「戻る」を押したらハブへ。 */
  function isRoot(pathname) {
    return /^\/(intl-[a-z-]+\/)?$/i.test(pathname || '');
  }

  SV.spotify = { SEL, HOST, isExcluded, isRoot };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotify;
})(typeof self !== 'undefined' ? self : globalThis);
