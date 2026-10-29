/*
 * Spotify（open.spotify.com の Web プレーヤー）用コンテンツスクリプト。
 *  - 画面倍率（10 フィート表示）・マウスカーソルの自動非表示（共通）
 *  - 十字キーでフォーカス移動（空間ナビ）、OK で決定、戻る・ホーム、再生/一時停止・次・前
 *  - 検索欄は OK で画面上のキーボード（common/osk.js）
 * ログイン画面（accounts.spotify.com）は別サイトなので、拡張は動かない（そのまま）。
 * 画面そのものは作り替えない。Home で戻るときも、このタブは動かさない（遷移すると音楽が止まる。background の goHub）。
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.spotify || !SV.keys || !SV.nav || !SV.osk || !SV.settings) return;
  const S = SV.spotify;
  const html = document.documentElement;
  const DIR = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };

  const ctl = {
    matcher: SV.keys.createMatcher(),
    gate: new SV.keys.RepeatGate({ maxPerSec: 12 }),
    hold: new SV.keys.HoldDetector({ holdMs: 800 }),
    settings: SV.settings.defaults(),
    nav: null,
    osk: null,
    initialDone: false,
    userMoved: false,
  };
  html.classList.add('sv-sp');

  function applySettings(s) {
    ctl.settings = s;
    ctl.matcher = SV.keys.createMatcher(s.bindings);
    ctl.hold = new SV.keys.HoldDetector({ holdMs: s.holdMs });
  }
  SV.settings.load().then(applySettings);
  SV.settings.onChange(applySettings);

  // 画面倍率: TVer と同じ手順（SV.zoom.fit）。1 ページ読み込みにつき 1 回
  let zoomRequested = false;
  function requestZoom() {
    if (zoomRequested) return;
    zoomRequested = true;
    html.setAttribute('data-sv-zoom', 'pending');
    SV.zoom
      .fit({ height: () => window.innerHeight, dpr: () => window.devicePixelRatio, request: (msg) => SV.sendMessage(msg) })
      .then((r) => html.setAttribute('data-sv-zoom', r && r.ok ? 'done' : 'skipped'))
      .catch(() => html.setAttribute('data-sv-zoom', 'skipped'));
  }

  function goBack() {
    if (S.isRoot(location.pathname) || history.length <= 1) SV.goHub();
    else history.back();
  }

  const click = (sel) => {
    const b = document.querySelector(sel);
    if (b) b.click();
    return !!b;
  };

  // ---- 検索欄: React の入力欄に値を入れる（input イベントで知らせる）
  function setInputValue(el, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function openOskFor(el) {
    const spec = SV.osk.inputSpec(el);
    if (!spec) return false;
    ctl.osk.open({
      ...spec,
      title: '検索',
      value: el.value,
      doneLabel: '完了',
      host: el.closest('[role="dialog"]'),
      onChange: (text) => setInputValue(el, text), // Spotify の検索は、打つたびに結果が出る
      onDone: () => el.dispatchEvent(new Event('change', { bubbles: true })),
    });
    return true;
  }

  function onOskKey(e, action) {
    if (action === 'HOME') {
      SV.consume(e);
      if (!e.repeat) {
        ctl.osk.close();
        SV.goHub();
      }
      return;
    }
    if (action && !ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    ctl.osk.handleKey(e, action);
  }

  function onEditableKey(e, action) {
    const el = e.target;
    if (!action) return;
    if (action === 'BACK') {
      if (e.key === 'Escape') {
        SV.consume(e);
        el.blur();
      }
      return;
    }
    if (action === 'OK') {
      if (e.repeat || !SV.osk.inputSpec(el)) return;
      SV.consume(e);
      openOskFor(el);
      return;
    }
    if (!SV.keys.isDirection(action)) return;
    if (action === 'LEFT' || action === 'RIGHT') {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      const len = String(el.value || '').length;
      if (!(a != null && a === b && (action === 'LEFT' ? a === 0 : a === len))) return;
    }
    if (!ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    SV.consume(e);
    ctl.userMoved = true;
    ctl.nav.move(DIR[action], { repeat: e.repeat });
  }

  function onOk(e) {
    const a = document.activeElement;
    if (!ctl.nav.current()) {
      SV.consume(e);
      focusInitial();
      return;
    }
    // 曲の行: OK で再生（サイトの再生ボタンを押す）。ほかのリンク・ボタンはブラウザ標準の Enter に任せる
    if (a && a.matches && a.matches(S.SEL.row)) {
      SV.consume(e);
      if (a.matches(S.SEL.trackRow)) {
        // 曲の行: 再生（サイトの再生ボタン。なければ、行のダブルクリック）
        const play = a.querySelector('button[aria-label]');
        if (play) play.click();
        else a.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      } else {
        // 棚のカード: 開く（中のリンク）。なければ、中のボタン
        const target = a.querySelector('a[href]') || a.querySelector('button');
        if (target) target.click();
      }
    }
  }

  function onKeyDown(e) {
    if (SV.keys.shouldIgnore(e)) return;
    const action = ctl.matcher.match(e);
    if (ctl.osk && ctl.osk.isOpen()) return onOskKey(e, action);
    if (!action) return;

    if (action === 'HOME') {
      SV.consume(e);
      if (!e.repeat) SV.goHub();
      return;
    }
    if (SV.keys.isEditable(e.target)) {
      onEditableKey(e, action);
      return;
    }
    if (action === 'BACK' && ctl.settings.holdBackToHome && ctl.hold.feed('BACK', e)) {
      SV.consume(e);
      SV.goHub();
      return;
    }
    if (!ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    if (SV.keys.isDirection(action)) {
      SV.consume(e);
      ctl.userMoved = true;
      ctl.nav.move(DIR[action], { repeat: e.repeat });
      return;
    }
    if (action === 'OK') return onOk(e);
    if (action === 'BACK') {
      SV.consume(e);
      if (!e.repeat) goBack();
      return;
    }
    // 再生の操作（サイトの操作ボタンを押す）
    const transport = { PLAY_PAUSE: S.SEL.playPause, PLAY: S.SEL.playPause, PAUSE: S.SEL.playPause, NEXT: S.SEL.next, PREV: S.SEL.prev };
    if (transport[action] && !e.repeat) {
      if (click(transport[action])) SV.consume(e);
    }
  }

  function onKeyUp(e) {
    const action = ctl.matcher.match(e);
    if (ctl.osk && ctl.osk.isOpen() && (action === 'OK' || e.key === ' ')) {
      SV.consume(e); // 押したキーのボタンが、離した時に二重に押されない
      return;
    }
    if (action === 'BACK') ctl.hold.release('BACK');
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  // ---- 初期フォーカス: 内容（main）の中に候補が描画されたら、1 回だけ
  function focusInitial() {
    return ctl.nav.focusInitial(['main ' + S.SEL.row, 'main [role="button"][tabindex="0"]', 'main a[href]', 'main button'], { within: S.SEL.main });
  }

  function init() {
    ctl.nav = SV.nav.createNavigator({
      // 曲の行・棚のカード（role=row）は、サイトが tabindex=-1 にしている。行を 1 つの候補にして、中のボタン・リンクは外す（OK で開く・再生する）
      selector: SV.nav.DEFAULT_SELECTOR + ', ' + S.SEL.row,
      // 検索欄は文字入力欄だが、候補にする（OK で画面上のキーボード）
      exclude: (el) => (el.matches(S.SEL.searchInput) ? S.isExcluded(el) : SV.nav.defaultExclude(el) || S.isExcluded(el) || el.matches(S.SEL.grid) || (!el.matches(S.SEL.row) && !!el.closest(S.SEL.row))),
    });
    ctl.osk = SV.osk.create({ document });
    requestZoom();
    // 音楽を流したまま別のタブへ移れるよう、このタブは休止・破棄されないようにする
    SV.sendMessage({ type: 'sv:remoteKeep' });
    const tryInitial = () => {
      if (ctl.initialDone || ctl.userMoved) return;
      if (ctl.nav.current()) {
        ctl.initialDone = true;
        return;
      }
      if (focusInitial()) ctl.initialDone = true;
    };
    new MutationObserver(tryInitial).observe(document.body, { childList: true, subtree: true });
    // ページの遷移（SPA）: 描画し直されたら、また初期フォーカス（操作の途中でなければ）
    let path = location.pathname;
    setInterval(() => {
      if (location.pathname === path) return;
      path = location.pathname;
      ctl.initialDone = false;
      ctl.userMoved = false;
      tryInitial();
    }, 300);
    // 描画が終わっても DOM が変わらないことがあるので、落ち着くまで定期的にも試す
    const retry = setInterval(() => {
      tryInitial();
      if (ctl.initialDone) clearInterval(retry);
    }, 500);
    tryInitial();
    setTimeout(() => {
      ctl.initialDone = true;
      clearInterval(retry);
    }, 15000);
    html.setAttribute('data-sv-ready', '1');
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
