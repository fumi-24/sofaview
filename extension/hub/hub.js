/*
 * ハブ・診断・設定ページ共通のスクリプト: キー処理（SV.keys）と空間ナビ（SV.nav）を結線する。
 * ページ固有の処理は、このスクリプトより前に window.SVHubHooks として登録する:
 *   capture(e)       -> true ならキーを全面的に横取り（診断・キー入力待ち）
 *   onAction(a, e)   -> true なら処理済み（設定の項目切替など）
 *   initial          -> 初期フォーカス候補のセレクタ配列
 *   back             -> サブページで戻る/ホームのときの遷移先（既定 index.html）
 */
(function () {
  'use strict';

  const SV = self.SV;
  const html = document.documentElement;
  const page = html.getAttribute('data-page') || 'root';
  const DIR = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };
  const hooks = () => window.SVHubHooks || {};

  let matcher = SV.keys.createMatcher();
  const gate = new SV.keys.RepeatGate({ maxPerSec: 12 });
  SV.settings.load().then((s) => {
    matcher = SV.keys.createMatcher(s.bindings);
    window.SVHub.matcher = matcher;
  });
  SV.settings.onChange((s) => {
    matcher = SV.keys.createMatcher(s.bindings);
    window.SVHub.matcher = matcher;
  });

  const nav = SV.nav.createNavigator({
    regionOf: (el) => {
      const r = el.closest('[data-sv-region]');
      return r ? r.getAttribute('data-sv-region') : 'content';
    },
    crossRegion: { content: { left: 'rail' }, rail: { right: 'content' } },
    prefer: { rail: (pool) => pool.find((c) => c.el.getAttribute('aria-current') === 'page') || null },
  });

  window.SVHub = { nav, matcher, page };

  function leave() {
    location.href = hooks().back || 'index.html';
  }

  window.addEventListener(
    'keydown',
    (e) => {
      const h = hooks();
      if (h.capture && h.capture(e)) return;
      if (SV.keys.shouldIgnore(e)) return;
      const action = matcher.match(e);
      if (!action) return;
      if (h.onAction && h.onAction(action, e)) {
        SV.consume(e);
        return;
      }
      if (SV.keys.isDirection(action)) {
        SV.consume(e);
        if (gate.allow(action, e)) nav.move(DIR[action], { repeat: e.repeat });
        return;
      }
      if (action === 'OK') {
        if (!nav.current()) {
          SV.consume(e);
          nav.focusInitial(h.initial || ['.tile', '.row']);
        }
        return; // フォーカス中のリンク・ボタンはブラウザ標準の Enter に任せる
      }
      if (action === 'BACK' || action === 'HOME') {
        SV.consume(e);
        if (!e.repeat && page === 'sub') leave();
      }
    },
    true,
  );

  if (SV.remote) SV.remote.listen(); // スマホのリモコン（YouTube /tv が受け取ったキー）

  // 時計（ハブのみ）
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');
  function tick() {
    if (!timeEl) return;
    const d = new Date();
    timeEl.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    dateEl.textContent = d.getMonth() + 1 + '月' + d.getDate() + '日（' + '日月火水木金土'[d.getDay()] + '）';
  }
  tick();
  setInterval(tick, 10000);

  html.setAttribute('data-sv-ready', '1');
  nav.focusInitial(hooks().initial || ['.tile-yt', '.tile', '.row']);
})();
