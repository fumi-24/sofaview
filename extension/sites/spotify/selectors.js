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
    seekInput: '[data-testid="playback-progressbar"] input[type="range"]',
    slider: '[data-testid="now-playing-bar"] input[type="range"]', // 再生位置・音量（画面には出ない input。隣の棒が見た目）
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
    if (el.matches('input[type="range"]')) return true; // 画面に出ない本体（棒の容器 data-sv-slider が候補）。位置は画面の外にある
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

  /**
   * 再生バーの再生位置・音量の棒: 本体の input[type=range] は画面に出ない（hidden-visually）ので、フォーカスできる見た目の容器に印を付ける。
   * 容器 = input の label の親（再生位置は data-testid="playback-progressbar"）。印は data-sv-slider（seek / volume）。
   */
  function markSliders(doc) {
    for (const input of doc.querySelectorAll(SEL.slider)) {
      const label = input.closest('label');
      const box = label && label.parentElement;
      if (!box || box.hasAttribute('data-sv-slider')) continue;
      box.setAttribute('data-sv-slider', input.matches(SEL.seekInput) ? 'seek' : 'volume');
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'slider');
      box.setAttribute('aria-label', input.matches(SEL.seekInput) ? '再生位置' : '音量');
    }
  }

  /** 棒を動かす（向き: 1 = 右・-1 = 左）。再生位置は 10 秒（step 5000 の 2 つ分）、音量は step 1 つ分（0.1）。サイトの React が input イベントで気づく。 */
  function stepSlider(box, dir) {
    const input = box && box.querySelector('input[type="range"]');
    if (!input) return false;
    const n = box.getAttribute('data-sv-slider') === 'seek' ? 2 : 1;
    if (dir > 0) input.stepUp(n);
    else input.stepDown(n);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  /**
   * 右の「再生中ビュー」の列（#Desktop_PanelContainer_Id）を、グリッドの直下の要素ごと隠す印を付ける（大きな画面は拡張が作るので要らない）。
   * 列は画面の幅を使う（TV の画面で、内容の列が細くなる）。グリッド = 左のライブラリ（#Desktop_LeftSidebar_Id）の親。
   */
  function markPanel(doc) {
    const panel = doc.getElementById('Desktop_PanelContainer_Id');
    const left = doc.getElementById('Desktop_LeftSidebar_Id');
    if (!panel || !left || !left.parentElement) return;
    let el = panel;
    while (el.parentElement && el.parentElement !== left.parentElement) el = el.parentElement;
    if (el.parentElement === left.parentElement && !el.hasAttribute('data-sv-hide')) el.setAttribute('data-sv-hide', '');
  }

  /** ルート（ホーム）か。ここで「戻る」を押したらハブへ。 */
  function isRoot(pathname) {
    return /^\/(intl-[a-z-]+\/)?$/i.test(pathname || '');
  }

  SV.spotify = { SEL, HOST, isExcluded, isRoot, markSliders, stepSlider, markPanel };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotify;
})(typeof self !== 'undefined' ? self : globalThis);
