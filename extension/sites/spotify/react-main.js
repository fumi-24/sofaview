/*
 * Spotify のページ側（MAIN world、document_start）。Spotify の画面は React 製で、React は、開発者ツール（React DevTools）のために、
 * ページに専用の入口（__REACT_DEVTOOLS_GLOBAL_HOOK__）が置かれていれば、起動時に自分を登録し、画面を更新するたびに根（FiberRoot）を知らせてくる
 * （本番のビルドでも同じ。Spotify の vendor の React 18.3.1 で確認）。この入口を、Spotify のコードより先に置いて、部品の木（fiber の木）を読む。
 * 読むだけで、Spotify のコードも通信も書き換えない。
 *
 * 歌詞: 歌詞の 1 行ごとの部品は、props（部品への入力）に text（文字）・start（開始時刻）・onObserve を持つ。props の名前は、圧縮されても変わらない。
 * 画面の要素の名前（data-testid）・クラス名・文字の色・要素が文書の中にあるか、には頼らない。
 * 拡張側（nowplaying.js）が { svReactAsk: 'lyrics' } を送ると、{ svReact: 'lyrics', lines: [{ text, start }] } を返す（歌詞の画面が作られていなければ、空）。
 */
(function () {
  'use strict';
  const roots = new Set();
  const track = (root) => {
    if (root && typeof root === 'object') roots.add(root);
  };

  const existing = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  if (existing) {
    // すでに DevTools などが入口を置いているときは、それに相乗りする（元の動作は壊さない）
    const orig = existing.onCommitFiberRoot;
    existing.onCommitFiberRoot = function (id, root) {
      track(root);
      return typeof orig === 'function' ? orig.apply(this, arguments) : undefined;
    };
  } else {
    let next = 0;
    const renderers = new Map();
    Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      configurable: true,
      value: {
        supportsFiber: true,
        isDisabled: false,
        renderers,
        inject(renderer) {
          renderers.set(++next, renderer);
          return next;
        },
        onCommitFiberRoot(id, root) {
          track(root);
        },
        onCommitFiberUnmount() {},
        onPostCommitFiberRoot() {},
        checkDCE() {},
        getFiberRoots(id) {
          return roots;
        },
      },
    });
  }

  /** 歌詞の行の部品か（props の名前だけで見分ける）。 */
  const isLine = (p) => !!p && typeof p === 'object' && typeof p.onObserve === 'function' && typeof p.text === 'string' && 'start' in p;

  /** 部品の木をたどって、歌詞の行を、画面の順に集める。行の部品の中（同じ props を渡す内側の部品）は、たどらない（二重に数えない）。 */
  function collectLyrics() {
    const lines = [];
    for (const root of roots) {
      let f = root && root.current;
      if (!f) continue;
      // 反復の深さ優先（長い木でもスタックを使い切らない）
      const stack = [f];
      while (stack.length) {
        const n = stack.pop();
        if (isLine(n.memoizedProps)) {
          lines.push({ text: n.memoizedProps.text, start: Number(n.memoizedProps.start) });
          if (n.sibling) stack.push(n.sibling);
          continue;
        }
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
      }
    }
    return lines;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.svReactAsk !== 'lyrics') return;
    let lines = [];
    try {
      lines = collectLyrics();
    } catch (err) {
      console.error('[SV] react lyrics', err);
    }
    window.postMessage({ svReact: 'lyrics', lines }, location.origin);
  });
})();
