/*
 * 空間ナビゲーション: 十字キーで「その方向にある次の要素」へフォーカスを移す。
 *
 * - 前半: 純粋な幾何ロジック（pickNext / pickInitial）。DOM に依存せずテストできる。
 * - 後半: DOM 連携（createNavigator）。候補の収集、実フォーカス、スクロール、領域間移動、フォーカス記憶。
 *
 * 方針（SPEC 9.4）:
 *   score = 進行方向の距離 + 係数 × 直交方向のずれ
 *   同じ行/列に重なる候補を優先（2 パス）。該当なしなら移動しない（ラップしない）。
 *   縦移動では直前の横位置（sticky x）を使う。
 *   scrollIntoView は使わず、最寄りのスクロール領域と画面だけを自前でスクロールする。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ----------------------------------------------------------------- 幾何ロジック

  const DEFAULT_OPTS = Object.freeze({
    overlapTol: 0.35, // 進行方向に重なっていてもよい割合（小さい方のサイズに対して）
    minOverlapPx: 6, // 「同じ行/列に重なる」と見なす最小の重なり
    kOverlap: 2, // 重なる候補: 直交ずれの係数
    kNoOverlap: 6, // 重ならない候補: 直交ずれの係数（ペナルティ）
  });

  /** DOMRect 風オブジェクトを {left, top, right, bottom, width, height} に正規化する。 */
  function rectOf(r) {
    const left = r.left != null ? r.left : r.x;
    const top = r.top != null ? r.top : r.y;
    const width = r.width != null ? r.width : r.right - left;
    const height = r.height != null ? r.height : r.bottom - top;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function axes(dir, r) {
    if (dir === 'left' || dir === 'right') {
      return { s: r.left, e: r.right, ms: r.top, me: r.bottom, size: r.width, msize: r.height };
    }
    return { s: r.top, e: r.bottom, ms: r.left, me: r.right, size: r.height, msize: r.width };
  }

  /**
   * from から見て cand が dir 方向の候補になれるか評価する。なれなければ null。
   * @returns {{gap:number, offset:number, overlapping:boolean}|null}
   */
  function evaluate(dir, from, cand, opts) {
    const o = opts || DEFAULT_OPTS;
    const a = axes(dir, from);
    const b = axes(dir, cand);
    const positive = dir === 'right' || dir === 'down';
    const gap = positive ? b.s - a.e : a.s - b.e; // 向かい合う辺の距離（負なら重なり）
    const ahead = positive ? (b.s + b.e) / 2 - (a.s + a.e) / 2 : (a.s + a.e) / 2 - (b.s + b.e) / 2;
    if (ahead <= 1) return null; // 中心が進行方向側にない
    const tol = (o.overlapTol == null ? DEFAULT_OPTS.overlapTol : o.overlapTol) * Math.min(a.size, b.size);
    if (gap < -tol) return null; // 進行方向に大きく重なる要素（入れ子など）は対象外

    const ov = Math.max(0, Math.min(a.me, b.me) - Math.max(a.ms, b.ms));
    const minOv = Math.min(a.msize, b.msize);
    const minOverlapPx = o.minOverlapPx == null ? DEFAULT_OPTS.minOverlapPx : o.minOverlapPx;
    const overlapping = ov >= Math.min(minOverlapPx, minOv * 0.25) && ov > 0;

    const horizontal = dir === 'left' || dir === 'right';
    const sticky = horizontal ? o.stickyY : o.stickyX;
    const ref = sticky != null ? sticky : (a.ms + a.me) / 2;
    const offset = Math.abs((b.ms + b.me) / 2 - ref);
    return { gap: Math.max(0, gap), offset, overlapping };
  }

  function better(a, b) {
    if (a.score < b.score - 0.5) return true;
    if (a.score > b.score + 0.5) return false;
    if (a.gap !== b.gap) return a.gap < b.gap;
    return a.i < b.i;
  }

  /**
   * from の dir 方向で最も良い候補を返す（なければ null）。
   * @param {'left'|'right'|'up'|'down'} dir
   * @param {object} from 現在要素の矩形
   * @param {Array<{rect:object}>} candidates 候補（現在要素は含めない）
   * @param {object} [options] overlapTol/minOverlapPx/kOverlap/kNoOverlap/stickyX/stickyY。
   *   alignedOnly: true なら、同じ行/列に重なる候補（パス 1）だけを返す（斜めの候補は返さない）
   */
  function pickNext(dir, from, candidates, options) {
    const o = Object.assign({}, DEFAULT_OPTS, options || {});
    const f = rectOf(from);
    let bestOverlap = null;
    let bestOther = null;
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const e = evaluate(dir, f, rectOf(c.rect), o);
      if (!e) continue;
      const k = e.overlapping ? o.kOverlap : o.kNoOverlap;
      const entry = { c, gap: e.gap, i, score: e.gap + k * e.offset };
      if (e.overlapping) {
        if (!bestOverlap || better(entry, bestOverlap)) bestOverlap = entry;
      } else if (!bestOther || better(entry, bestOther)) {
        bestOther = entry;
      }
    }
    const best = bestOverlap || (o.alignedOnly ? null : bestOther);
    return best ? best.c : null;
  }

  /**
   * 初期フォーカス: 画面内で最も左上にある候補（ビルボードの複製など DOM 順に依存しない）。
   * 画面内に候補がなければ、全候補で最も上・左にあるもの。
   */
  function pickInitial(candidates, viewport) {
    if (!candidates.length) return null;
    const vp = viewport || { left: 0, top: 0, right: Infinity, bottom: Infinity };
    const visible = candidates.filter((c) => {
      const r = rectOf(c.rect);
      return r.bottom > vp.top && r.top < vp.bottom && r.right > vp.left && r.left < vp.right;
    });
    const pool = visible.length ? visible : candidates;
    let best = null;
    for (let i = 0; i < pool.length; i++) {
      const r = rectOf(pool[i].rect);
      const band = Math.round(r.top / 16); // 16px 帯で「同じ行」と見なす
      const key = [band, r.left, i];
      if (!best || key[0] < best.key[0] || (key[0] === best.key[0] && key[1] < best.key[1])) best = { c: pool[i], key };
    }
    return best.c;
  }

  // ----------------------------------------------------------------- DOM 連携

  const DEFAULT_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([type="hidden"]):not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function defaultExclude(el) {
    if (el.disabled) return true;
    if (el.getAttribute('aria-disabled') === 'true') return true;
    const keys = SV.keys;
    if (keys && keys.isEditable(el)) return true; // 文字入力欄は対象外（OSK は次フェーズ）
    return false;
  }

  /**
   * @param {object} options
   * @param {Document} [options.document]
   * @param {Window} [options.window]
   * @param {string} [options.selector]            候補のセレクタ
   * @param {(el:Element)=>boolean} [options.exclude]  true なら候補から外す
   * @param {(el:Element)=>string} [options.regionOf]  要素の領域名（既定 'content'）
   * @param {object} [options.crossRegion]         端での領域間移動 { content:{left:'rail'}, rail:{right:'content'} }
   * @param {string} [options.modalRegion]         この領域に候補があるときは他領域を無効化（フォーカストラップ）
   * @param {object} [options.prefer]              領域ごとの優先候補 { rail:(cands)=>cand|null }
   * @param {(el:Element)=>void} [options.onFocus]
   * @param {number} [options.minSize]             可視と見なす最小サイズ(px)
   * @param {boolean} [options.smooth]             スムーススクロール（既定 true）
   * @param {(el:Element, ctx:{behavior:string, repeat:boolean})=>boolean} [options.scroll]  true を返すと、既定のスクロールは行わない（サイト固有のスクロール位置の規則用）
   * @param {(next:Element, dir:string, from:Element)=>Element} [options.retarget]  移動先を差し替える（別の行へ入るとき、その行で覚えている要素にするなど）
   */
  function createNavigator(options) {
    const o = options || {};
    const doc = o.document || root.document;
    const win = o.window || root.window;
    const selector = o.selector || DEFAULT_SELECTOR;
    const exclude = o.exclude || defaultExclude;
    const regionOf = o.regionOf || (() => 'content');
    const crossRegion = o.crossRegion || {};
    const modalRegion = o.modalRegion || 'modal';
    const minSize = o.minSize == null ? 8 : o.minSize;

    const state = {
      stickyX: null, // 縦移動で保つ横位置（画面座標）
      stickyY: null, // 横移動で保つ縦位置（画面座標）
      stickyXFrom: null, // 次の縦移動の開始時に、この要素の「いまの位置」から stickyX を取り直す
      stickyYFrom: null,
      regionMemory: {}, // 領域ごとに最後にフォーカスした要素
      memory: new Map(), // ルートごとのフォーカス記憶
    };
    const PERSIST_KEY = 'sv.focus.v1';

    function isVisible(el) {
      if (!el.isConnected) return false;
      if (typeof el.checkVisibility === 'function') {
        try {
          if (!el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
        } catch (e) {
          /* 古いオプション名で例外になる環境は無視 */
        }
      }
      const r = el.getBoundingClientRect();
      if (r.width < minSize || r.height < minSize) return false;
      if (el.closest('[inert],[aria-hidden="true"]')) return false;
      return true;
    }

    /** 候補を集める。all=true なら縦方向の範囲制限をしない（フォーカス復元用）。 */
    function collect(opt) {
      const all = !!(opt && opt.all);
      const vh = win.innerHeight || 720;
      const list = [];
      for (const el of doc.querySelectorAll(selector)) {
        if (exclude(el)) continue;
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (!all && (r.bottom < -vh * 2 || r.top > vh * 3)) continue;
        list.push({ el, rect: rectOf(r), region: regionOf(el) });
      }
      const modal = list.filter((c) => c.region === modalRegion);
      return modal.length ? modal : list;
    }

    function current() {
      const a = doc.activeElement;
      if (!a || a === doc.body || a === doc.documentElement) return null;
      if (!a.matches || !a.matches(selector) || exclude(a) || !isVisible(a)) return null;
      return a;
    }

    // ---- スクロール（自前制御）

    function scrollWithin(node, el, canX, canY, behavior) {
      const r = el.getBoundingClientRect();
      const c = node.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (canX) {
        const m = clamp(c.width * 0.12, 24, 160);
        if (r.width > c.width - 2 * m) dx = r.left - (c.left + m);
        else if (r.left < c.left + m) dx = r.left - (c.left + m);
        else if (r.right > c.right - m) dx = r.right - (c.right - m);
      }
      if (canY) {
        const m = clamp(c.height * 0.1, 16, 120);
        if (r.height > c.height - 2 * m) dy = r.top - (c.top + m);
        else if (r.top < c.top + m) dy = r.top - (c.top + m);
        else if (r.bottom > c.bottom - m) dy = r.bottom - (c.bottom - m);
      }
      // 横スクロールは即時（行ごとにずれた状態でアニメーションすると、次の上下移動の列がずれるため）
      if (dx) node.scrollBy({ left: dx, behavior: 'auto' });
      if (dy) node.scrollBy({ top: dy, behavior });
    }

    function scrollViewport(el, behavior) {
      const vh = win.innerHeight;
      const r = el.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const comfortable = r.top >= vh * 0.06 && r.bottom <= vh * 0.94 && center >= vh * 0.2 && center <= vh * 0.8;
      if (comfortable) return;
      const dy = r.height > vh * 0.88 ? r.top - vh * 0.06 : center - vh / 2;
      if (dy) win.scrollBy({ top: dy, behavior });
    }

    /** el が見えるように、スクロール領域と画面をスクロールする。固定/sticky 内の要素では画面を動かさない。 */
    function ensureVisible(el, opt) {
      const behavior = (opt && opt.repeat) || o.smooth === false ? 'auto' : 'smooth';
      if (o.scroll && o.scroll(el, { behavior, repeat: !!(opt && opt.repeat) })) return;
      let node = el.parentElement;
      let pinned = false;
      while (node && node !== doc.body && node !== doc.documentElement) {
        const cs = win.getComputedStyle(node);
        if (cs.position === 'fixed' || cs.position === 'sticky') pinned = true;
        const canX = /(auto|scroll)/.test(cs.overflowX) && node.scrollWidth > node.clientWidth + 1;
        const canY = /(auto|scroll)/.test(cs.overflowY) && node.scrollHeight > node.clientHeight + 1;
        if (canX || canY) scrollWithin(node, el, canX, canY, behavior);
        node = node.parentElement;
      }
      if (!pinned) scrollViewport(el, behavior);
    }

    // ---- フォーカス

    /** 次の移動の開始時に、el の最新の位置から基準座標を取り直す印を付ける。 */
    function setSticky(el, which) {
      if (which === 'both' || which === 'x') {
        state.stickyX = null;
        state.stickyXFrom = el;
      }
      if (which === 'both' || which === 'y') {
        state.stickyY = null;
        state.stickyYFrom = el;
      }
    }

    function refreshSticky(vertical) {
      if (vertical && state.stickyXFrom) {
        if (state.stickyXFrom.isConnected) {
          const r = state.stickyXFrom.getBoundingClientRect();
          state.stickyX = r.left + r.width / 2;
        }
        state.stickyXFrom = null;
      }
      if (!vertical && state.stickyYFrom) {
        if (state.stickyYFrom.isConnected) {
          const r = state.stickyYFrom.getBoundingClientRect();
          state.stickyY = r.top + r.height / 2;
        }
        state.stickyYFrom = null;
      }
    }

    function focusElement(el, opt) {
      try {
        el.focus({ preventScroll: true, focusVisible: true });
      } catch (e) {
        el.focus();
      }
      ensureVisible(el, opt);
      state.regionMemory[regionOf(el)] = el;
      if (o.onFocus) o.onFocus(el);
      return true;
    }

    function preferredIn(region, list) {
      const pool = list.filter((c) => c.region === region);
      if (!pool.length) return null;
      if (o.prefer && typeof o.prefer[region] === 'function') {
        const hit = o.prefer[region](pool);
        if (hit) return hit;
      }
      const mem = state.regionMemory[region];
      if (mem && mem.isConnected) {
        const hit = pool.find((c) => c.el === mem);
        if (hit) return hit;
      }
      return null;
    }

    function crossTo(region, from, list) {
      const pool = list.filter((c) => c.region === region);
      if (!pool.length) return null;
      const pref = preferredIn(region, list);
      if (pref) return pref;
      // y 座標が最も近いもの（なければ左上）
      refreshSticky(false);
      const cy = state.stickyY != null ? state.stickyY : from.rect.top + from.rect.height / 2;
      let best = null;
      let bd = Infinity;
      for (const c of pool) {
        const d = Math.abs(c.rect.top + c.rect.height / 2 - cy);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      return best;
    }

    /**
     * 初期フォーカス。opt.requireRegion を指定すると、その領域に候補が現れるまで false を返す
     * （コンテンツの描画が遅れているときに、先にレールへフォーカスしてしまうのを避ける）。
     * opt.within（セレクタ）を指定すると、その要素の内側（main など）に候補が現れるまで false を返す
     * （描画前は、main の外にある補助的なリンクだけが候補になり、それを選んで画面を動かしてしまうのを避ける）。
     */
    function focusInitial(preferSelectors, opt) {
      const all = collect();
      const required = opt && opt.requireRegion;
      let list = required ? all.filter((c) => c.region === required) : all;
      if (opt && opt.within) list = list.filter((c) => c.el.closest(opt.within));
      if (!list.length) return false;
      const viewport = { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight };
      let target = null;
      for (const sel of preferSelectors || []) {
        const hits = list.filter((c) => c.el.matches(sel));
        if (hits.length) {
          target = pickInitial(hits, viewport) || hits[0];
          break;
        }
      }
      if (!target) {
        const region = required || o.initialRegion || 'content';
        const pool = list.filter((c) => c.region === region);
        target = pickInitial(pool.length ? pool : list, viewport);
      }
      if (!target) return false;
      focusElement(target.el, opt);
      setSticky(target.el, 'both');
      return true;
    }

    /**
     * dir 方向へフォーカスを移す。移動できたら true。
     * 何もフォーカスされていなければ、移動せず初期フォーカスだけを行う。
     */
    function move(dir, opt) {
      const list = collect();
      if (!list.length) return false;
      const cur = current();
      if (!cur) return focusInitial(opt && opt.prefer, opt);

      const r = cur.getBoundingClientRect();
      const inList = list.find((c) => c.el === cur);
      // ダイアログ（modal）が開いていて、現在の要素がその外にあるときは、ダイアログの中へフォーカスを移す
      if (!inList && list[0].region === modalRegion) {
        const entry = pickInitial(list, { left: 0, top: 0, right: win.innerWidth, bottom: win.innerHeight }) || list[0];
        focusElement(entry.el, opt);
        setSticky(entry.el, 'both');
        return true;
      }
      const from = inList || { el: cur, rect: rectOf(r), region: regionOf(cur) };
      if (opt && opt.crossOnly) {
        // 同じ領域の中は探さず、隣の領域（レール）へだけ出る（ビルボードの先頭で ← など）
        const to = crossRegion[from.region] && crossRegion[from.region][dir];
        const target = to ? crossTo(to, from, list) : null;
        if (!target) return false;
        focusElement(target.el, opt);
        setSticky(target.el, 'both');
        return true;
      }
      const vertical = dir === 'up' || dir === 'down';
      refreshSticky(vertical);
      const same = list.filter((c) => c.region === from.region && c.el !== cur);
      const sticky = {
        stickyX: vertical ? state.stickyX : null,
        stickyY: vertical ? null : state.stickyY,
      };
      // 順序: ① 同じ行/列に並ぶ候補 → ② 隣の領域（端でレールへ）→ ③ 斜めの候補。
      // ③ を②より先にすると、横にスクロールして見えなくなった別の行の要素へ飛び、レールへ出られなくなる。
      let swapped = false;
      const retargeted = (t) => {
        if (!o.retarget || !t) return t;
        const el = o.retarget(t.el, dir, cur);
        if (!el || el === t.el) return t;
        const c = list.find((x) => x.el === el);
        if (!c) return t;
        swapped = true;
        return c;
      };
      let target = retargeted(pickNext(dir, from.rect, same, Object.assign({ alignedOnly: true }, sticky)));
      if (!target) {
        const to = crossRegion[from.region] && crossRegion[from.region][dir];
        if (to) target = crossTo(to, from, list);
        if (target) {
          focusElement(target.el, opt);
          setSticky(target.el, 'both');
          return true;
        }
        target = retargeted(pickNext(dir, from.rect, same, sticky));
        if (!target) return false;
      }
      focusElement(target.el, opt);
      setSticky(target.el, swapped ? 'both' : vertical ? 'y' : 'x');
      return true;
    }

    // ---- フォーカス記憶（戻る・再訪時に復元）

    function loadPersisted() {
      try {
        return JSON.parse(win.sessionStorage.getItem(PERSIST_KEY) || '{}') || {};
      } catch (e) {
        return {};
      }
    }

    function savePersisted(all) {
      try {
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[k];
        win.sessionStorage.setItem(PERSIST_KEY, JSON.stringify(all));
      } catch (e) {
        /* 容量超過・無効化は無視 */
      }
    }

    function labelOf(el) {
      return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    }

    function remember(key) {
      const el = current();
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const rec = { href: el.getAttribute('href') || '', label: labelOf(el), cy: r.top + r.height / 2 + (win.scrollY || 0) };
      state.memory.set(key, rec);
      if (state.memory.size > 50) state.memory.delete(state.memory.keys().next().value);
      const all = loadPersisted();
      delete all[key]; // 末尾（最新）に入れ直す
      all[key] = rec;
      savePersisted(all);
      return true;
    }

    function hasMemory(key) {
      return state.memory.has(key) || !!loadPersisted()[key];
    }

    function restore(key, opt) {
      const m = state.memory.get(key) || loadPersisted()[key];
      if (!m || !(m.href || m.label)) return false;
      const list = collect({ all: true });
      const hits = list.filter((c) => (c.el.getAttribute('href') || '') === m.href && labelOf(c.el) === m.label);
      if (!hits.length) return false;
      let best = hits[0];
      let bd = Infinity;
      for (const c of hits) {
        const d = Math.abs(c.rect.top + c.rect.height / 2 + (win.scrollY || 0) - m.cy);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      focusElement(best.el, opt);
      setSticky(best.el, 'both');
      return true;
    }

    return { state, selector, collect, current, isVisible, move, focusInitial, focusElement, ensureVisible, remember, restore, hasMemory };
  }

  const api = { DEFAULT_OPTS, DEFAULT_SELECTOR, defaultExclude, rectOf, evaluate, pickNext, pickInitial, createNavigator };
  SV.nav = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
