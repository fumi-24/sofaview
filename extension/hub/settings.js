/*
 * 設定ページ: リモコンだけで操作できるよう、項目は「Enter / ← →」で値を切り替える方式にする。
 */
(function () {
  'use strict';

  const SV = self.SV;
  const listEl = document.getElementById('rows');
  let settings = SV.settings.defaults();
  let confirmReset = false;
  let confirmTimer = null;

  const onOff = [[true, 'オン'], [false, 'オフ']];

  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const patchFor = (p, v) => p.split('.').reduceRight((acc, k) => ({ [k]: acc }), v);

  const ROWS = [
    { id: 'zoom.mode', label: '画面倍率（TVer）', sub: 'CSS の画面高さを揃えて 10 フィート表示にします', options: [['auto', '自動（720p 相当）'], ['off', '変更しない'], ['fixed', '固定倍率']] },
    { id: 'zoom.factor', label: '固定倍率', options: [1.25, 1.5, 1.75, 2, 2.5, 3].map((v) => [v, v.toFixed(2).replace(/0$/, '') + '×']), visible: (s) => s.zoom.mode === 'fixed' },
    { id: 'tver.nativeFullscreen', label: '再生中はブラウザごと全画面にする（TVer）', sub: 'オフでも、画面いっぱいの表示（劇場表示）になります', options: onOff },
    { id: 'tver.hideHeader', label: 'TVer のヘッダー（検索・設定）を隠す', options: onOff },
    { id: 'tver.hideAppCta', label: '「アプリで視聴する」を隠す', options: onOff },
    { id: 'youtube.redirect', label: 'YouTube の通常 URL を /tv へ転送', sub: 'watch?v=… と youtu.be のリンクも /tv で開きます', options: onOff },
    { id: 'youtube.receiver', label: 'キャスト待機：YouTube を裏で開いておく', sub: 'スマホから YouTube を送る（キャスト）と、自動で前面に出て再生します', options: onOff },
    { id: 'holdBackToHome', label: '戻るキーの長押しでホームへ', sub: 'リモコンに Home がない場合の保険', options: onOff },
    { id: 'link:keys', label: 'キー割り当て（追加）', value: '›', href: 'keys.html' },
    { id: 'link:diag', label: 'キー診断', value: '›', href: 'diag.html' },
    { id: 'reset', label: '設定を初期化', reset: true },
  ];

  function optionIndex(row) {
    const cur = getPath(settings, row.id);
    const i = row.options.findIndex(([v]) => v === cur);
    return i < 0 ? 0 : i;
  }

  function valueText(row) {
    if (row.reset) return confirmReset ? 'もう一度 Enter で初期化' : '';
    if (row.value) return row.value;
    return row.options[optionIndex(row)][1];
  }

  function render(focusId) {
    listEl.innerHTML = '';
    for (const row of ROWS) {
      if (row.visible && !row.visible(settings)) continue;
      const b = document.createElement('button');
      b.className = 'row';
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      b.dataset.id = row.id;
      const left = document.createElement('span');
      left.textContent = row.label;
      if (row.sub) {
        const s = document.createElement('span');
        s.className = 'sub';
        s.textContent = row.sub;
        left.appendChild(s);
      }
      const v = document.createElement('span');
      v.className = 'value';
      v.textContent = valueText(row);
      b.append(left, v);
      listEl.appendChild(b);
    }
    if (focusId) {
      const el = listEl.querySelector('[data-id="' + focusId + '"]');
      if (el && window.SVHub) window.SVHub.nav.focusElement(el, { repeat: true });
    }
  }

  async function activate(row, dir) {
    if (row.href) {
      location.href = row.href;
      return;
    }
    if (row.reset) {
      if (!confirmReset) {
        confirmReset = true;
        clearTimeout(confirmTimer);
        confirmTimer = setTimeout(() => {
          confirmReset = false;
          render(row.id);
        }, 3000);
        render(row.id);
        return;
      }
      confirmReset = false;
      settings = await SV.settings.reset();
      render(row.id);
      return;
    }
    const n = row.options.length;
    const next = row.options[(optionIndex(row) + dir + n) % n][0];
    settings = await SV.settings.save(patchFor(row.id, next));
    render(row.id);
  }

  window.SVHubHooks = {
    initial: ['.row'],
    onAction(action) {
      const el = document.activeElement;
      const row = el && el.dataset ? ROWS.find((r) => r.id === el.dataset.id) : null;
      if (!row) return false;
      if (action === 'OK') {
        activate(row, 1);
        return true;
      }
      if ((action === 'LEFT' || action === 'RIGHT') && row.options) {
        activate(row, action === 'LEFT' ? -1 : 1);
        return true;
      }
      return false;
    },
  };

  SV.settings.load().then((s) => {
    settings = s;
    render(document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null);
    if (window.SVHub && !window.SVHub.nav.current()) window.SVHub.nav.focusInitial(['.row']);
  });
  render();
})();
