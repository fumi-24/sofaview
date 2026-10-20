/*
 * 画面上のキーボード（OSK）。リモコンには文字入力がないので、TVer の検索とアンケートの入力に使う（docs/SPEC.md 7.6）。
 * YouTube /tv は公式の OSK を持っているので、これは TVer 用。
 *
 * 前半は DOM に触れない純粋な部分（配列・カーソル移動・濁点などの変換・1 キーの効果。UMD なので Node の単体テストから読める）。
 * 後半が画面の部品（SV.osk.create）。キーは実 DOM のボタンで、フォーカスは element.focus()、見た目は osk.css の :focus。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  // ------------------------------------------------------------ 配列

  // ひらがな: 列 = あ行〜わ行（上から あいうえお）。'　' は空き。最後の行は記号と、直前の 1 文字を変えるキー（゛ ゜ 小）
  const KANA_GRID = [
    'あかさたなはまやらわ',
    'いきしちにひみゆりを',
    'うくすつぬふむよるん',
    'えけせてねへめ　れ　',
    'おこそとのほも　ろ　',
    '゛゜小、。ー・？！～',
  ];
  const ABC_GRID = ['abcdefghij', 'klmnopqrst', 'uvwxyz-_.@', '1234567890'];
  const NUM_GRID = ['123', '456', '789'];

  /** 切り替えの順。表示の名前は「次に切り替わる先」。 */
  const MODE_LABEL = Object.freeze({ hira: 'あいう', kata: 'カナ', abc: 'ABC', num: '123' });

  const text = (t) => ({ t, span: 1 });
  const fn = (id, label, span = 1) => ({ fn: id, label, span });
  const blank = () => ({ blank: true, span: 1 });

  /** ひらがな → カタカナ（ぁ〜ゖ → ァ〜ヶ。ほかの文字はそのまま）。 */
  function toKata(s) {
    return String(s).replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
  }
  function toHira(s) {
    return String(s).replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  /**
   * 配列を作る。
   * @param {'hira'|'kata'|'abc'|'num'} mode
   * @param {{upper?:boolean, modes?:string[], doneLabel?:string, searchIcon?:boolean}} [o]  modes: 切り替えできる種類（1 つだけなら切り替えキーを出さない）。
   *   searchIcon: 入力欄の右端の検索アイコン（先頭に 1 行・head）を足す
   * @returns {{id:string, cols:number, rows:Array<Array<object>>}} 各キーに c0（開始の列）が付く
   */
  function buildLayout(mode, o = {}) {
    const modes = o.modes && o.modes.length ? o.modes : ['hira', 'kata', 'abc'];
    const done = (span) => fn('done', o.doneLabel || '完了', span);
    const del = (span) => fn('del', '削除', span);
    let rows;
    let cols = 10;
    if (mode === 'num') {
      cols = 3;
      rows = NUM_GRID.map((r) => Array.from(r).map(text));
      rows.push([text('0'), del(), done()]);
    } else if (mode === 'abc') {
      rows = ABC_GRID.map((r) => Array.from(r).map((ch) => text(o.upper ? ch.toUpperCase() : ch)));
      const bottom = [];
      if (modes.length > 1) bottom.push(fn('mode', MODE_LABEL[nextMode(mode, modes)], 2));
      bottom.push(fn('case', o.upper ? 'abc' : 'ABC', 2), fn('space', '空白', modes.length > 1 ? 2 : 4), del(2), done(2));
      rows.push(bottom);
    } else {
      const conv = mode === 'kata' ? toKata : (s) => s;
      rows = KANA_GRID.map((r, ri) =>
        Array.from(r).map((ch) => {
          if (ch === '　') return blank();
          if (ri === 5 && ch === '゛') return fn('daku', '゛');
          if (ri === 5 && ch === '゜') return fn('han', '゜');
          if (ri === 5 && ch === '小') return fn('small', '小');
          return text(conv(ch));
        }),
      );
      const bottom = [];
      if (modes.length > 1) bottom.push(fn('mode', MODE_LABEL[nextMode(mode, modes)], 2));
      bottom.push(fn('space', '空白', modes.length > 1 ? 4 : 6), del(2), done(2));
      rows.push(bottom);
    }
    if (o.searchIcon) rows.unshift([{ fn: 'done', icon: true, head: true, label: o.doneLabel || '検索', span: cols }]);
    for (const r of rows) {
      let c = 0;
      for (const k of r) {
        k.c0 = c;
        c += k.span;
      }
    }
    return { id: mode, cols, rows };
  }

  function nextMode(mode, modes) {
    const i = modes.indexOf(mode);
    return modes[(i + 1) % modes.length];
  }

  // ------------------------------------------------------------ カーソル移動

  /** 空きでないキーのうち、列 c に一番近いもの（同じ距離なら左）。なければ -1。 */
  function nearestIndex(row, c) {
    let best = -1;
    let bestD = Infinity;
    row.forEach((k, i) => {
      if (k.blank) return;
      const lo = k.c0;
      const hi = k.c0 + k.span - 1;
      const d = c < lo ? lo - c : c > hi ? c - hi : 0;
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    return best;
  }

  /**
   * 十字キーでの移動。端では止まる（回り込まない）。空きは飛ばす。上下は、いまのキーの中心に一番近い列のキーへ。
   * @param {{rows:Array<Array<object>>}} layout
   * @param {{r:number,i:number}} pos
   * @param {'up'|'down'|'left'|'right'} dir
   */
  function move(layout, pos, dir) {
    const rows = layout.rows;
    const cur = rows[pos.r] && rows[pos.r][pos.i];
    if (!cur) return firstPos(layout);
    if (dir === 'left' || dir === 'right') {
      const step = dir === 'left' ? -1 : 1;
      for (let j = pos.i + step; j >= 0 && j < rows[pos.r].length; j += step) {
        if (!rows[pos.r][j].blank) return { r: pos.r, i: j };
      }
      return pos;
    }
    const step = dir === 'up' ? -1 : 1;
    const center = cur.c0 + (cur.span - 1) / 2;
    for (let r = pos.r + step; r >= 0 && r < rows.length; r += step) {
      const i = nearestIndex(rows[r], center);
      if (i >= 0) return { r, i };
    }
    return pos;
  }

  /** 最初にフォーカスするキー（入力欄の検索アイコンは除く）。 */
  function firstPos(layout) {
    for (let r = 0; r < layout.rows.length; r++) {
      if (layout.rows[r].some((k) => k.head)) continue;
      const i = nearestIndex(layout.rows[r], 0);
      if (i >= 0) return { r, i };
    }
    return { r: 0, i: 0 };
  }

  /** 種類（fn の id）のキーの位置。なければ null。 */
  function findFn(layout, id) {
    for (let r = 0; r < layout.rows.length; r++) {
      const i = layout.rows[r].findIndex((k) => k.fn === id);
      if (i >= 0) return { r, i };
    }
    return null;
  }

  // ------------------------------------------------------------ 文字の変換（濁点・半濁点・小書き）

  const DAKU = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ', う: 'ゔ' };
  const HAN = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };
  const SMALL = { あ: 'ぁ', い: 'ぃ', う: 'ぅ', え: 'ぇ', お: 'ぉ', つ: 'っ', や: 'ゃ', ゆ: 'ゅ', よ: 'ょ', わ: 'ゎ' };
  const rev = (m) => Object.fromEntries(Object.entries(m).map(([a, b]) => [b, a]));
  const UNDAKU = rev(DAKU);
  const UNHAN = rev(HAN);
  const UNSMALL = rev(SMALL);

  /**
   * 直前の 1 文字を変える。変えられなければ null。゛: 清音 → 濁音 → 清音（ぱ → ば）。゜: は行 → 半濁音 → は行（ば → ぱ）。小: 小書き ↔ 大きい字。
   * カタカナもそのまま扱う。
   * @param {string} ch
   * @param {'daku'|'han'|'small'} kind
   */
  function markChar(ch, kind) {
    const h = toHira(ch);
    const wasKata = h !== ch;
    let out = null;
    if (kind === 'daku') {
      if (UNHAN[h]) out = DAKU[UNHAN[h]];
      else if (UNDAKU[h]) out = UNDAKU[h];
      else if (DAKU[h]) out = DAKU[h];
    } else if (kind === 'han') {
      if (UNHAN[h]) out = UNHAN[h];
      else if (UNDAKU[h] && HAN[UNDAKU[h]]) out = HAN[UNDAKU[h]];
      else if (HAN[h]) out = HAN[h];
    } else if (kind === 'small') {
      if (UNSMALL[h]) out = UNSMALL[h];
      else if (SMALL[h]) out = SMALL[h];
    }
    if (!out) return null;
    return wasKata ? toKata(out) : out;
  }

  // ------------------------------------------------------------ 1 キーの効果

  const chars = (s) => Array.from(String(s));

  /**
   * キーを押した結果。state は { text, mode, upper }。ここでは増やさない・減らすだけでなく、上限（maxLength）も守る。
   * @param {{text:string, mode:string, upper:boolean}} state
   * @param {object} key  buildLayout のキー
   * @param {{modes?:string[], maxLength?:number}} [o]
   * @returns {{text:string, mode:string, upper:boolean, done?:boolean}}
   */
  function press(state, key, o = {}) {
    const s = { text: state.text, mode: state.mode, upper: state.upper };
    if (key.blank) return s;
    if (key.t != null) return Object.assign(s, { text: append(s.text, key.t, o.maxLength) });
    switch (key.fn) {
      case 'space':
        s.text = append(s.text, ' ', o.maxLength);
        break;
      case 'del':
        s.text = chars(s.text).slice(0, -1).join('');
        break;
      case 'daku':
      case 'han':
      case 'small': {
        const cs = chars(s.text);
        const last = cs[cs.length - 1];
        const m = last ? markChar(last, key.fn) : null;
        if (m) {
          cs[cs.length - 1] = m;
          s.text = cs.join('');
        }
        break;
      }
      case 'mode':
        s.mode = nextMode(s.mode, o.modes && o.modes.length ? o.modes : ['hira', 'kata', 'abc']);
        break;
      case 'case':
        s.upper = !s.upper;
        break;
      case 'done':
        s.done = true;
        break;
      default:
    }
    return s;
  }

  function append(t, add, maxLength) {
    if (maxLength > 0 && chars(t).length + chars(add).length > maxLength) return t;
    return t + add;
  }

  /** 物理キーボード（開発・動作確認用）の 1 文字。数字だけの入力では数字以外を捨てる。入れられない文字は null。 */
  function typed(state, ch, o = {}) {
    if (!ch || chars(ch).length !== 1) return null;
    if (state.mode === 'num' && !/^[0-9]$/.test(ch)) return null;
    if (/[\u0000-\u001f\u007f]/.test(ch)) return null;
    const text = append(state.text, ch, o.maxLength);
    return text === state.text ? null : text;
  }

  // ------------------------------------------------------------ 入力欄の判定

  const TEXT_TYPES = ['', 'text', 'search', 'tel', 'number', 'email', 'url', 'password'];

  /**
   * 入力欄に OSK を使えるか、使うなら最初にどの配列か。数字だけの欄（number・tel・inputmode=numeric・pattern=[0-9]*）は数字キーだけ。
   * @param {Element} el
   * @returns {{mode:string, modes:string[], maxLength:number, title:string, placeholder:string}|null}
   */
  function inputSpec(el) {
    if (!el || !el.tagName) return null;
    const tag = String(el.tagName).toUpperCase();
    if (el.disabled || el.readOnly) return null;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') return null;
    const type = tag === 'TEXTAREA' ? 'text' : String(el.getAttribute('type') || 'text').toLowerCase();
    if (!TEXT_TYPES.includes(type)) return null;
    const im = String(el.getAttribute('inputmode') || '').toLowerCase();
    const ph = String(el.getAttribute('placeholder') || '');
    // 数字だけの欄: type・inputmode・pattern、または、例が数字だけ（TVer のアンケートの「2000」「4」「1050004」）
    const numeric = type === 'number' || type === 'tel' || im === 'numeric' || im === 'decimal' || im === 'tel' || /^\[0-9\]\*?$|^\\d\*?$/.test(String(el.getAttribute('pattern') || '')) || /^[0-9]+$/.test(ph);
    const label = el.getAttribute('aria-label') || (el.labels && el.labels[0] && el.labels[0].textContent) || (/^[0-9]+$/.test(ph) ? '' : ph);
    return {
      mode: numeric ? 'num' : 'hira',
      modes: numeric ? ['num'] : ['hira', 'kata', 'abc'],
      maxLength: el.maxLength > 0 ? el.maxLength : 0,
      title: String(label).replace(/\s+/g, ' ').trim().slice(0, 40) || '文字入力',
      placeholder: '',
    };
  }

  // ------------------------------------------------------------ 画面の部品

  /**
   * @param {{document?:Document}} [options]
   */
  function create(options) {
    const doc = (options && options.document) || root.document;
    let st = null;

    const el = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };

    /**
     * 開く。
     * @param {{title?:string, value?:string, placeholder?:string, mode?:string, modes?:string[], maxLength?:number, doneLabel?:string,
     *   onChange?:(text:string)=>void, onDone?:(text:string)=>void, onCancel?:()=>void}} o
     */
    function open(o) {
      if (st) close(false);
      const modes = o.modes && o.modes.length ? o.modes : ['hira', 'kata', 'abc'];
      const mode = o.mode && modes.concat(['num']).includes(o.mode) ? o.mode : modes[0];
      st = {
        o,
        modes,
        maxLength: o.maxLength > 0 ? o.maxLength : 0,
        state: { text: String(o.value || ''), mode, upper: false },
        layout: null,
        pos: { r: 0, i: 0 },
        keys: [],
        prev: doc.activeElement,
        root: null,
      };
      const rootEl = el('div');
      rootEl.id = 'sv-osk';
      rootEl.setAttribute('role', 'group');
      rootEl.setAttribute('aria-label', '文字入力');
      const panel = el('div', 'sv-osk-panel');
      const head = el('div', 'sv-osk-head');
      head.appendChild(el('div', 'sv-osk-title', o.title || '文字入力'));
      const field = el('div', 'sv-osk-field');
      const inner = el('div', 'sv-osk-input'); // 左詰め。長いときは末尾が見えるようにスクロールする
      st.innerEl = inner;
      st.fieldEl = field;
      st.textEl = el('span', 'sv-osk-text');
      st.phEl = el('span', 'sv-osk-ph', o.placeholder || '');
      inner.append(st.textEl, el('span', 'sv-osk-caret'), st.phEl);
      field.appendChild(inner);
      head.appendChild(field);
      st.grid = el('div', 'sv-osk-grid');
      panel.append(head, st.grid);
      rootEl.appendChild(panel);
      st.root = rootEl;
      // host: モーダルのダイアログ（Radix）の中。ダイアログはフォーカスを中に閉じ込め、外のキーへ移したフォーカスを入力欄に戻してしまう
      const host = o.host && o.host.isConnected ? o.host : doc.body || doc.documentElement;
      host.appendChild(rootEl);
      doc.documentElement.classList.add('sv-osk-open');
      build(firstPosOf(st.state.mode));
      paintText();
    }

    const layoutFor = (mode, upper) => buildLayout(mode, { upper, modes: st.modes, doneLabel: st.o.doneLabel, searchIcon: !!st.o.searchIcon });
    const layoutOf = (state) => layoutFor(state.mode, state.upper);
    const firstPosOf = (mode) => firstPos(layoutFor(mode, false));

    function build(pos) {
      st.layout = layoutOf(st.state);
      st.grid.textContent = '';
      if (st.headEl) st.headEl.remove();
      st.headEl = null;
      st.grid.style.setProperty('--sv-osk-cols', String(st.layout.cols));
      st.root.setAttribute('data-mode', st.layout.id);
      st.keys = st.layout.rows.map((row, r) =>
        row.map((k, i) => {
          if (k.head) {
            const b = el('button', 'sv-osk-key sv-osk-icon');
            b.type = 'button';
            b.setAttribute('data-fn', k.fn);
            b.setAttribute('aria-label', k.label);
            b.setAttribute('data-pos', `${r}:${i}`);
            b.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><circle cx="10" cy="10" r="6.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M15 15l6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
            b.addEventListener('click', (e) => {
              e.preventDefault();
              st.pos = { r, i };
              pressKey(st.layout.rows[r][i]);
            });
            st.fieldEl.appendChild(b);
            st.headEl = b;
            return b;
          }
          if (k.blank) {
            const sp = el('span', 'sv-osk-gap');
            sp.style.gridColumn = `span ${k.span}`;
            st.grid.appendChild(sp);
            return sp;
          }
          const b = el('button', 'sv-osk-key', k.t != null ? k.t : k.label);
          b.type = 'button';
          b.style.gridColumn = `span ${k.span}`;
          if (k.fn) b.setAttribute('data-fn', k.fn);
          b.setAttribute('data-pos', `${r}:${i}`);
          b.addEventListener('click', (e) => {
            e.preventDefault();
            st.pos = { r, i };
            pressKey(st.layout.rows[r][i]);
          });
          st.grid.appendChild(b);
          return b;
        }),
      );
      focusPos(pos);
    }

    function focusPos(pos) {
      const row = st.layout.rows[pos.r];
      if (!row || !row[pos.i] || row[pos.i].blank) pos = firstPos(st.layout);
      st.pos = pos;
      const b = st.keys[pos.r][pos.i];
      if (b && b.focus) b.focus({ preventScroll: true });
    }

    function paintText() {
      st.textEl.textContent = st.state.text;
      st.phEl.hidden = st.state.text.length > 0;
      st.innerEl.scrollLeft = st.innerEl.scrollWidth;
    }

    function setState(next) {
      const modeChanged = next.mode !== st.state.mode || next.upper !== st.state.upper;
      const textChanged = next.text !== st.state.text;
      st.state = { text: next.text, mode: next.mode, upper: next.upper };
      if (textChanged) {
        paintText();
        if (st.o.onChange) st.o.onChange(st.state.text);
        // 欄が満ちるとサイトが次の欄へフォーカスを移すことがある。キーボードのフォーカスを取り戻す
        if (st && !st.root.contains(doc.activeElement)) focusPos(st.pos);
      }
      if (modeChanged) {
        // 切り替えキー（種類・大文字小文字）は、切り替え後も同じキーにフォーカスを残す
        const cur = st.layout.rows[st.pos.r][st.pos.i];
        build(findFn(layoutFor(next.mode, next.upper), cur.fn) || firstPosOf(next.mode));
      }
    }

    function pressKey(key) {
      const r = press(st.state, key, { modes: st.modes, maxLength: st.maxLength });
      setState(r);
      if (r.done) finish(true);
    }

    /** 閉じる。done: 完了（onDone）/ そうでなければ取り消し（onCancel）。 */
    function finish(done) {
      const s = st;
      if (!s) return;
      close(true);
      if (done) {
        if (s.o.onDone) s.o.onDone(s.state.text);
      } else if (s.o.onCancel) s.o.onCancel();
    }

    function close(restoreFocus) {
      const s = st;
      if (!s) return;
      st = null;
      if (s.root.parentElement) s.root.remove();
      doc.documentElement.classList.remove('sv-osk-open');
      const p = s.prev;
      if (restoreFocus !== false && p && p.isConnected && p.focus) p.focus({ preventScroll: true });
    }

    /**
     * キー 1 回。開いている間は、すべて OSK が受ける（戻り値は常に true）。
     * @param {KeyboardEvent} e
     * @param {string|null} action  SV.keys のアクション名
     */
    function handleKey(e, action) {
      if (!st) return false;
      SV.consume(e);
      const key = e.key;
      if (action === 'UP' || action === 'DOWN' || action === 'LEFT' || action === 'RIGHT') {
        st.moved = true;
        focusPos(move(st.layout, st.pos, action.toLowerCase()));
        return true;
      }
      if (action === 'OK') {
        // 物理キーボードで打ったあと、キーを動かさずに Enter ＝ 完了（開発・動作確認用。リモコンでは起きない）
        if (key === 'Enter' && st.phys && !st.moved) {
          finish(true);
          return true;
        }
        pressKey(st.layout.rows[st.pos.r][st.pos.i]);
        return true;
      }
      if (key === 'Backspace') {
        // 物理キーボードの Backspace は 1 文字消す。空なら閉じる（戻るキーとして Backspace を送るリモコンでも、続けて押せば閉じられる）
        if (st.state.text) setState(press(st.state, { fn: 'del' }));
        else finish(false);
        return true;
      }
      if (action === 'BACK') {
        finish(false);
        return true;
      }
      if (!e.repeat || key.length === 1) {
        const t = key.length === 1 || chars(key).length === 1 ? typed(st.state, key, { maxLength: st.maxLength }) : null;
        if (t != null) {
          st.phys = true;
          setState({ text: t, mode: st.state.mode, upper: st.state.upper });
        }
      }
      return true;
    }

    return {
      open,
      close: () => close(true),
      isOpen: () => !!st,
      handleKey,
      state: () => (st ? { ...st.state, pos: { ...st.pos } } : null),
    };
  }

  const api = { KANA_GRID, MODE_LABEL, toKata, toHira, buildLayout, move, firstPos, findFn, nearestIndex, markChar, press, typed, inputSpec, create };
  SV.osk = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
