/*
 * youtube.com/tv を TV 端末として認識させる（MAIN world・document_start）。
 * リクエストヘッダの User-Agent は rules/youtube-ua.json（DNR）が書き換える。
 * ここではページ側の JS が参照する navigator を同じ UA に揃える。
 * ヘッダと navigator の両方を揃えた構成で動作確認済み（docs/NOTES.md）。
 */
(() => {
  'use strict';
  if (Navigator.prototype.__svUa) return; // 二重適用の防止
  const UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36';
  const def = (k, v) => Object.defineProperty(Navigator.prototype, k, { get: () => v, configurable: true });
  def('userAgent', UA);
  def('appVersion', UA.replace(/^Mozilla\//, ''));
  def('userAgentData', undefined);
  Object.defineProperty(Navigator.prototype, '__svUa', { value: true });
})();
