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

  window.addEventListener(
    'keyup',
    (e) => {
      if (matcher.match(e) === 'BACK') hold.release('BACK');
    },
    true,
  );
})();
