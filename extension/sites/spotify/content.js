/*
 * Spotify（open.spotify.com の Web プレーヤー）用コンテンツスクリプト。
 * このタブは、拡張が作る「再生中の画面」（nowplaying.js）だけを出す。Spotify 本来の画面は、見せない・動かさない（CSS: spotify.css で描画しない）。
 * 本来の画面の DOM は、音楽を鳴らす本体（再生エンジン）として残す。曲の情報の読み取りとボタンの押下にだけ使う。
 *  - キー: OK・← →（ボタンの列）・↑ ↓（音量）・再生/次/前のメディアキー・戻る（列を隠す。長押しでホーム）・Home（ハブへ。このタブは動かさない）
 *  - スマホから再生が始まったら、裏のタブなら前面に出る（background）。ハブのタイルに状態を出す
 * ログイン画面（accounts.spotify.com）は別サイトなので、拡張は動かない（そのまま）。
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.spotifyNp || !SV.keys || !SV.settings) return;
  const html = document.documentElement;

  const ctl = {
    matcher: SV.keys.createMatcher(),
    gate: new SV.keys.RepeatGate({ maxPerSec: 12 }),
    hold: new SV.keys.HoldDetector({ holdMs: 800 }),
    settings: SV.settings.defaults(),
    np: null, // 再生中の大きな画面
  };
  html.classList.add('sv-sp');

  function applySettings(s) {
    ctl.settings = s;
    ctl.matcher = SV.keys.createMatcher(s.bindings);
    ctl.hold = new SV.keys.HoldDetector({ holdMs: s.holdMs });
  }
  SV.settings.load().then(applySettings);
  SV.settings.onChange(applySettings);

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

  /** キー。すべてここで受ける（本来の画面へは渡さない）。 */
  function onKeyDown(e) {
    if (SV.keys.shouldIgnore(e)) return;
    const action = ctl.matcher.match(e);
    SV.consume(e);
    if (!action) return;
    if (action === 'HOME') {
      if (!e.repeat) SV.goHub();
      return;
    }
    if (action === 'BACK') {
      if (ctl.settings.holdBackToHome && ctl.hold.feed('BACK', e)) SV.goHub(); // 長押しでホーム
      else if (!e.repeat) ctl.np.hideBar(); // ボタンの列が出ていれば隠す
      return;
    }
    if (!ctl.gate.allow(action, e)) return;
    ctl.np.handleAction(action);
  }

  function onKeyUp(e) {
    if (SV.keys.shouldIgnore(e)) return;
    SV.consume(e); // 離したときも、本来の画面には渡さない（サイトが keyup で動くことがあっても、干渉させない）
    if (ctl.matcher.match(e) === 'BACK') ctl.hold.release('BACK');
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
  window.addEventListener('keypress', guard((e) => !SV.keys.shouldIgnore(e) && SV.consume(e)), true);

  /** 拡張が動いていることと版を、読み込み直後に 4 秒だけ出す（更新できているかの確認用）。 */
  function showBadge() {
    const b = document.createElement('div');
    b.id = 'sv-badge';
    b.textContent = 'SofaView v' + SV.VERSION + '（Spotify）';
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 4000);
  }

  function init() {
    ctl.np = SV.spotifyNp.create({
      document,
      getLyrics: () => ctl.settings.spotify.lyrics,
      onLyrics: (v) => {
        ctl.settings.spotify.lyrics = v; // すぐ反映する（保存の反映を待たない）
        SV.settings.save({ spotify: { lyrics: v } });
      },
    });
    // 音楽を流したまま別のタブへ移れるよう、このタブは休止・破棄されないようにする
    SV.sendMessage({ type: 'sv:remoteKeep' });

    // スマホから再生が始まった（曲が変わった）ら、background に知らせる。裏のタブなら前面に出る。
    // 裏のタブはタイマーが間引かれる（5 分後から 1 分に 1 回）ので、タイマーではなく DOM の変化で見る。最初に読んだ曲は、基準にするだけ
    let lastTitle;
    const watchTrack = () => {
      const t = SV.spotifyNp.trackTitle(document);
      if (lastTitle !== undefined && t && t !== lastTitle) SV.sendMessage({ type: 'sv:spotifyWake' });
      lastTitle = t;
    };
    // ハブのタイルに出す状態（再生中・待機中・ログインしていない…）を、background に知らせる。変わったときだけ、500ms に 1 回まで
    let lastSig = '';
    let lastAt = 0;
    const reportState = () => {
      const now = Date.now();
      if (now - lastAt < 500) return;
      lastAt = now;
      const d = ctl.np.status();
      const sig = d.kind + '|' + d.info.title;
      if (sig === lastSig) return;
      lastSig = sig;
      SV.sendMessage({ type: 'sv:spotifyState', kind: d.kind, title: d.info.title, artists: d.info.artists });
    };
    if (SV.hasChrome()) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'sv:openNp') openNp();
      });
      try {
        navigator.locks.request('sv-spotify-keepalive', () => new Promise(() => {}));
      } catch (e) {
        /* 使えない環境では何もしない */
      }
    }

    // 見張りは再生バーの中だけ（ページ全体を見ると、サイトの描画のたびに動いて重い）。バーが現れるまでは、要素の追加・削除だけ。250ms に 1 回まで
    let obs = null;
    let obsTarget = null;
    let lastRun = 0;
    const tick = () => {
      const now = Date.now();
      if (now - lastRun < 250) return;
      lastRun = now;
      watchTrack();
      reportState();
      ensureObserver();
    };
    function ensureObserver() {
      const bar = SV.spotifyNp.find(document, 'bar');
      const target = bar || document.body;
      if (obs && obsTarget === target && target.isConnected) return;
      if (obs) obs.disconnect();
      obsTarget = target;
      obs = new MutationObserver(tick);
      obs.observe(target, bar ? { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'src', 'href'] } : { childList: true, subtree: true });
    }
    ensureObserver();
    watchTrack();
    reportState();

    openNp(); // 読み込んだら開き、閉じない
    // 再生中の画面が開けなかったときだけ、本来の画面を出す（何も操作できなくなるのを避ける、最後の手段）
    setTimeout(() => {
      if (!ctl.np.isOpen()) html.classList.add('sv-np-failed');
    }, 10000);
    html.setAttribute('data-sv-ready', '1');
    html.setAttribute('data-sv-zoom', 'skipped'); // 画面倍率は使わない（再生中の画面は vh の寸法）
    showBadge();
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
