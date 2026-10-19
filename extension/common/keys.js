/*
 * リモコンのキー処理。物理キー（KeyboardEvent）→ 論理アクションへの変換と、
 * リピート制御・長押し検出を行う。DOM に依存しない純粋なロジック（テスト対象）。
 *
 * 実機のキーは診断ページ（hub/diag.html）で確認し、必要なら設定で追加する。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  const ACTIONS = Object.freeze([
    'UP', 'DOWN', 'LEFT', 'RIGHT',
    'OK', 'BACK', 'HOME', 'MENU',
    'PLAY_PAUSE', 'PLAY', 'PAUSE', 'STOP',
    'SEEK_BACK', 'SEEK_FWD', 'PREV', 'NEXT',
    'PAGE_UP', 'PAGE_DOWN',
    'RED', 'GREEN', 'YELLOW', 'BLUE',
  ]);

  const DIRECTIONS = Object.freeze({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' });

  /** 既定のキー割り当て（KeyboardEvent.key または .code と比較する）。 */
  const DEFAULT_BINDINGS = Object.freeze({
    UP: ['ArrowUp'],
    DOWN: ['ArrowDown'],
    LEFT: ['ArrowLeft'],
    RIGHT: ['ArrowRight'],
    OK: ['Enter', 'NumpadEnter'],
    BACK: ['Escape', 'Backspace', 'BrowserBack', 'GoBack'],
    HOME: ['Home', 'BrowserHome'],
    MENU: ['ContextMenu', 'Info'],
    PLAY_PAUSE: ['MediaPlayPause'],
    PLAY: ['MediaPlay'],
    PAUSE: ['MediaPause'],
    STOP: ['MediaStop'],
    SEEK_BACK: ['MediaRewind'],
    SEEK_FWD: ['MediaFastForward'],
    PREV: ['MediaTrackPrevious'],
    NEXT: ['MediaTrackNext'],
    PAGE_UP: ['PageUp'],
    PAGE_DOWN: ['PageDown'],
    RED: ['ColorF0Red'],
    GREEN: ['ColorF1Green'],
    YELLOW: ['ColorF2Yellow'],
    BLUE: ['ColorF3Blue'],
  });

  /** key が 'Unidentified' のときに使う keyCode の予備表（TV 系リモコン向け）。 */
  const KEYCODE_FALLBACK = Object.freeze({
    10009: 'BACK', // Tizen RETURN
    461: 'BACK', // webOS BACK
    166: 'BACK', // BrowserBack
    172: 'HOME', // BrowserHome
    415: 'PLAY',
    19: 'PAUSE',
    413: 'STOP',
    417: 'SEEK_FWD',
    412: 'SEEK_BACK',
    403: 'RED',
    404: 'GREEN',
    405: 'YELLOW',
    406: 'BLUE',
  });

  /** 押しっぱなしのリピートを許可するアクション。 */
  const REPEATABLE = Object.freeze(new Set(['UP', 'DOWN', 'LEFT', 'RIGHT', 'SEEK_BACK', 'SEEK_FWD', 'PAGE_UP', 'PAGE_DOWN']));

  function isDirection(action) {
    return Object.prototype.hasOwnProperty.call(DIRECTIONS, action);
  }

  function isRepeatable(action) {
    return REPEATABLE.has(action);
  }

  /**
   * 割り当て表からマッチャーを作る。overrides は既定に「追加」される（置き換えではない）。
   * 既定キーを無効にすることはしない（誤設定でリモコンが効かなくなるのを避ける）。
   */
  function createMatcher(overrides) {
    const table = new Map(); // key name -> action（ACTIONS の順で先勝ち）
    const merged = {};
    for (const a of ACTIONS) {
      const extra = overrides && Array.isArray(overrides[a]) ? overrides[a] : [];
      merged[a] = Array.from(new Set([...(DEFAULT_BINDINGS[a] || []), ...extra]));
    }
    for (const a of ACTIONS) {
      for (const k of merged[a]) if (!table.has(k)) table.set(k, a);
    }
    return {
      bindings: merged,
      /** KeyboardEvent 相当のオブジェクトから論理アクションを返す（無ければ null）。 */
      match(ev) {
        if (!ev) return null;
        if (ev.key && table.has(ev.key)) return table.get(ev.key);
        if (ev.code && table.has(ev.code)) return table.get(ev.code);
        const unidentified = !ev.key || ev.key === 'Unidentified';
        if (unidentified && ev.keyCode && KEYCODE_FALLBACK[ev.keyCode]) return KEYCODE_FALLBACK[ev.keyCode];
        return null;
      },
    };
  }

  /** 診断用に、イベントの主要フィールドだけを取り出す。 */
  function describe(ev) {
    return {
      key: ev.key,
      code: ev.code,
      keyCode: ev.keyCode,
      location: ev.location,
      repeat: !!ev.repeat,
      shift: !!ev.shiftKey,
      ctrl: !!ev.ctrlKey,
      alt: !!ev.altKey,
      meta: !!ev.metaKey,
    };
  }

  /** 入力欄・編集可能要素か。検索など文字入力中はキー処理を行わない。 */
  function isEditable(el) {
    if (!el || !el.tagName) return false;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      return !['button', 'checkbox', 'radio', 'submit', 'reset', 'image', 'file', 'range', 'color'].includes(type);
    }
    return !!el.isContentEditable;
  }

  /** リモコン以外のイベント（合成イベント・修飾キー併用）は無視する。 */
  function shouldIgnore(ev) {
    if (!ev) return true;
    if (ev.isTrusted === false) return true;
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return true;
    if (ev.isComposing) return true;
    return false;
  }

  /**
   * リピート制御。
   * - 最初の押下は常に通す
   * - OK/BACK/HOME などは長押しのリピートを通さない
   * - 方向キーなどは 1 秒あたり maxPerSec 回に制限する
   */
  class RepeatGate {
    constructor(opts) {
      const o = opts || {};
      this.minInterval = 1000 / (o.maxPerSec || 12);
      this.now = o.now || (() => Date.now());
      this.staleMs = o.staleMs == null ? 150 : o.staleMs; // 処理待ちで溜まったリピートを捨てる境界（イベントの発生から処理までの遅れ）
      this.perfNow = o.perfNow || (() => (typeof performance !== 'undefined' ? performance.now() : 0));
      this.last = new Map();
    }

    allow(action, ev) {
      if (ev && ev.repeat && !isRepeatable(action)) return false;
      const t = this.now();
      if (ev && ev.repeat) {
        const last = this.last.get(action) || 0;
        if (t - last < this.minInterval) return false;
        // メインスレッドが詰まって溜まったリピートは、離したあとも走り続けるので捨てる（イベントの時刻は処理時刻ではなく発生時刻）
        if (this.staleMs > 0 && ev.timeStamp > 0 && this.perfNow() - ev.timeStamp > this.staleMs) return false;
      }
      this.last.set(action, t);
      return true;
    }
  }

  /**
   * 長押し検出。指定アクションのキーが holdMs 以上押され続けたら一度だけ true を返す。
   * keydown ごとに feed() を呼び、keyup で release() を呼ぶ。
   */
  class HoldDetector {
    constructor(opts) {
      const o = opts || {};
      this.holdMs = o.holdMs || 800;
      this.now = o.now || (() => Date.now());
      this.start = new Map();
      this.fired = new Set();
    }

    feed(action, ev) {
      const t = this.now();
      if (!ev || !ev.repeat || !this.start.has(action)) {
        this.start.set(action, t);
        this.fired.delete(action);
        return false;
      }
      if (!this.fired.has(action) && t - this.start.get(action) >= this.holdMs) {
        this.fired.add(action);
        return true;
      }
      return false;
    }

    release(action) {
      this.start.delete(action);
      this.fired.delete(action);
    }
  }

  const api = {
    ACTIONS,
    DIRECTIONS,
    DEFAULT_BINDINGS,
    KEYCODE_FALLBACK,
    REPEATABLE,
    isDirection,
    isRepeatable,
    createMatcher,
    describe,
    isEditable,
    shouldIgnore,
    RepeatGate,
    HoldDetector,
  };

  SV.keys = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
