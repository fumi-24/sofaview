/*
 * ツールバーのアイコンから開く設定の小窓。よく変える項目だけを、マウスで切り替える。
 * 設定は chrome.storage.local（sv.settings）に保存され、開いているページにはすぐ反映される（common/settings.js の onChange）。
 * リモコンで操作する設定ページ（hub/settings.html）とは、同じ設定を見ている。
 */
(function () {
  'use strict';

  const SV = self.SV;
  const rowsEl = document.getElementById('rows');
  let settings = SV.settings.defaults();
  let confirmReset = false;
  let confirmTimer = 0;

  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const patchFor = (p, v) => p.split('.').reduceRight((acc, k) => ({ [k]: acc }), v);

  // type: switch（オン/オフ）/ seg（3 択まで）/ select
  const ROWS = [
    { group: '共通' },
    { id: 'zoom.mode', type: 'seg', label: '画面倍率（TVer）', sub: '10 フィート表示に合わせて拡大します（ページを開き直すと反映）', options: [['auto', '自動'], ['off', 'なし'], ['fixed', '固定']] },
    { id: 'zoom.factor', type: 'select', label: '固定倍率', options: [1.25, 1.5, 1.75, 2, 2.5, 3].map((v) => [v, v.toFixed(2).replace(/0$/, '') + '×']), visible: (s) => s.zoom.mode === 'fixed' },
    { id: 'holdBackToHome', type: 'switch', label: '戻るキーの長押しでホームへ', sub: 'リモコンに Home がない場合の保険' },
    { group: 'TVer' },
    { id: 'tver.nativeFullscreen', type: 'switch', label: '再生中はブラウザごと全画面', sub: 'オフでも、画面いっぱいの表示になります' },
    { id: 'tver.hideHeader', type: 'switch', label: 'ヘッダー（検索・設定）を隠す' },
    { id: 'tver.hideAppCta', type: 'switch', label: '「アプリで視聴する」を隠す' },
    { group: 'YouTube' },
    { id: 'youtube.redirect', type: 'switch', label: '通常の URL を /tv へ転送', sub: 'watch?v=… と youtu.be のリンクも /tv で開きます' },
    { id: 'youtube.receiver', type: 'switch', label: 'キャスト待機：裏で開いておく', sub: 'スマホから送ると、自動で前面に出て再生します' },
  ];

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  async function change(row, value) {
    settings = await SV.settings.save(patchFor(row.id, value));
    render();
  }

  function control(row) {
    const cur = getPath(settings, row.id);
    if (row.type === 'switch') {
      const b = el('button', 'switch');
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.setAttribute('aria-checked', String(!!cur));
      b.setAttribute('aria-label', row.label);
      b.addEventListener('click', () => change(row, !cur));
      return b;
    }
    if (row.type === 'seg') {
      const g = el('div', 'seg');
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', row.label);
      for (const [v, t] of row.options) {
        const b = el('button', null, t);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(v === cur));
        b.addEventListener('click', () => change(row, v));
        g.appendChild(b);
      }
      return g;
    }
    const s = el('select');
    s.setAttribute('aria-label', row.label);
    for (const [v, t] of row.options) {
      const o = el('option', null, t);
      o.value = String(v);
      o.selected = v === cur;
      s.appendChild(o);
    }
    s.addEventListener('change', () => change(row, Number(s.value)));
    return s;
  }

  function render() {
    rowsEl.textContent = '';
    for (const row of ROWS) {
      if (row.group) {
        rowsEl.appendChild(el('div', 'group', row.group));
        continue;
      }
      if (row.visible && !row.visible(settings)) continue;
      const r = el('div', row.type === 'switch' ? 'row' : 'row stack');
      r.dataset.id = row.id;
      const label = el('div', 'label');
      label.appendChild(el('span', null, row.label));
      if (row.sub) label.appendChild(el('span', 'sub', row.sub));
      r.append(label, control(row));
      rowsEl.appendChild(r);
    }
    const reset = document.getElementById('reset');
    reset.textContent = confirmReset ? 'もう一度押すと初期化' : '設定を初期化';
  }

  function open(path) {
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
    window.close();
  }

  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  document.getElementById('open-all').addEventListener('click', () => open('hub/settings.html'));
  document.getElementById('open-hub').addEventListener('click', () => open('hub/index.html'));
  document.getElementById('open-keys').addEventListener('click', () => open('hub/keys.html'));
  document.getElementById('open-diag').addEventListener('click', () => open('hub/diag.html'));
  document.getElementById('reset').addEventListener('click', async () => {
    if (!confirmReset) {
      confirmReset = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        confirmReset = false;
        render();
      }, 3000);
      render();
      return;
    }
    confirmReset = false;
    clearTimeout(confirmTimer);
    settings = await SV.settings.reset();
    render();
  });

  // 他の場所（設定ページ）で変わったときも追従する
  SV.settings.onChange((s) => {
    settings = s;
    render();
  });
  SV.settings.load().then((s) => {
    settings = s;
    render();
  });
  render();
})();
