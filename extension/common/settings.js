/*
 * SofaView 設定。`chrome.storage.local` の `sv.settings` に保存する。
 * 保存値は常に既定値とマージし、範囲チェック（sanitize）を通してから使う。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});
  const KEY = 'sv.settings';

  const DEFAULTS = Object.freeze({
    // 画面倍率: auto=CSSビューポート高さを targetHeight に合わせる / off=触らない / fixed=factor 固定
    zoom: { mode: 'auto', targetHeight: 720, factor: 1.5 },
    holdBackToHome: false, // 戻るキー長押し = ホーム（リモコンに Home が無い場合の保険）
    holdMs: 800,
    bindings: {}, // 追加のキー割り当て { ACTION: ['KeyName', ...] }（既定に追加される）
    tver: {
      hideHeader: true, // ハンバーガー・検索・設定を隠す
      hideAppCta: true, // 「アプリで視聴する」等を隠す
      nativeFullscreen: true, // 再生が始まったら、ブラウザの全画面（アドレスバー等も消える）にもする。オフでも画面いっぱいの表示（劇場表示）になる
    },
    youtube: {
      redirect: false, // youtube.com の通常URLを /tv に転送する
    },
  });

  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function deepMerge(base, patch) {
    if (!isObj(patch)) return base;
    const out = { ...base };
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
    }
    return out;
  }

  const num = (v, lo, hi, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);

  function sanitize(s) {
    const d = DEFAULTS;
    const out = clone(d);
    if (!isObj(s)) return out;

    const z = isObj(s.zoom) ? s.zoom : {};
    out.zoom.mode = ['auto', 'off', 'fixed'].includes(z.mode) ? z.mode : d.zoom.mode;
    out.zoom.targetHeight = num(z.targetHeight, 360, 1440, d.zoom.targetHeight);
    out.zoom.factor = num(z.factor, 0.5, 4, d.zoom.factor);

    out.holdBackToHome = bool(s.holdBackToHome, d.holdBackToHome);
    out.holdMs = num(s.holdMs, 300, 3000, d.holdMs);

    out.bindings = {};
    if (isObj(s.bindings)) {
      for (const action of Object.keys(s.bindings)) {
        const list = s.bindings[action];
        if (!Array.isArray(list)) continue;
        const keys = list.filter((k) => typeof k === 'string' && k.length > 0 && k.length <= 40);
        if (keys.length) out.bindings[action] = Array.from(new Set(keys)).slice(0, 12);
      }
    }

    const t = isObj(s.tver) ? s.tver : {};
    out.tver.hideHeader = bool(t.hideHeader, d.tver.hideHeader);
    out.tver.hideAppCta = bool(t.hideAppCta, d.tver.hideAppCta);
    out.tver.nativeFullscreen = bool(t.nativeFullscreen, d.tver.nativeFullscreen);

    const y = isObj(s.youtube) ? s.youtube : {};
    out.youtube.redirect = bool(y.redirect, d.youtube.redirect);
    return out;
  }

  function defaults() {
    return clone(DEFAULTS);
  }

  // --- ストレージ（chrome.storage.local。テストではメモリ実装に差し替え可能）---
  let memory = {};
  let adapter = null;

  function storage() {
    if (adapter) return adapter;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return {
        get: (k) => new Promise((r) => chrome.storage.local.get(k, (v) => r(v ? v[k] : undefined))),
        set: (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, () => r())),
        remove: (k) => new Promise((r) => chrome.storage.local.remove(k, () => r())),
      };
    }
    return {
      get: async (k) => memory[k],
      set: async (k, v) => {
        memory[k] = clone(v);
      },
      remove: async (k) => {
        delete memory[k];
      },
    };
  }

  async function load() {
    let raw;
    try {
      raw = await storage().get(KEY);
    } catch (e) {
      raw = undefined;
    }
    return sanitize(deepMerge(defaults(), isObj(raw) ? raw : {}));
  }

  /**
   * patch を現在の設定にマージして保存する。
   * opts.replace に挙げたトップレベルのキーは、マージせず patch の値で置き換える（例: bindings を空にする）。
   */
  async function save(patch, opts) {
    const cur = await load();
    const merged = deepMerge(cur, patch);
    for (const k of (opts && opts.replace) || []) {
      if (patch && Object.prototype.hasOwnProperty.call(patch, k)) merged[k] = patch[k];
    }
    const next = sanitize(merged);
    await storage().set(KEY, next);
    return next;
  }

  async function reset() {
    await storage().remove(KEY);
    return defaults();
  }

  /** 設定が変わったら cb(settings) を呼ぶ。解除関数を返す。 */
  function onChange(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return () => {};
    const handler = (changes, area) => {
      if (area !== 'local' || !changes[KEY]) return;
      const nv = changes[KEY].newValue;
      cb(sanitize(deepMerge(defaults(), isObj(nv) ? nv : {})));
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  const api = {
    KEY,
    DEFAULTS,
    defaults,
    sanitize,
    deepMerge,
    load,
    save,
    reset,
    onChange,
    /** テスト用: ストレージ実装を差し替える / メモリを空にする */
    _setAdapter(a) {
      adapter = a;
    },
    _clearMemory() {
      memory = {};
    },
  };

  SV.settings = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
