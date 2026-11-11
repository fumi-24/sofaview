/*
 * Spotify のページ側（MAIN world、document_start）。Spotify の画面は React 製で、React は、開発者ツール（React DevTools）のために、
 * ページに専用の入口（__REACT_DEVTOOLS_GLOBAL_HOOK__）が置かれていれば、起動時に自分を登録し、画面を更新するたびに根（FiberRoot）を知らせてくる
 * （本番のビルドでも同じ。Spotify の vendor の React 18.3.1 で確認）。この入口を、Spotify のコードより先に置いて、部品の木（fiber の木）を読む。
 * 読むだけで、Spotify のコードも通信も書き換えない。
 *
 * 歌詞: 歌詞の 1 行ごとの部品は、props（部品への入力）に text（文字）・start（開始時刻）・onObserve を持つ。props の名前は、圧縮されても変わらない。
 * 画面の要素の名前（data-testid）・クラス名・文字の色・要素が文書の中にあるか、には頼らない。
 * 診断: { svReactAsk: 'diag' } を送ると、アプリの内部の「形」だけ（名前・種類・メソッド名。文字の値は集めない）の報告を返す（実機で一度取る調査用）。
 * 拡張側（engine.js）が { svReactAsk: 'lyrics' } を送ると、{ svReact: 'lyrics', lines: [{ text, start }] } を返す（歌詞の画面が作られていなければ、空）。
 */
