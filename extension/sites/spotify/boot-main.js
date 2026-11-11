/*
 * Spotify のページ側（MAIN world、document_start）。Spotify のアプリを、「画面は自前、通信・再生・状態はアプリ自身」の形で動かすための入口。
 *
 * Spotify のアプリ（rspack で束ねた JS）は、起動のとき、まず通信・再生・状態のサービスを作り、そのあと React の根を 1 つ作って、画面全体を 1 回だけ描く。
 *   createRoot(#main).render(<プラットフォームの Provider><App/></…>)
 * ここでは、react-dom の入口（createRoot）を、アプリのモジュールが読み込まれる時点で包み、次の 2 つをする。
 *   1) 画面を描く先を、文書の外の空の要素に替える（Spotify の画面は、文書に出ない。レイアウトも描画もしない。アプリの動作はそのまま）
 *   2) render の引数の中から、プラットフォーム（getRegistry を持つ値）を取り出す。そこから、名前つきのサービス（PlayerAPI・PlaybackAPI など）を引ける
 * 呼ぶのはアプリ自身のサービスだけ。通信はアプリ自身が行い、認証情報には触らない。
 * チャンクの入口は、rspack のグローバル配列 rspackChunk（webpack なら webpackChunk…）。その push を、アプリの runtime が差し替えるのに合わせて、前に包みを入れる。
 */
(function () {
  'use strict';
  const B = (window.__svBoot = { platform: null, container: null, patched: false, renders: 0, error: null });

  /** 名前つきのサービス（登録簿のキーは、説明つきの Symbol）。なければ null。 */
  B.service = function (name) {
    try {
      const reg = B.platform && B.platform.getRegistry();
      if (!reg || !reg._map) return null;
      for (const k of reg._map.keys()) if (typeof k === 'symbol' && k.description === name) return reg.resolve(k);
    } catch (e) {
      B.error = String(e && e.message).slice(0, 100);
    }
    return null;
  };

  /** render に渡された要素の props をたどって、プラットフォームを探す。 */
  function capturePlatform(el) {
    const seen = new Set();
    const walk = (n, d) => {
      if (!n || typeof n !== 'object' || d > 14 || seen.has(n) || B.platform) return;
      seen.add(n);
      if (typeof n.getRegistry === 'function') {
        B.platform = n;
        return;
      }
      const p = n.props;
      if (p && typeof p === 'object') for (const k of Object.keys(p)) walk(p[k], d + 1);
      if (Array.isArray(n)) for (const x of n) walk(x, d + 1);
    };
    walk(el, 0);
  }

  /** react-dom の client のモジュールか（中身の文字で見分ける。モジュールの id は版ごとに変わる）。 */
  const isReactDomClient = (src) => src.length > 50000 && /createRoot/.test(src) && /hydrateRoot/.test(src) && /createPortal/.test(src);

  function wrapExports(ex) {
    const orig = ex && ex.createRoot;
    if (typeof orig !== 'function') return;
    ex.createRoot = function (container, options) {
      // アプリの根（最初の createRoot と、同じ要素への作り直し）は、文書の外へ描かせる
      const app = !B.container || container === B.container;
      if (!B.container) B.container = container;
      const root = orig.call(this, app ? document.createElement('div') : container, options);
      if (app) {
        const render = root.render;
        root.render = function (el) {
          B.renders++;
          capturePlatform(el);
          document.documentElement.setAttribute('data-sv-detached', '1'); // 隔離された世界（content.js）に、描画先を替えたことを知らせる（グローバル変数は見えない）
          return render.apply(this, arguments);
        };
      }
      return root;
    };
    B.patched = true;
  }

  function patchEntry(entry) {
    try {
      const mods = entry && entry[1];
      if (!mods || B.patched) return;
      for (const id of Object.keys(mods)) {
        const f = mods[id];
        if (typeof f !== 'function') continue;
        if (!isReactDomClient(Function.prototype.toString.call(f))) continue;
        mods[id] = function (module, exports) {
          f.apply(this, arguments);
          wrapExports(module && module.exports && module.exports.createRoot ? module.exports : exports);
        };
        return;
      }
    } catch (e) {
      B.error = String(e && e.message).slice(0, 100);
    }
  }

  const hookPush = (a) => {
    // 最初の push（runtime が差し替える前。先に読み込まれたチャンクが、ここを通る）にも、包みを入れる
    let p = function (entry) {
      patchEntry(entry);
      return Array.prototype.push.apply(this, arguments);
    };
    Object.defineProperty(a, 'push', {
      configurable: true,
      get() {
        return p;
      },
      set(fn) {
        p = function (entry) {
          patchEntry(entry);
          return fn.apply(this, arguments);
        };
      },
    });
  };

  let chunks;
  const key = 'rspackChunk';
  if (!(key in window)) {
    Object.defineProperty(window, key, {
      configurable: true,
      get() {
        return chunks;
      },
      set(v) {
        chunks = v;
        if (v && typeof v === 'object') hookPush(v);
      },
    });
  }
})();
