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
  if (!SV || !SV.spotify || !SV.spotifyNp || !SV.keys || !SV.nav || !SV.osk || !SV.settings) return;
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
    np: null, // 再生中の大きな画面
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

  // Spotify の画面は文字が小さめなので、TVer（720）より小さい高さに合わせて、大きく拡大する（自動のときだけ効く）
  const ZOOM_TARGET = 648;

  // 画面倍率: TVer と同じ手順（SV.zoom.fit）。1 ページ読み込みにつき 1 回
  let zoomRequested = false;
  function requestZoom() {
    if (zoomRequested) return;
    zoomRequested = true;
    html.setAttribute('data-sv-zoom', 'pending');
    SV.zoom
      .fit({ height: () => window.innerHeight, dpr: () => window.devicePixelRatio, request: (msg) => SV.sendMessage({ ...msg, targetHeight: ZOOM_TARGET }) })
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
    // 再生バーのジャケット: 再生中の大きな画面を開く（サイトの「再生中ビュー」は使わない）
    if (a && a.matches && a.matches(SV.spotifyNp.SEL.coverButton)) {
      SV.consume(e);
      openNp();
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

  /** 再生中の大きな画面を開く。サイトの作りが想定と違って失敗しても、キー操作は止めない（途中まで作った画面は閉じる）。 */
  function openNp() {
    try {
      ctl.np.open();
    } catch (err) {
      console.error('[SV] 再生中の画面を開けませんでした', err);
      try {
        ctl.np.close();
      } catch (e2) {
        /* 何もしない */
      }
    }
  }

  /** 再生中の大きな画面が開いている間のキー。すべてここで受ける（ページへは渡さない）。 */
  function onNpKey(e, action) {
    SV.consume(e);
    if (!action) return;
    if (action === 'HOME') {
      if (!e.repeat) {
        ctl.np.close();
        SV.goHub();
      }
      return;
    }
    if (action === 'BACK' || action === 'YELLOW') {
      if (!e.repeat) ctl.np.close();
      return;
    }
    if (!ctl.gate.allow(action, e)) return;
    const seek = (dir) => {
      const box = document.querySelector('[data-sv-slider="seek"]');
      if (box) S.stepSlider(box, dir);
    };
    if (action === 'OK' || action === 'PLAY_PAUSE' || action === 'PLAY' || action === 'PAUSE') click(S.SEL.playPause);
    else if (action === 'LEFT' || action === 'SEEK_BACK') seek(-1);
    else if (action === 'RIGHT' || action === 'SEEK_FWD') seek(1);
    else if (action === 'UP' || action === 'PREV') click(S.SEL.prev);
    else if (action === 'DOWN' || action === 'NEXT') click(S.SEL.next);
    setTimeout(() => ctl.np.refresh(), 150);
  }

  function onKeyDown(e) {
    if (SV.keys.shouldIgnore(e)) return;
    const action = ctl.matcher.match(e);
    if (ctl.osk && ctl.osk.isOpen()) return onOskKey(e, action);
    if (ctl.np && ctl.np.isOpen()) return onNpKey(e, action);
    if (!action) return;
    if (action === 'YELLOW') {
      SV.consume(e);
      if (!e.repeat) openNp();
      return;
    }

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
    // 再生位置・音量の棒: OK で「調整中」（← → で動かす）。↑ ↓・OK・戻るで調整を終える。調整中でなければ、← → は普通のフォーカス移動
    const cur = document.activeElement;
    const adjusting = cur && cur.hasAttribute && cur.hasAttribute('data-sv-adjusting');
    if (adjusting) {
      if (action === 'LEFT' || action === 'RIGHT') {
        SV.consume(e);
        S.stepSlider(cur, action === 'RIGHT' ? 1 : -1);
        return;
      }
      cur.removeAttribute('data-sv-adjusting');
      if (action === 'OK' || action === 'BACK') {
        SV.consume(e);
        return;
      }
    }
    if (action === 'OK' && cur && cur.hasAttribute && cur.hasAttribute('data-sv-slider')) {
      SV.consume(e);
      cur.setAttribute('data-sv-adjusting', '');
      return;
    }
    if (SV.keys.isDirection(action)) {
      SV.consume(e);
      ctl.userMoved = true;
      ctl.nav.move(DIR[action], { repeat: e.repeat });
      return;
    }
    if (action === 'OK') return onOk(e);
    // 早送り・巻き戻しのキー: 再生位置を 10 秒動かす
    if (action === 'SEEK_FWD' || action === 'SEEK_BACK') {
      const box = document.querySelector('[data-sv-slider="seek"]');
      if (box && S.stepSlider(box, action === 'SEEK_FWD' ? 1 : -1)) SV.consume(e);
      return;
    }
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

  // サイトの作りが想定と違って例外になっても、原因が分かるように記録する（キー操作は 1 回ぶん失うだけ）
  const guard = (fn) => (e) => {
    try {
      fn(e);
    } catch (err) {
      console.error('[SV] spotify key handler', err);
    }
  };
  window.addEventListener('keydown', guard(onKeyDown), true);
  window.addEventListener('keyup', guard(onKeyUp), true);

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
    ctl.np = SV.spotifyNp.create({ document });
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
    new MutationObserver(() => {
      S.markSliders(document);
      S.markPanel(document);
      tryInitial();
    }).observe(document.body, { childList: true, subtree: true });
    S.markSliders(document);
    S.markPanel(document);
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
