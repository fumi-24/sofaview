/*
 * Spotify（open.spotify.com の Web プレーヤー）用コンテンツスクリプト。Spotify のタブは、再生エンジンとして、見えない裏のタブに置く。
 * 画面（再生中の画面）は、拡張の自前ページ spotify/np.html。このタブの画面は、いじらない・隠さない・キーも奪わない。
 *  - 読み取った状態（曲・再生位置・歌詞・状態の種類）を、自前ページへ送る（変わったとき・位置が飛んだとき・5 秒おき）
 *  - 自前ページからの操作の依頼（再生・次・前・シーク・音量・歌詞）を、メディアセッションなどで実行する（engine.js）
 *  - Home キーだけ受ける（ログイン画面などで、このタブが前面に出ているとき、自前ページ・ハブへ戻れるように）
 *  - スマホから再生が始まった（曲が変わった）ら、background に知らせる（設定 spotify.standby のとき、自前ページが前面に出る）
 * ログイン画面（accounts.spotify.com）は別サイトなので、拡張は動かない（そのまま）。
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.spotifyCore || !SV.spotifyEngine || !SV.keys || !SV.settings) return;
  const E = SV.spotifyEngine;

  const ctl = { matcher: SV.keys.createMatcher(), settings: SV.settings.defaults(), reader: null };

  function applySettings(s) {
    ctl.settings = s;
    ctl.matcher = SV.keys.createMatcher(s.bindings);
  }
  SV.settings.load().then(applySettings);
  SV.settings.onChange(applySettings);

  // Home だけ受ける（ほかのキーは、Spotify のページにそのまま渡す）
  window.addEventListener(
    'keydown',
    (e) => {
      try {
        if (SV.keys.shouldIgnore(e) || ctl.matcher.match(e) !== 'HOME') return;
        SV.consume(e);
        if (!e.repeat) SV.goHub();
      } catch (err) {
        console.error('[SV] spotify key handler', err);
      }
    },
    true,
  );

  function init() {
    const reader = (ctl.reader = E.createReader({
      document,
      getLyrics: () => ctl.settings.spotify.lyrics,
      onDrm: () => check(true),
      onDiag: (report) => SV.sendMessage({ type: 'sv:spDiag', report }), // 診断の報告を、診断ページへ送る
    }));
    SV.sendMessage({ type: 'sv:remoteKeep' }); // 音楽を流したまま別のタブへ移れるよう、このタブは休止・破棄されないようにする
    if (SV.hasChrome()) {
      try {
        navigator.locks.request('sv-spotify-keepalive', () => new Promise(() => {}));
      } catch (e) {
        /* 使えない環境では何もしない */
      }
    }

    const sigOf = (L) => L.length + '|' + (L[0] ? L[0].text : '') + '|' + (L.length ? L[L.length - 1].text : '');
    let last = null;
    let lastSig = '';
    let lastTileSig = '';
    let lastSentAt = 0;
    let lastTitle;
    /** 状態を読んで、変わったとき・位置が飛んだとき・5 秒たったとき（force なら必ず）、自前ページへ送る。 */
    function check(force) {
      const s = reader.snapshot();
      const i = s.info;
      // スマホから再生が始まった（曲が変わった）: 自前ページを前面に出す（設定 spotify.standby。background が決める）。最初に読んだ曲は、基準にするだけ
      if (lastTitle !== undefined && i.title && i.title !== lastTitle) SV.sendMessage({ type: 'sv:spotifyWake' });
      lastTitle = i.title;
      const sig = [s.kind, i.title, i.artists, i.cover, i.playing, i.durationSec, i.volume != null ? Math.round(i.volume * 20) : '', s.lyrics.on, sigOf(s.lyrics.lines), Math.min(s.lyrics.asks, 30), s.drm].join('|');
      let jumped = false;
      if (last && last.info.positionSec != null && i.positionSec != null) {
        const expected = last.info.positionSec + (last.info.playing ? (s.at - last.at) / 1000 : 0);
        jumped = Math.abs(i.positionSec - expected) > 1.5; // シーク・曲の変わり目
      }
      if (force || sig !== lastSig || jumped || s.at - lastSentAt >= 5000) {
        lastSig = sig;
        lastSentAt = s.at;
        last = s;
        SV.sendMessage({ type: 'sv:spState', state: s });
      }
      // ハブのタイルに出す状態（再生中・待機中・ログインしていない…）。変わったときだけ
      const tileSig = s.kind + '|' + i.title;
      if (tileSig !== lastTileSig) {
        lastTileSig = tileSig;
        SV.sendMessage({ type: 'sv:spotifyState', kind: s.kind, title: i.title, artists: i.artists });
      }
    }

    if (SV.hasChrome()) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'sv:spCmd') return false;
        try {
          if (msg.cmd !== 'hello') reader.command(msg.cmd, msg.arg);
          if (msg.cmd === 'diag') {
            sendResponse({ ok: true });
            return false;
          }
          check(true);
          // 操作の結果（Spotify が位置・状態を出し直す）を、すぐ後にも送る
          setTimeout(() => check(true), 300);
          setTimeout(() => check(true), 1200);
          sendResponse({ ok: true });
        } catch (err) {
          console.error('[SV] spotify command', err);
          sendResponse({ ok: false, error: String(err) });
        }
        return false;
      });
    }

    // 変化の見張り: 再生バーの中だけ（ページ全体を見ると、サイトの描画のたびに動いて重い）。バーが現れるまでは、要素の追加・削除だけ。メディアセッションの変化でも見る
    let obs = null;
    let obsTarget = null;
    let lastRun = 0;
    const tick = () => {
      const now = Date.now();
      if (now - lastRun < 250) return;
      lastRun = now;
      check(false);
      ensureObserver();
    };
    function ensureObserver() {
      const bar = E.find(document, 'bar');
      const target = bar || document.body;
      if (obs && obsTarget === target) return;
      if (obs) obs.disconnect();
      obsTarget = target;
      obs = new MutationObserver(tick);
      obs.observe(target, bar ? { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'src', 'href'] } : { childList: true, subtree: true });
    }
    ensureObserver();
    E.onSessionChange(tick);
    // 裏のタブはタイマーが間引かれる（1 秒に 1 回まで。音が出ている間は間引かれない）。歌詞の問い合わせと位置の確認のため、1 秒おきにも見る
    setInterval(() => check(false), 1000);
    check(true);
    document.documentElement.setAttribute('data-sv-ready', '1');
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
