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

  // 裏で /tv を開いておく設定のとき: ここで開いておき、YouTube タイルは裏の /tv を前面に出す（もう 1 つ開かない）
  SV.sendMessage({ type: 'sv:ensureReceiver' });
  document.addEventListener(
    'click',
    (e) => {
      const tile = e.target.closest && e.target.closest('a[data-id="youtube"], a[data-id="spotify"]');
      if (!tile || e.defaultPrevented) return;
      e.preventDefault();
      // 開いているタブがあればそれを前面に出す（Spotify は音楽を止めない）。なければ、同じタブで開く
      SV.sendMessage({ type: tile.dataset.id === 'spotify' ? 'sv:openSpotify' : 'sv:openYoutube' }).then((r) => {
        if (!(r && r.ok)) location.href = tile.href;
      });
    },
    true,
  );

  // どの版が読み込まれているか分かるように、クレジットの行に版を出す（拡張機能を更新したかの確認用）
  for (const c of document.querySelectorAll('.credit:not(#remote-line)')) c.textContent = 'SofaView v' + SV.VERSION + ' ・ by fumi24';

  // 裏で /tv を開いておく設定（キャスト待機）の状態を一行で出す（キー診断まで行かなくても分かる）
  const remoteLine = document.getElementById('remote-line');
  async function showRemote() {
    const r = await SV.sendMessage({ type: 'sv:remoteStatus' });
    if (!remoteLine) return;
    remoteLine.hidden = false;
    if (!r || !r.ok) {
      remoteLine.textContent = 'キャスト待機　状態を取得できません（拡張機能を再読み込みしてください）';
      return;
    }
    if (!r.setting) {
      remoteLine.textContent = 'キャスト待機　「裏で YouTube を開いておく」設定がオフです';
      return;
    }
    const age = (t) => Math.max(0, Math.round((r.now - t) / 1000)) + ' 秒前';
    const loads = r.loads ? '・読み込み ' + r.loads.n + ' 回（' + age(r.loads.at) + '）' : '';
    const tab = r.yt.length ? (r.yt[0].discarded ? '/tv: 破棄された' : '/tv: ' + (r.yt[0].active ? '前面' : '裏')) + loads : '/tv: なし';
    const how = { activate: '前面に出した', create: '新しく開いた', off: '設定オフで普通に開いた' };
    const open = r.openLast ? ' ／ タイル: ' + (how[r.openLast.how] || r.openLast.how) + '（' + age(r.openLast.at) + '）' : '';
    const cmd = r.lounge && r.lounge[0] ? '最後の命令: ' + r.lounge[0].n + '（' + age(r.lounge[0].at) + '）' : '命令: まだなし';
    remoteLine.textContent = 'キャスト待機　' + tab + open + ' ／ ' + cmd;
  }
  if (remoteLine) {
    showRemote();
    setInterval(showRemote, 2000);
  }


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
