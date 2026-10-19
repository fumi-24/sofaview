/*
 * TVer の詳細ポップアップ（エピソード一覧のカードの詳細表示）は、TVer 自身の端末判定が「その他」のときだけ出る。
 * 判定は navigator.userAgent の文字列だけ。Windows・macOS の Chrome や Edge は「その他」だが、
 * **Linux の Chrome/Chromium（キオスクやミニ PC）は「Android PC」と判定され、ポップアップが出ない**（docs/NOTES.md）。
 * そこで、Linux の Chromium のときだけ、ページ側の JS から見える UA を Windows の Chrome にする（MAIN world・document_start）。
 * リクエストヘッダは変えない（サーバーは見ていない）。Windows・macOS では何もしない。
 */
(() => {
  'use strict';
  if (Navigator.prototype.__svTverUa) return; // 二重適用の防止
  const ua = navigator.userAgent;
  if (!/Linux/i.test(ua) || !/Chrome/i.test(ua) || /Android|CrOS/i.test(ua)) return;
  const UA = ua.replace(/\(X11;[^)]*\)/, '(Windows NT 10.0; Win64; x64)').replace('HeadlessChrome', 'Chrome');
  const def = (k, v) => Object.defineProperty(Navigator.prototype, k, { get: () => v, configurable: true });
  def('userAgent', UA);
  def('appVersion', UA.replace(/^Mozilla\//, ''));
  def('userAgentData', undefined);
  Object.defineProperty(Navigator.prototype, '__svTverUa', { value: true });
})();
