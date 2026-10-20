/*
 * YouTube /tv（公式の TV 向け UI）用コンテンツスクリプト。
 * /tv は十字キー・Enter・Esc・Backspace を自前で処理するので、拡張が行うのは次の 2 つだけ:
 *  - HOME（Home / BrowserHome）→ ハブへ（/tv は Home を処理しない）
 *  - 戻るキー長押し → ハブへ（設定で有効にした場合）
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.keys || !SV.settings) return;
  const html = document.documentElement;
  html.classList.add('sv-yt');

  let settings = SV.settings.defaults();
  let matcher = SV.keys.createMatcher();
  let hold = new SV.keys.HoldDetector({ holdMs: settings.holdMs });

  function apply(s) {
    settings = s;
    matcher = SV.keys.createMatcher(s.bindings);
    hold = new SV.keys.HoldDetector({ holdMs: s.holdMs });
  }
  SV.settings.load().then(apply);
  SV.settings.onChange(apply);

  window.addEventListener(
    'keydown',
    (e) => {
      if (SV.keys.shouldIgnore(e)) return;
      const action = matcher.match(e);
      if (action === 'HOME') {
        SV.consume(e);
        if (!e.repeat) SV.goHub();
        return;
      }
      if (action === 'BACK' && settings.holdBackToHome) {
        if (e.repeat) SV.consume(e); // 長押し中の連続「戻る」は /tv に渡さない
        if (hold.feed('BACK', e)) {
          SV.consume(e);
          SV.goHub();
        }
      }
    },
    true,
  );

  // /tv が「アプリを終わらせる」ために window.close() を呼んだら（exit-main.js が知らせる）、ブラウザを閉じずにハブへ戻す
  let leaving = false;
  window.addEventListener('message', (m) => {
    if (m.source !== window || !m.data || m.data.svExit !== 1 || leaving) return;
    leaving = true;
    SV.goHub();
  });

  // スマホから YouTube を送られると、/tv は再生画面（#/watch）になる。裏のタブなら前面に出す（background が前面かどうか見る）
  const wake = () => {
    if (/^#\/watch/.test(location.hash)) SV.sendMessage({ type: 'sv:wake' });
  };
  window.addEventListener('hashchange', wake);

  // スマホのリモコン（YouTube アプリの「テレビで見る」）。/tv が受け取った十字キー・決定・戻るを、前面の TVer・ハブへ渡す。
  // 受け取り役のタブは裏に置かれるので、ブラウザに休止・破棄されないようにする（効果は実機で確認）
  if (SV.remote && SV.hasChrome()) {
    try {
      navigator.locks.request('sv-remote-keepalive', () => new Promise(() => {}));
      chrome.runtime.sendMessage({ type: 'sv:remoteKeep' }, () => void chrome.runtime.lastError);
    } catch (e) {
      /* 使えない環境では何もしない */
    }
    SV.remote.watchYoutube(window, (name) => {
      try {
        chrome.runtime.sendMessage({ type: 'sv:remote', name }, () => void chrome.runtime.lastError);
      } catch (e) {
        /* 拡張が更新された直後など */
      }
    });
  }

  window.addEventListener(
    'keyup',
    (e) => {
      if (matcher.match(e) === 'BACK') hold.release('BACK');
    },
    true,
  );
})();
