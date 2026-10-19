/*
 * キー割り当て: リモコンのボタンを「押して」登録する（文字入力は不要）。
 * 既定のキーは消さず、追加だけできる（誤設定でリモコンが効かなくなるのを避ける）。
 */
(function () {
  'use strict';

  const SV = self.SV;
  const listEl = document.getElementById('rows');
  const capEl = document.getElementById('capture');
  const capText = document.getElementById('capture-text');
  let settings = SV.settings.defaults();
  let capturing = null;
  let capTimer = null;
  let confirmClear = false;
  let confirmTimer = null;

  const ACTIONS = [
    ['OK', '決定'], ['BACK', '戻る'], ['HOME', 'ホーム'],
    ['UP', '上'], ['DOWN', '下'], ['LEFT', '左'], ['RIGHT', '右'],
    ['PLAY_PAUSE', '再生／一時停止'], ['SEEK_FWD', '早送り'], ['SEEK_BACK', '巻き戻し'],
    ['NEXT', '次'], ['PREV', '前'], ['STOP', '停止'], ['MENU', 'メニュー'],
  ];

  function keysOf(action) {
    const defaults = SV.keys.DEFAULT_BINDINGS[action] || [];
    const extra = (settings.bindings[action] || []).filter((k) => !defaults.includes(k));
    return { defaults, extra };
  }

  function render(focusId) {
    listEl.innerHTML = '';
    for (const [id, label] of ACTIONS) {
      const { defaults, extra } = keysOf(id);
      const b = document.createElement('button');
      b.className = 'row';
      b.type = 'button';
      b.setAttribute('role', 'listitem');
      b.dataset.id = id;
      const left = document.createElement('span');
      left.textContent = label;
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = defaults.join('  ');
      left.appendChild(sub);
      const v = document.createElement('span');
      v.className = 'value';
      v.textContent = extra.length ? '＋ ' + extra.join('  ') : '';
      b.append(left, v);
      listEl.appendChild(b);
    }
    const clear = document.createElement('button');
    clear.className = 'row';
    clear.type = 'button';
    clear.dataset.id = 'clear';
    clear.innerHTML = '<span>追加した割り当てをすべて消す</span><span class="value"></span>';
    clear.lastChild.textContent = confirmClear ? 'もう一度 Enter で消去' : '';
    listEl.appendChild(clear);
    if (focusId) {
      const el = listEl.querySelector('[data-id="' + focusId + '"]');
      if (el && window.SVHub) window.SVHub.nav.focusElement(el, { repeat: true });
    }
  }

  function startCapture(action) {
    capturing = action;
    const name = (ACTIONS.find(([id]) => id === action) || [])[1] || action;
    capText.innerHTML = '';
    const p = document.createElement('div');
    p.textContent = '「' + name + '」に割り当てるリモコンのボタンを押してください';
    const s = document.createElement('small');
    s.textContent = 'Esc で取り消し（8 秒で自動的に取り消します）';
    capText.append(p, s);
    capEl.setAttribute('data-on', 'true');
    clearTimeout(capTimer);
    capTimer = setTimeout(endCapture, 8000);
  }

  function endCapture() {
    capturing = null;
    clearTimeout(capTimer);
    capEl.setAttribute('data-on', 'false');
  }

  async function addKey(action, e) {
    const key = e.key && e.key !== 'Unidentified' ? e.key : e.code;
    if (!key) return;
    const cur = settings.bindings[action] || [];
    settings = await SV.settings.save({ bindings: { [action]: Array.from(new Set([...cur, key])) } });
    render(action);
  }

  window.SVHubHooks = {
    initial: ['.row'],
    back: 'settings.html',
    capture(e) {
      if (!capturing) return false;
      if (e.ctrlKey || e.altKey || e.metaKey) return false;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return true;
      const action = capturing;
      endCapture();
      if (e.key !== 'Escape') addKey(action, e);
      return true;
    },
    onAction(action) {
      const el = document.activeElement;
      const id = el && el.dataset ? el.dataset.id : '';
      if (action !== 'OK' || !id) return false;
      if (id === 'clear') {
        if (!confirmClear) {
          confirmClear = true;
          clearTimeout(confirmTimer);
          confirmTimer = setTimeout(() => {
            confirmClear = false;
            render('clear');
          }, 3000);
          render('clear');
        } else {
          confirmClear = false;
          SV.settings.save({ bindings: {} }, { replace: ['bindings'] }).then((s) => {
            settings = s;
            render('clear');
          });
        }
        return true;
      }
      startCapture(id);
      return true;
    },
  };

  SV.settings.load().then((s) => {
    settings = s;
    render();
    if (window.SVHub && !window.SVHub.nav.current()) window.SVHub.nav.focusInitial(['.row']);
  });
  render();
})();