(function () {
  'use strict';
  const roots = new Set();
  const svc = { player: null, engine: null, volume: null, findAt: 0 };
  let findTimer = 0;
  const track = (root) => {
    if (root && typeof root === 'object') roots.add(root);
    // 部品の木ができたら、アプリのサービスを探して、状態をすぐ送る（1 秒おきの確認を待たない）
    if (!findTimer && typeof pushState === 'function' && !(svc && svc.player)) {
      findTimer = setTimeout(() => {
        findTimer = 0;
        pushState(true);
      }, 500);
    }
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

  /** 歌詞のデータを持つ部品か（props の名前ではなく、形で見分ける: data.lyrics が { text, start } の配列）。 */
  const lyricsOf = (p) => {
    const d = p && typeof p === 'object' ? p.data : null;
    const a = d && typeof d === 'object' ? d.lyrics : null;
    return Array.isArray(a) && a.length && a.every((x) => x && typeof x === 'object' && typeof x.text === 'string' && 'start' in x) ? a : null;
  };

  /**
   * 部品の木をたどって、歌詞の行を、画面の順に集める。行の部品の中（同じ props を渡す内側の部品）は、たどらない（二重に数えない）。
   * 行の部品が見つからないとき（描かれていない・名前が変わった）の代わりに、歌詞の入れ物の props（data.lyrics）から読む。
   */
  function collectLyrics() {
    const lines = [];
    let viaData = null;
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
        if (!viaData) {
          const a = lyricsOf(n.memoizedProps);
          if (a) viaData = a.map((x) => ({ text: x.text, start: Number(x.start) }));
        }
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
      }
    }
    return lines.length ? lines : viaData || [];
  }

  /** 歌詞ボタンの props。木をたどるのは安くないので、4 秒は覚えておく（ボタンが変わると props が差し替わるので、押下の状態は古くなりうる。移動の前は強制的に探し直す）。 */
  let lyricsBtnCache = { at: -1e9, p: null };
  function lyricsButton(fresh) {
    const now = performance.now();
    if (fresh || now - lyricsBtnCache.at > 4000) lyricsBtnCache = { at: now, p: findProps((p) => p['data-testid'] === 'lyrics-button') };
    return lyricsBtnCache.p;
  }

  /** 歌詞が出ない理由を探すための、数だけの情報（文字の値は含めない）。 */
  function lyricsDebug() {
    const B = window.__svBoot;
    const host = B && B.host;
    const btn = lyricsButton(false);
    return {
      path: location.pathname.replace(/\/[A-Za-z0-9]{22}/g, '/…').slice(0, 40),
      btn: btn ? (typeof btn.onClick === 'function' ? 'onClick' : '') + (typeof btn.href === 'string' ? ' href=' + btn.href.replace(/\/[A-Za-z0-9]{22}/g, '/…').slice(0, 30) : '') : '',
      pressed: btn ? String(btn['aria-pressed'] ?? btn['data-active'] ?? '') : '',
      lineEls: host ? host.querySelectorAll('[data-testid="lyrics-line"]').length : -1,
      hostNodes: host ? host.getElementsByTagName('*').length : -1,
      main: host && host.querySelector('main') ? host.querySelector('main').getElementsByTagName('*').length : -1,
    };
  }

  /** 部品の木から、条件に合う props（ホスト要素の props）を 1 つ探す。 */
  function findProps(pred) {
    const budget = performance.now() + 250;
    for (const root of roots) {
      const stack = [root && root.current];
      while (stack.length && performance.now() < budget) {
        const n = stack.pop();
        if (!n) continue;
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
        if (typeof n.type === 'string') {
          const p = n.memoizedProps;
          try {
            if (p && typeof p === 'object' && pred(p)) return p;
          } catch (e) {
            /* 次へ */
          }
        }
      }
    }
    return null;
  }

  // ================= アプリ自身のサービス（再生の状態・操作・音量）=================
  // Spotify のアプリは、再生のサービス（playerAPI）と、音声の再生エンジン（standalonePlayer。音量を持つ）を、部品の props として持っている（実機の診断で確認）。
  // これを部品の木から見つけて、状態を読み（getState）、操作する（pause・resume・skipToNext・skipToPrevious・seekTo・setVolume）。
  // 呼ぶのは、アプリ自身のサービスだけ（画面のボタンを押すのと同じ。通信はアプリ自身が行い、認証情報には触らない）。

  /** 起動のときに取ったプラットフォーム（boot-main.js）の登録簿から、名前つきのサービスを引く。部品の木が（文書の外でも）できる前から使える。 */
  function fromRegistry() {
    const B = window.__svBoot;
    if (!B || !B.platform) return;
    if (!svc.player) {
      const p = B.service('PlayerAPI');
      if (p && typeof p.getState === 'function' && typeof p.seekTo === 'function') svc.player = p;
    }
    if (!svc.volume) {
      const v = B.service('PlaybackAPI');
      if (v && typeof v.setVolume === 'function' && typeof v.getVolume === 'function') svc.volume = v;
    }
  }

  /**
   * サービスを探す（見つかるまで、2 秒に 1 回まで）。まず登録簿（名前で引く）。なければ部品の木から、メソッドの名前で見分ける（props の名前には頼らない）。
   * 音声の再生エンジン（standalonePlayer）は、音を有効にする（activateElement）ために、部品の木から探す。
   */
  function findServices() {
    fromRegistry();
    const now = performance.now();
    if ((svc.player && svc.engine && svc.volume) || now - svc.findAt < 2000) return;
    svc.findAt = now;
    const budget = now + 1500;
    for (const root of roots) {
      const stack = [root && root.current];
      while (stack.length && performance.now() < budget) {
        const n = stack.pop();
        if (!n) continue;
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
        const p = n.memoizedProps;
        if (!p || typeof p !== 'object') continue;
        for (const k of Object.keys(p).slice(0, 30)) {
          const v = p[k];
          if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
          if (!svc.player && typeof v.getState === 'function' && typeof v.seekTo === 'function' && typeof v.skipToNext === 'function' && playerish(v) >= 8) svc.player = v;
          if (!svc.engine && typeof v.setVolume === 'function' && typeof v.getVolume === 'function' && typeof v.pause === 'function') svc.engine = v;
        }
        if (svc.player && svc.engine) return;
      }
    }
  }

  /** 状態を、画面に必要な分だけ取り出す（アプリの状態そのものは渡さない）。 */
  function compact(st) {
    const item = st && st.item;
    const imgs = (item && item.album && item.album.images) || [];
    let cover = '';
    let bestW = -1;
    for (const im of imgs) if (im && typeof im.url === 'string' && (im.width || 0) > bestW) {
      bestW = im.width || 0;
      cover = im.url;
    }
    return {
      has: !!item,
      paused: !!st.isPaused,
      buffering: !!st.isBuffering,
      positionMs: Number(st.positionAsOfTimestamp),
      timestamp: Number(st.timestamp),
      durationMs: Number(st.duration) || (item && item.duration && Number(item.duration.milliseconds)) || 0,
      speed: Number(st.speed) || 1,
      type: item ? String(item.type || '') : '',
      mediaType: item ? String(item.mediaType || '') : '',
      uri: item ? String(item.uri || '') : '',
      title: item ? String(item.name || '') : '',
      artists: item && Array.isArray(item.artists) ? item.artists.map((a) => String((a && a.name) || '')).filter(Boolean) : [],
      cover,
      canSeek: !!(st.restrictions && st.restrictions.canSeek),
    };
  }

  let lastPush = '';
  let lastBase = '';
  let lastFullAt = 0;
  let lastSentAt = 0;
  /** ログインしていないか（プラットフォームのセッション）。分からなければ null。 */
  function anonymous() {
    try {
      const B = window.__svBoot;
      const ses = B && B.platform && B.platform.getSession();
      return ses && typeof ses.isAnonymous === 'boolean' ? ses.isAnonymous : null;
    } catch (e) {
      return null;
    }
  }
  function pushState(force) {
    try {
      findServices();
      const anon = anonymous();
      if (!svc.player) {
        const sig = 'none|' + anon;
        if (lastPush !== sig) window.postMessage({ svApp: 'none', anonymous: anon }, location.origin);
        lastPush = sig;
        return;
      }
      subscribeUpdates();
      const state = compact(svc.player.getState() || {});
      // 変わっていなければ、ここで終わる（音量の問い合わせまで進むのは、変わったときと、1 秒に 1 回だけ）
      const base = JSON.stringify([state.has, state.paused, state.buffering, Math.round(state.positionMs / 500), state.durationMs, state.title, state.uri, anon]);
      const t = Date.now();
      if (!force && base === lastBase && t - lastFullAt < 1000) return;
      lastBase = base;
      lastFullAt = t;
      const send = (vol) => {
        const sig = base + JSON.stringify(vol);
        if (!force && sig === lastPush && Date.now() - lastSentAt < 2000) return; // 変わらなくても、2 秒おきには送る（受け取り側が、生きているかを見分けるため）
        lastPush = sig;
        lastSentAt = Date.now();
        window.postMessage({ svApp: 'state', state, vol, anonymous: anon, now: Date.now() }, location.origin);
      };
      const vs = svc.volume || svc.engine;
      if (vs) Promise.resolve(vs.getVolume()).then((v) => send(Number.isFinite(Number(v)) ? Number(v) : null), () => send(null));
      else send(null);
    } catch (err) {
      console.error('[SV] app state', err);
    }
  }
  // アプリの再生サービスの更新イベント（再生・一時停止・シーク・曲の変わり目）を購読して、すぐ送る。購読できなくても、下の短い間隔の確認が代わりをする
  let subscribed = false;
  function subscribeUpdates() {
    if (subscribed || !svc.player) return;
    subscribed = true;
    try {
      const ev = typeof svc.player.getEvents === 'function' ? svc.player.getEvents() : null;
      if (ev && typeof ev.addListener === 'function') ev.addListener('update', () => setTimeout(() => pushState(false), 0));
    } catch (e) {
      /* 購読できなければ、短い間隔の確認だけ */
    }
  }
  setInterval(() => pushState(false), 250);

  const CMD = {
    pause: () => svc.player.pause(),
    resume: () => svc.player.resume(),
    next: () => svc.player.skipToNext(),
    prev: () => svc.player.skipToPrevious(),
    seek: (ms) => svc.player.seekTo(Math.max(0, Math.round(Number(ms)))),
    volume: (v) => (svc.volume || svc.engine).setVolume(Math.min(1, Math.max(0, Number(v)))),
    // ブラウザの自動再生の制限を解く（ユーザーの操作の直後に呼ぶ。Spotify 自身が、最初のクリックで呼ぶのと同じ）
    activate: () => svc.engine && typeof svc.engine.activateElement === 'function' && svc.engine.activateElement(),
    // ログイン: アプリ自身のログインのボタンの処理（クリック）を呼ぶ。見つからなければ、Spotify のログインの画面へ（戻り先はこのページ）
    login: () => {
      const stack = [];
      for (const root of roots) stack.push(root && root.current);
      const budget = performance.now() + 1500;
      while (stack.length && performance.now() < budget) {
        const n = stack.pop();
        if (!n) continue;
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
        const p = n.memoizedProps;
        if (p && typeof p === 'object' && p['data-testid'] === 'login-button' && typeof p.onClick === 'function') {
          p.onClick({ preventDefault() {}, stopPropagation() {}, persist() {}, currentTarget: null, target: null, type: 'click' });
          return;
        }
      }
      location.href = 'https://accounts.spotify.com/login?continue=' + encodeURIComponent(location.origin + '/');
    },
    // 歌詞の画面（歌詞の部品ができる）へ移る・戻る。アプリ内の移動（履歴）なので、音は止まらない。
    // 移り先は、アプリ自身の歌詞ボタンが知っている（href か onClick）。押すのと同じ処理を呼ぶ。見つからなければ履歴で /lyrics へ
    lyricsView: (on) => {
      const B = window.__svBoot;
      const h = B && B.platform && B.platform.getHistory();
      const pre = (location.pathname.match(/^\/(intl-[a-z-]+)(?=\/)/) || [''])[0];
      const btn = lyricsButton(true);
      const at = /\/lyrics\/?$/.test(location.pathname) || (btn && (btn['aria-pressed'] === true || btn['aria-pressed'] === 'true' || btn['data-active'] === true || btn['data-active'] === 'true'));
      if (on === !!at) return;
      if (on) {
        if (btn && typeof btn.href === 'string' && btn.href.charAt(0) === '/' && h) h.push(btn.href);
        else if (btn && typeof btn.onClick === 'function') btn.onClick({ button: 0, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault() {}, stopPropagation() {}, persist() {}, currentTarget: null, target: null, type: 'click', nativeEvent: {} });
        else if (h) h.push(pre + '/lyrics');
      } else if (h) h.push(pre + '/');
    },
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.svAppAsk) {
      pushState(true);
      return;
    }
    const c = e.data.svAppCmd;
    if (!c || !CMD[c]) return;
    try {
      findServices();
      const need = c === 'volume' ? svc.volume || svc.engine : c === 'activate' ? svc.engine : c === 'lyricsView' || c === 'login' ? true : svc.player;
      const r = need && CMD[c](e.data.arg);
      Promise.resolve(r).catch((err) => console.error('[SV] app command', c, err));
    } catch (err) {
      console.error('[SV] app command', c, err);
    }
    setTimeout(() => pushState(true), 250);
    setTimeout(() => pushState(true), 1000);
  });

  // ================= 診断（読み取りだけ）=================
  // 「Spotify のアプリの内部に、どんな部品があるか」の形だけを集める（実機で一度取って、画面の差し替えの設計に使う）。
  // 集めるのは、名前・種類・メソッドの名前・数だけ。文字の値（トークン・ID・曲名など）は、一切集めない。getter は呼ばない（通信などの副作用を起こさない）。
  const PLAYERISH = /^(play|pause|resume|seek|seekTo|skipTo|skipToNext|skipToPrevious|next|previous|prev|setVolume|getVolume|volume|getState|getPlayerState|subscribe|unsubscribe|addListener|removeListener|on|off|togglePlay|isPlaying|getCurrentTrack|getQueue|setShuffle|setRepeat|getLyrics|fetchLyrics)$/i;

  /** 値の「形」だけを返す（文字列は中身を見ない）。 */
  function shape(v, depth, seen) {
    const t = typeof v;
    if (v === null) return 'null';
    if (t === 'function') return 'fn(' + v.length + ')' + (v.name ? ':' + v.name : '');
    if (t === 'string') return 'str';
    if (t !== 'object') return t;
    if (typeof Node !== 'undefined' && v instanceof Node) return 'dom:' + v.nodeName;
    if (Array.isArray(v)) return 'arr[' + v.length + ']' + (v.length && depth > 0 ? ' of ' + shape(v[0], depth - 1, seen) : '');
    if (seen.has(v)) return 'circular';
    if (depth <= 0) return 'obj';
    seen.add(v);
    const out = {};
    let n = 0;
    const names = new Set();
    // 自分のキーと、プロトタイプのメソッドの名前（クラスのインスタンスは、メソッドがプロトタイプにある）
    for (let o = v, hops = 0; o && o !== Object.prototype && hops < 4; o = Object.getPrototypeOf(o), hops++) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (k === 'constructor' || names.has(k)) continue;
        names.add(k);
        if (++n > 60) break;
        const d = Object.getOwnPropertyDescriptor(o, k);
        out[(o === v ? '' : '^') + k] = d && 'value' in d ? shape(d.value, depth - 1, seen) : 'getter';
      }
      if (n > 60) break;
    }
    return out;
  }

  /** プレーヤーの API らしいオブジェクトか（再生・一時停止・シークなどの名前のメソッドを 3 つ以上持つ）。 */
  function playerish(v) {
    if (!v || typeof v !== 'object') return 0;
    let c = 0;
    const seen = new Set();
    for (let o = v, hops = 0; o && o !== Object.prototype && hops < 4; o = Object.getPrototypeOf(o), hops++) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (seen.has(k) || !PLAYERISH.test(k)) continue;
        seen.add(k);
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d && typeof d.value === 'function') c++;
      }
    }
    return c;
  }

  const maskPath = (u) => {
    try {
      const x = new URL(u);
      const path = x.pathname.replace(/[A-Za-z0-9]{22}/g, '{id}').replace(/[0-9a-f]{32}/g, '{gid}').replace(/\d{3,}/g, '{n}');
      return x.host + path;
    } catch (e) {
      return '';
    }
  };


  /** 音量・ミュートのメソッドを持つオブジェクトか。 */
  function volumeish(v) {
    if (!v || typeof v !== 'object') return false;
    for (let o = v, hops = 0; o && o !== Object.prototype && hops < 4; o = Object.getPrototypeOf(o), hops++) {
      for (const k of Object.getOwnPropertyNames(o)) {
        if (!/volume|mute/i.test(k)) continue;
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (d && typeof d.value === 'function') return true;
      }
    }
    return false;
  }

  /**
   * モジュールの仕組み（rspack / webpack）: 公式の入口（チャンクの配列 rspackChunk・webpackChunk…）に、空の章を 1 つ足すと、内部の require を受け取れる（よく知られた方法）。
   * 受け取れるか、モジュールの数、プレーヤー・プラットフォーム・音量・歌詞などの名前を持つ export が、どのモジュールにあるか（名前だけ）を調べる。
   */
  function moduleInfo(budgetUntil) {
    const key = Object.getOwnPropertyNames(window).find((k) => /^(rspack|webpack)Chunk/.test(k));
    if (!key) return { chunkArray: null };
    const arr = window[key];
    const info = { chunkArray: key, length: arr && arr.length };
    let req = null;
    try {
      arr.push([['sv-diag-' + Math.random().toString(36).slice(2)], {}, (r) => {
        req = r;
      }]);
    } catch (e) {
      info.pushError = String(e && e.message).slice(0, 80);
    }
    info.require = !!req;
    if (!req) return info;
    info.modules = req.m ? Object.keys(req.m).length : null;
    info.cache = req.c ? Object.keys(req.c).length : null;
    // モジュールの中身の文字を検索する（関数の文字列を読むだけで、モジュールは実行しない。id と、どの文字が見つかったかだけを報告し、ソースは報告しない）
    const patterns = { lyrics: /color-lyrics/, volume: /setVolume|getVolume|volumeBar/, playerAPI: /PlayerAPI/, mediaSession: /setActionHandler|mediaSession/, render: /createRoot|\.render\(/, registry: /getRegistry|\.resolve\(/ , connect: /connect-state|connectState|ConnectAPI|connectAPI/ };
    const found = {};
    for (const k of Object.keys(patterns)) found[k] = [];
    try {
      for (const id of Object.keys(req.m || {})) {
        if (performance.now() > budgetUntil) {
          info.searchTruncated = true;
          break;
        }
        let src = '';
        try {
          src = Function.prototype.toString.call(req.m[id]);
        } catch (e) {
          continue;
        }
        for (const k of Object.keys(patterns)) if (found[k].length < 15 && patterns[k].test(src)) found[k].push(id + ':' + src.length);
      }
    } catch (e) {
      /* なくてもよい */
    }
    info.moduleSearch = found;
    const re = /player|platform|playback|volume|lyric|connect|queue|history|cosmos|transport|session|settings/i;
    const hits = [];
    for (const id of Object.keys(req.c || {})) {
      if (performance.now() > budgetUntil || hits.length >= 80) break;
      const ex = req.c[id] && req.c[id].exports;
      if (!ex || (typeof ex !== 'object' && typeof ex !== 'function')) continue;
      let names = [];
      try {
        names = Object.keys(ex).filter((k) => re.test(k)).slice(0, 10);
      } catch (e) {
        /* getter で例外になるものは飛ばす */
      }
      if (names.length) hits.push({ id, exports: names });
    }
    info.hits = hits;
    return info;
  }

  function collectDiag() {
    const t0 = performance.now();
    const report = { v: 1, ua: navigator.userAgent, url: location.origin + location.pathname.replace(/[A-Za-z0-9]{22}/g, '{id}'), roots: roots.size };
    // 1) アプリが、標準にないグローバル変数を作っているか（名前と種類だけ）
    try {
      const ifr = document.createElement('iframe');
      ifr.style.display = 'none';
      document.documentElement.appendChild(ifr);
      const base = new Set(Object.getOwnPropertyNames(ifr.contentWindow));
      ifr.remove();
      report.globals = Object.getOwnPropertyNames(window)
        .filter((k) => !base.has(k))
        .slice(0, 80)
        .map((k) => {
          const d = Object.getOwnPropertyDescriptor(window, k);
          return k + ':' + (d && 'value' in d ? shape(d.value, 0, new Set()) : 'getter');
        });
    } catch (e) {
      report.globals = ['error'];
    }
    // 2) アプリが使っている通信先（ホストとパスだけ。ID・数字は伏せる。値・クエリは見ない）
    try {
      const set = new Set();
      for (const en of performance.getEntriesByType('resource')) {
        if (en.initiatorType === 'fetch' || en.initiatorType === 'xmlhttprequest') {
          const m = maskPath(en.name);
          if (m && /spotify|scdn/.test(m)) set.add(m);
        }
      }
      report.endpoints = Array.from(set).sort().slice(0, 120);
    } catch (e) {
      report.endpoints = ['error'];
    }
    // 3) 部品の木: Provider の値（アプリの内部の部品が、ここに入っていることが多い）と、プレーヤーの API らしいオブジェクト
    const providers = [];
    const candidates = [];
    const volumes = [];
    let playerObj = null;
    const names = new Map();
    let fibers = 0;
    const budget = t0 + 2500;
    const seenCand = new Set();
    for (const root of roots) {
      const start = root && root.current;
      if (!start) continue;
      const stack = [start];
      while (stack.length && performance.now() < budget) {
        const n = stack.pop();
        fibers++;
        if (n.sibling) stack.push(n.sibling);
        if (n.child) stack.push(n.child);
        const type = n.type;
        const p = n.memoizedProps;
        if (n.tag === 10 && p && typeof p === 'object' && 'value' in p) {
          // Context.Provider（tag 10）
          const dn = (type && type._context && type._context.displayName) || '';
          const sig = dn + '|' + (p.value && typeof p.value === 'object' ? Object.keys(p.value).sort().join(',') : typeof p.value);
          if (!seenCand.has('P' + sig) && providers.length < 120) {
            seenCand.add('P' + sig);
            providers.push({ name: dn, value: shape(p.value, 2, new Set()) });
          }
        }
        if (type && (typeof type === 'function' || typeof type === 'object')) {
          const nm = (type.displayName || type.name || (type.type && (type.type.displayName || type.type.name)) || '').slice(0, 40);
          if (nm) names.set(nm, (names.get(nm) || 0) + 1);
        }
        // props の中に、プレーヤーの API らしいオブジェクトがあるか（1 段）
        if (p && typeof p === 'object') {
          for (const k of Object.keys(p).slice(0, 30)) {
            const v = p[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && playerish(v) >= 3) {
              const sig = 'C' + k + '|' + Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {}).length;
              if (!seenCand.has(sig) && candidates.length < 60) {
                seenCand.add(sig);
                candidates.push({ prop: k, component: ((type && (type.displayName || type.name)) || '').slice(0, 40), score: playerish(v), shape: shape(v, 1, new Set()) });
                if (!playerObj && playerish(v) >= 6) playerObj = v;
              }
            }
            if (v && typeof v === 'object' && !Array.isArray(v) && volumeish(v)) {
              const sig = 'V' + k + '|' + Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {}).length;
              if (!seenCand.has(sig) && volumes.length < 20) {
                seenCand.add(sig);
                volumes.push({ prop: k, component: ((type && (type.displayName || type.name)) || '').slice(0, 40), shape: shape(v, 1, new Set()) });
              }
            }
          }
        }
      }
    }
    report.fibers = fibers;
    report.providers = providers;
    report.candidates = candidates;
    report.volumeCandidates = volumes;
    // プレーヤーの API の、いまの状態の「形」（getState() は、状態を返すだけの読み取り。文字の値は見ない）
    if (playerObj && typeof playerObj.getState === 'function') {
      try {
        report.playerState = shape(playerObj.getState(), 3, new Set());
      } catch (e) {
        report.playerState = 'error: ' + String(e && e.message).slice(0, 80);
      }
    }
    // プラットフォーム（React の Context の値で、getRegistry・getSession・getTransport などを持つもの）の、レジストリ・セッション・通信の「形」
    for (const p of providers) {
      if (p.value && typeof p.value === 'object' && 'getRegistry' in p.value) {
        report.platform = { keys: Object.keys(p.value) };
        break;
      }
    }
    try {
      for (const root of roots) {
        const st = [root && root.current];
        let hops = 0;
        while (st.length && hops++ < 200000) {
          const n = st.pop();
          if (!n) continue;
          if (n.sibling) st.push(n.sibling);
          if (n.child) st.push(n.child);
          const pv = n.tag === 10 && n.memoizedProps && n.memoizedProps.value;
          if (pv && typeof pv === 'object' && typeof pv.getRegistry === 'function') {
            report.platform = report.platform || {};
            for (const name of ['getRegistry', 'getSession', 'getTransport']) {
              try {
                report.platform[name.slice(3)] = shape(pv[name](), 2, new Set());
              } catch (e) {
                report.platform[name.slice(3)] = 'error';
              }
            }
            st.length = 0;
            break;
          }
        }
        if (report.platform && report.platform.Registry) break;
      }
    } catch (e) {
      /* なくてもよい */
    }
    try {
      report.moduleSystem = moduleInfo(t0 + 4500);
    } catch (e) {
      report.moduleSystem = { error: String(e && e.message).slice(0, 80) };
    }
    report.components = Array.from(names.entries()).sort((a, b) => b[1] - a[1]).slice(0, 80).map(([k, c]) => k + ':' + c);
    // 4) アプリの根の要素
    try {
      const c = document.getElementById('main');
      report.container = c ? { id: 'main', tag: c.tagName, children: c.children.length } : null;
      report.bodyChildren = Array.from(document.body.children).map((e) => e.tagName + (e.id ? '#' + e.id : '')).slice(0, 30);
    } catch (e) {
      /* なくてもよい */
    }
    const B = window.__svBoot;
    report.boot = B ? { patched: B.patched, renders: B.renders, platform: !!B.platform, container: B.container && B.container.id, error: B.error } : null;
    try {
      report.lyrics = lyricsDebug(); // 歌詞が出ない理由を探すための、数だけの情報
    } catch (e) {
      report.lyrics = { error: String(e && e.message).slice(0, 60) };
    }
    report.ms = Math.round(performance.now() - t0);
    return report;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.svReactAsk !== 'diag') return;
    let report;
    try {
      report = collectDiag();
    } catch (err) {
      report = { error: String(err && err.message) };
    }
    window.postMessage({ svReact: 'diag', report }, location.origin);
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.svReactAsk !== 'lyrics') return;
    let lines = [];
    const t0 = performance.now();
    try {
      lines = collectLyrics();
    } catch (err) {
      console.error('[SV] react lyrics', err);
    }
    let dbg = null;
    try {
      dbg = lines.length || !(e.data.n >= 6) ? null : lyricsDebug(); // 診断は、しばらく出ないときだけ
    } catch (err) {
      dbg = { error: String(err && err.message).slice(0, 60) };
    }
    window.postMessage({ svReact: 'lyrics', lines, ms: performance.now() - t0, dbg }, location.origin);
  });
})();
