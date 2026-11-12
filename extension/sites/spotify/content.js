/*
 * Spotify（open.spotify.com の Web プレーヤー）用コンテンツスクリプト。タブは 1 つ。このページが、そのまま、自前の再生中の画面になる。
 *   - Spotify 自身の画面は、起動のとき、文書の外に描かせる（boot-main.js）。通信・再生・状態は、アプリ自身のサービスがそのまま行う。
 *   - 自前の画面（ui.js）を、全画面で出す。状態・操作は、読み取り役（engine.js。アプリのサービス → メディアセッション）。
 *   - スマホから再生が始まった（曲が変わった）ら、background に知らせる（設定 spotify.standby のとき、このタブが前面に出る）。ハブのタイルに、状態を知らせる。
 *   - 診断（hub/spotify-diag.html。読み取りだけ）の依頼を受ける。
 * ログイン画面（accounts.spotify.com）は別サイトなので、拡張は動かない（そのまま）。
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.spotifyCore || !SV.spotifyEngine || !SV.spotifyUI || !SV.keys || !SV.settings) return;
  const E = SV.spotifyEngine;
  const html = document.documentElement;
  html.classList.add('sv-sp');

  const ctl = { settings: SV.settings.defaults() };
  SV.settings.load().then((s) => (ctl.settings = s));
  SV.settings.onChange((s) => (ctl.settings = s));

  function init() {
    const reader = E.createReader({
      document,
      getLyrics: () => ctl.settings.spotify.lyrics,
      getMv: () => ctl.settings.spotify.mvLayout,
      getMvAuto: () => ctl.settings.spotify.mvAuto,
      onDiag: (report) => SV.sendMessage({ type: 'sv:spDiag', report }), // 診断の報告を、診断ページへ送る
    });
    SV.spotifyUI.start({ reader });
    SV.sendMessage({ type: 'sv:remoteKeep' }); // 音楽を流したまま別のタブへ移れるよう、このタブは休止・破棄されないようにする
    if (SV.hasChrome()) {
      try {
        navigator.locks.request('sv-spotify-keepalive', () => new Promise(() => {}));
      } catch (e) {
        /* 使えない環境では何もしない */
      }
    }

    // 裏のタブ（待機）でも、曲の変化を見る。裏のタブはタイマーが間引かれる（1 秒に 1 回まで。音が出ている間は間引かれない）。アプリの状態が変わったときにも見る
    let lastTitle;
    let lastTileSig = '';
    const watch = () => {
      const s = reader.snapshot();
      const i = s.info;
      // スマホから再生が始まった（曲が変わった）: このタブを前面に出す（設定 spotify.standby。background が決める）。最初に読んだ曲は、基準にするだけ
      if (lastTitle !== undefined && i.title && i.title !== lastTitle) SV.sendMessage({ type: 'sv:spotifyWake' });
      lastTitle = i.title;
      // ハブのタイルに出す状態（再生中・待機中・ログインしていない…）。変わったときだけ
      const sig = s.kind + '|' + i.title;
      if (sig !== lastTileSig) {
        lastTileSig = sig;
        SV.sendMessage({ type: 'sv:spotifyState', kind: s.kind, title: i.title, artists: i.artists });
      }
    };
    E.onSessionChange(watch);
    setInterval(watch, 1000);
    watch();

    if (SV.hasChrome()) {
      chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (!msg || msg.type !== 'sv:spCmd') return false;
        if (msg.cmd === 'diag') reader.command('diag'); // 診断ページからの依頼（読み取りだけ）
        sendResponse({ ok: true });
        return false;
      });
    }

    // 起動のときの読み込みの骨組み（#main の中。HTML に最初から入っている）は、Spotify 自身の画面が文書の外に描かれるなら、要らない。取り除く
    setTimeout(() => {
      const main = document.getElementById('main');
      if (main && html.getAttribute('data-sv-detached') === '1') main.replaceChildren(); // boot-main.js が描画先を替えたときだけ
    }, 6000);
    html.setAttribute('data-sv-ready', '1');
  }

  if (document.body) init();
  else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
