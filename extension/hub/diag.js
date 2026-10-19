/*
 * キー診断: ブラウザに届いたキーイベントをそのまま表示する。
 * リモコンの実際のキー名（key / code / keyCode）を確認し、設定のキー割り当てに使う。
 */
(function () {
  'use strict';

  const SV = self.SV;
  const $ = (id) => document.getElementById(id);
  const history = [];
  let last = 0;
  let exitCount = 0;
  let exitAt = 0;

  function actionOf(e) {
    const m = (window.SVHub && window.SVHub.matcher) || SV.keys.createMatcher();
    return m.match(e);
  }

  function renderEnv() {
    const env = $('env');
    const rows = [
      ['SofaView', 'v' + SV.VERSION + (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id ? '（' + chrome.runtime.id + '）' : '')],
      ['UA', navigator.userAgent],
      ['画面', screen.width + '×' + screen.height + '（available ' + screen.availWidth + '×' + screen.availHeight + '）'],
      ['ウィンドウ', window.innerWidth + '×' + window.innerHeight + '（CSS px）'],
      ['DPR', String(window.devicePixelRatio)],
    ];
    env.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      env.append(dt, dd);
    }
  }
  renderEnv();
  window.addEventListener('resize', renderEnv);

  window.SVHubHooks = {
    initial: [],
    capture(e) {
      const now = performance.now();
      const d = SV.keys.describe(e);
      const action = actionOf(e);
      const delta = last ? Math.round(now - last) + ' ms' : '–';
      last = now;

      $('key-main').textContent = d.key === ' ' ? '（Space）' : d.key || '（なし）';
      $('key-main').setAttribute('data-key', d.key);
      $('d-key').textContent = JSON.stringify(d.key);
      $('d-code').textContent = JSON.stringify(d.code);
      $('d-keycode').textContent = String(d.keyCode);
      $('d-location').textContent = String(d.location);
      $('d-repeat').textContent = String(d.repeat);
      $('d-delta').textContent = delta;
      const a = $('d-action');
      a.textContent = action || '未割り当て';
      a.className = action ? '' : 'badge-un';

      history.unshift(`${d.key === ' ' ? 'Space' : d.key} / ${d.code} / ${d.keyCode}${d.repeat ? ' (repeat)' : ''} → ${action || '未割り当て'}`);
      history.length = Math.min(history.length, 8);
      $('hist').innerHTML = '';
      for (const line of history) {
        const li = document.createElement('li');
        li.textContent = line;
        $('hist').appendChild(li);
      }

      // 戻る/ホームを 3 回続けて押したらハブへ
      if (!d.repeat && (action === 'BACK' || action === 'HOME')) {
        exitCount = now - exitAt < 2500 ? exitCount + 1 : 1;
        exitAt = now;
        if (exitCount >= 3) location.href = 'index.html';
      } else if (!d.repeat) {
        exitCount = 0;
      }

      // ブラウザ操作（Ctrl+… など）は邪魔しない。それ以外は既定動作（スクロール・戻る等）を止める。
      if (!(e.ctrlKey || e.altKey || e.metaKey)) e.preventDefault();
      e.stopPropagation();
      return true;
    },
  };
})();
