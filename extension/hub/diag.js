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

  // スマホのリモコンの状態: 設定・裏の /tv のタブ・最後に YouTube /tv が受け取ったキーと、渡した先の数
  async function renderRemote() {
    const r = await SV.sendMessage({ type: 'sv:remoteStatus' });
    const box = $('remote-status');
    if (!box) return;
    const rows = [];
    if (!r || !r.ok) {
      rows.push(['状態', '取得できません（拡張機能を再読み込みしてください）']);
    } else {
      rows.push(['裏で /tv を開く設定', r.setting ? 'オン' : 'オフ（オフのときは、/tv を自分で別のタブに開いておく）']);
      const yt = r.yt.length ? r.yt.map((t) => (t.active ? '前面' : '裏') + (t.discarded ? '・破棄された' : '') + '・' + t.status).join(' / ') : 'なし';
      rows.push(['YouTube /tv のタブ', yt + (r.yt.length > 1 ? '（2 つ以上あると、あとから開いたほうだけが受け取る）' : '')]);
      rows.push(['/tv が受け取った命令', r.lounge && r.lounge.length ? r.lounge.map((l) => l.n + '（' + Math.max(0, Math.round((r.now - l.at) / 1000)) + ' 秒前）').join(' / ') : 'まだありません（スマホをつなぐと、つないだ・押した命令の名前が出ます）']);
      if (r.last) {
        const ago = Math.max(0, Math.round((r.now - r.last.at) / 1000));
        rows.push(['最後に受け取ったキー', r.last.name + '（' + ago + ' 秒前）']);
        rows.push(['渡したタブの数', String(r.last.sent) + (r.last.fromActive ? '（/tv が前面だったので、/tv 自身が処理）' : '')]);
      } else {
        rows.push(['最後に受け取ったキー', 'まだありません（スマホのリモコンで十字キーを押してください）']);
      }
    }
    box.innerHTML = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      box.append(dt, dd);
    }
  }
  renderRemote();
  setInterval(renderRemote, 1000);

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
