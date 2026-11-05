/*
 * Spotify のタブ（open.spotify.com）側の、読み取りと操作。画面は一切いじらない・隠さない（見えない裏のタブに置く）。
 * 曲の情報・再生位置・操作は、変わりにくい順に: メディアセッション（標準の API。ページ側の橋 session-main.js が、登録された処理と再生位置を覚える）
 *   → 画面の目印・ボタンの表示名・範囲入力の並び → 音声の直接操作。歌詞は、Spotify の React の部品の props（react-main.js）から読む。
 * 読み取った状態は content.js が、拡張の自前ページ（spotify/np.html）へ送る。操作の依頼は、自前ページから届く。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});
  const { fmt, statusOf } = SV.spotifyCore;

  const SEL = Object.freeze({
    widget: '[data-testid="now-playing-widget-v2"], [data-testid="now-playing-widget"]',
    title: 'a[href*="/album/"], a[href*="/track/"], a[href*="/episode/"], a[href*="/show/"]',
    byline: '[data-testid="now-playing-widget-v2-byline"], [data-testid="context-item-info-artist"]',
    cover: '[data-testid="cover-art-image"]',
    coverButton: '[data-testid="cover-art-button"]',
    position: '[data-testid="playback-position"]',
    duration: '[data-testid="playback-duration"]',
    playPause: '[data-testid="control-button-playpause"]',
    prev: '[data-testid="control-button-skip-back"]',
    next: '[data-testid="control-button-skip-forward"]',
    seek: '[data-testid="playback-progressbar"] input[type="range"]',
    lyricsButton: '[data-testid="lyrics-button"]',
    lyricsLine: '[data-testid="lyrics-line"]',
    bar: '[data-testid="now-playing-bar"]',
    login: '[data-testid="login-button"]',
    user: '[data-testid="user-widget-link"]',
    volumeBox: '[data-sv-slider="volume"]',
    seekBox: '[data-sv-slider="seek"]',
    volumeInput: '[data-testid="volume-bar"] input[type="range"]',
  });

  /**
   * サイトの作りが変わっても動くよう、読み取りと操作の部品は、2 段で探す（単純さを保つため、段はこれだけ）。
   *   1) 既知の目印（data-testid。上の SEL）
   *   2) 見た目の意味: ボタンの表示名（aria-label）、再生バーの中の範囲入力の並び、再生中の音声（audio/video）、ブラウザの再生情報（mediaSession）
   * クラス名（ハッシュ）には頼らない。見つけた要素は覚えておき、DOM から外れたら探し直す（毎回探さない）。
   */
  const LABEL = {
    playPause: /^(再生|一時停止|play|pause)$/i,
    prev: /^(前へ|前の曲|前のトラック|previous( track)?|prev)$/i,
    next: /^(次へ|次の曲|次のトラック|next( track)?)$/i,
    lyricsButton: /^(歌詞|lyrics)$/i,
    login: /^(ログイン|log ?in|sign ?in)$/i,
  };
  const found = new WeakMap(); // document → { key: 要素 }

  function find(doc, key) {
    let c = found.get(doc);
    if (!c) found.set(doc, (c = {}));
    const hit = c[key];
    if (hit && hit.isConnected) return hit;
    // 見つからなかったものは、2 秒に 1 回まで探す（取り外した大きな木の中を、毎回調べない。ないものを探し続けるのが一番高くつく）
    const now = Date.now();
    if (now - (c['miss:' + key] || 0) < 2000) return null;
    c['miss:' + key] = now;
    let el = null;
    el = doc.querySelector(SEL[key]);
    if (!el && key === 'bar') el = Array.from(doc.querySelectorAll('footer, aside')).find((x) => x.querySelector('input[type="range"]')) || null;
    else if (!el && LABEL[key]) {
      const scope = key === 'login' ? 'header, nav, [role="banner"]' : null; // ログインは上のバーにある（ページ全体は調べない）
      const bases = scope ? Array.from(doc.querySelectorAll(scope)) : [find(doc, 'bar') || doc];
      for (const b of bases.flatMap((r) => Array.from(r.querySelectorAll('button, [role="button"], a')))) {
        const name = (b.getAttribute('aria-label') || (key === 'login' ? text(b) : '')).trim();
        if (name && LABEL[key].test(name)) {
          el = b;
          break;
        }
      }
    }
    if (el) {
      c[key] = el;
      c['miss:' + key] = 0;
    }
    return el;
  }

  /** 再生バーの範囲入力（再生位置・音量）。目印がなければ、バーの中の並び（再生位置 → 音量）で決める。 */
  function range(doc, kind) {
    const hit = doc.querySelector(kind === 'seek' ? SEL.seek : SEL.volumeInput);
    if (hit) return hit;
    const bar = find(doc, 'bar');
    const all = Array.from((bar || doc).querySelectorAll('input[type="range"]')).filter((x) => !x.closest('[class*="LayoutResizer"], [aria-hidden="true"]'));
    if (all.length < 2) return null;
    return kind === 'seek' ? all[0] : all[all.length - 1];
  }

  /** 再生中の音声（audio / video）。長さが分かるものだけ。 */
  function media(doc) {
    let first = null;
    for (const m of doc.querySelectorAll('audio, video')) {
      if (!(Number.isFinite(m.duration) && m.duration > 0)) continue;
      if (!m.paused) return m; // 再生中のものを優先（広告・プレビューなどが別にあっても、鳴っている方）
      first = first || m;
    }
    return first;
  }

  /**
   * ブラウザの標準の「メディアセッション」API（Spotify が OS のメディアキー用に出している）。画面の作りが変わっても変わらないので、最優先で使う。
   *   読み取り: 曲名・アーティスト・ジャケット・再生状態（navigator.mediaSession から直接）
   *   再生位置・操作: ページ側の橋（session-main.js）が覚えた setPositionState と、登録されたハンドラ（play・pause・previoustrack・nexttrack・seekto など）
   */
  function session(doc) {
    try {
      const s = doc.defaultView.navigator.mediaSession;
      const m = s.metadata;
      if (!m || !m.title) return null;
      const art = m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : '';
      return { title: String(m.title), artist: String(m.artist || ''), cover: art || '', state: s.playbackState || 'none' };
    } catch (e) {
      return null;
    }
  }

  const bridge = { actions: new Set(), pos: null, vol: null, onChange: null, wasPlaying: null, posKey: '' };
  /** 登録された処理があれば呼ぶ（OS のメディアキーが押されたのと同じ）。呼べたら true。 */
  function callSession(action, details) {
    if (!bridge.actions.has(action) || typeof root.postMessage !== 'function') return false;
    root.postMessage({ svMsCall: action, details: details || {} }, root.location.origin);
    // シークは、Spotify が再生位置を更新し直すのを待たず、すぐ反映する（待つと、棒と歌詞が遅れて見える）
    if (action === 'seekto' && bridge.pos && details && Number.isFinite(details.seekTime)) bridge.pos = Object.assign({}, bridge.pos, { position: details.seekTime, at: Date.now() });
    return true;
  }
  /**
   * setPositionState から、いまの再生位置（秒）。再生中は、時間の経過ぶん進める。なければ null。
   * 再生と一時停止が切り替わった瞬間に、その時点の位置に合わせ直す（Spotify が切り替えのたびに位置を出し直すとは限らないので、ずれて飛ばないように）。
   */
  function sessionPosition(playing) {
    const p = bridge.pos;
    if (!p || !(p.duration > 0)) return null;
    const now = Date.now();
    if (bridge.wasPlaying === null) {
      bridge.wasPlaying = playing; // Spotify が出し直した位置は、そのまま信じる
    } else if (bridge.wasPlaying !== playing) {
      if (bridge.wasPlaying) p.position = Math.min(p.duration, p.position + ((now - p.at) / 1000) * p.rate); // 再生中 → 一時停止: 止まった位置に合わせる
      p.at = now;
      bridge.wasPlaying = playing;
    }
    const t = p.position + (playing ? ((now - p.at) / 1000) * p.rate : 0);
    return { position: Math.min(p.duration, Math.max(0, t)), duration: p.duration };
  }
  if (typeof root.addEventListener === 'function' && root.location) {
    root.addEventListener('message', (e) => {
      if (e.source !== root || !e.data || e.data.svMs !== 'caps') return;
      bridge.actions = new Set(e.data.actions || []);
      // 位置が前と同じ（曲の情報などの知らせに付いてきただけ）なら、こちらで合わせ直した位置を残す。Spotify が出し直した位置なら、置き換える
      const np = e.data.pos || null;
      const key = np ? np.at + ':' + np.position + ':' + np.duration : '';
      if (key !== bridge.posKey) {
        bridge.posKey = key;
        bridge.pos = np ? Object.assign({}, np) : null;
        bridge.wasPlaying = null;
      }
      bridge.vol = typeof e.data.vol === 'number' ? e.data.vol : null;
      if (bridge.onChange) bridge.onChange();
    });
    root.postMessage({ svMsHello: 1 }, root.location.origin);
  }

  /**
   * アプリ自身のサービス（react-main.js。playerAPI・standalonePlayer）が送ってくる、再生の状態。最優先で使う。
   *   state: { has, paused, buffering, positionMs, timestamp, durationMs, title, artists[], cover, uri, … }   vol: 音量（0〜1）
   */
  const app = { state: null, vol: null, recv: 0, onChange: null };
  if (typeof root.addEventListener === 'function' && root.location) {
    root.addEventListener('message', (e) => {
      if (e.source !== root || !e.data) return;
      if (e.data.svApp === 'state') {
        app.state = e.data.state;
        app.vol = typeof e.data.vol === 'number' ? e.data.vol : null;
        app.recv = Date.now();
        if (app.onChange) app.onChange();
      } else if (e.data.svApp === 'none') {
        app.state = null;
      }
    });
    root.postMessage({ svAppAsk: 1 }, root.location.origin);
  }
  /** アプリのサービスから、最近（8 秒以内。変わらなくても 2 秒おきに届く）状態が届いているか。 */
  const appOk = () => !!app.state && Date.now() - app.recv < 8000;
  /** アプリの状態から、いまの再生位置（ミリ秒）。再生中は経過時間で進める。時計がずれていて、おかしな値になるときは、届いた時刻から進める。 */
  function appPositionMs(now) {
    const st = app.state;
    if (!st || !Number.isFinite(st.positionMs)) return null;
    if (st.paused) return Math.min(st.durationMs || Infinity, Math.max(0, st.positionMs));
    let t = st.positionMs + (Number.isFinite(st.timestamp) ? now - st.timestamp : 0) * (st.speed || 1);
    if (!(t >= -2000 && (!st.durationMs || t <= st.durationMs + 5000))) t = st.positionMs + (now - app.recv); // 時計が合わないとき
    return Math.min(st.durationMs || Infinity, Math.max(0, t));
  }
  const appCmd = (cmd, arg) => root.postMessage({ svAppCmd: cmd, arg }, root.location.origin);

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /** いま再生中の曲名だけ（軽い読み取り。曲が変わったかの確認用）。 */
  function trackTitle(doc) {
    if (appOk()) return app.state.title;
    const m = session(doc);
    if (m) return m.title;
    const w = doc.querySelector(SEL.widget);
    return text(w && w.querySelector(SEL.title));
  }

  /** アプリ自身のサービスの状態から、画面に出す情報を作る。 */
  function readApp() {
    const st = app.state;
    const now = Date.now();
    const posMs = appPositionMs(now);
    const durationSec = st.durationMs > 0 ? st.durationMs / 1000 : null;
    const positionSec = posMs != null && durationSec != null ? posMs / 1000 : null;
    return {
      hasTrack: !!st.has && !!st.title,
      title: st.title,
      artists: st.artists.join(', '),
      cover: st.cover,
      playing: !st.paused,
      position: positionSec != null ? fmt(positionSec) : '',
      duration: durationSec != null ? fmt(durationSec) : '',
      positionSec,
      durationSec,
      ratio: positionSec != null && durationSec ? Math.min(1, positionSec / durationSec) : 0,
      volume: app.vol,
      source: 'app',
    };
  }

  /**
   * いま再生中の曲の情報を読む（DOM に触るのは読むだけ）。優先順は、変わりにくい順:
   *   曲の情報: メディアセッション → 画面の目印    再生状態: メディアセッション → 音声 → ボタンの表示名
   *   再生位置: メディアセッションの再生位置 → 音声（audio/video）→ 画面（範囲入力・時間の表示）
   */
  function read(doc) {
    if (appOk()) return readApp();
    const ses = session(doc);
    const w = doc.querySelector(SEL.widget);
    const img = w && w.querySelector(SEL.cover);
    const title = (ses && ses.title) || text(w && w.querySelector(SEL.title));
    const artists = (ses && ses.artist) || text(w && w.querySelector(SEL.byline));
    const cover = (ses && ses.cover) || (img ? img.currentSrc || img.src || '' : '');
    const au = media(doc);
    const pp = find(doc, 'playPause');
    const label = (pp && pp.getAttribute('aria-label')) || '';
    const playing = ses && ses.state === 'playing' ? true : ses && ses.state === 'paused' ? false : au ? !au.paused && !au.ended : /一時停止|pause/i.test(label);
    const seek = range(doc, 'seek');
    const max = seek ? Number(seek.max) : 0;
    let position = text(doc.querySelector(SEL.position));
    let duration = text(doc.querySelector(SEL.duration));
    let ratio = seek && max > 0 ? Math.min(1, Math.max(0, Number(seek.value) / max)) : 0;
    let positionSec = null;
    let durationSec = null;
    const sp = sessionPosition(playing);
    if (sp) {
      positionSec = sp.position;
      durationSec = sp.duration;
    } else if (au) {
      positionSec = au.currentTime;
      durationSec = au.duration;
    }
    if (positionSec != null) {
      position = fmt(positionSec);
      duration = fmt(durationSec);
      ratio = Math.min(1, Math.max(0, positionSec / durationSec));
    } else if ((!position || !duration) && seek) {
      const m = /(\d+:\d+(?::\d+)?)\s*\/\s*(\d+:\d+(?::\d+)?)/.exec(seek.getAttribute('aria-valuetext') || '');
      if (m) {
        position = position || m[1];
        duration = duration || m[2];
      }
    }
    if (positionSec == null) {
      // 画面の時間の表示（m:ss）から。ほかに再生位置の読み取りがないときの代わり（歌詞のいまの行を決めるのに要る）
      const toSec = (t) => (/^\d+:\d+(?::\d+)?$/.test(t) ? t.split(':').reduce((a, x) => a * 60 + Number(x), 0) : null);
      positionSec = toSec(position);
      durationSec = toSec(duration);
    }
    const vol = range(doc, 'volume');
    return {
      source: ses ? 'session' : 'dom',
      hasTrack: !!title,
      title,
      artists,
      cover,
      playing,
      position,
      duration,
      positionSec,
      durationSec,
      ratio,
      volume: vol && Number(vol.max) > 0 ? Number(vol.value) / Number(vol.max) : bridge.vol != null ? bridge.vol : au ? au.volume : null,
    };
  }

  /** ページから、状態を読む（drm は呼び出し側が確認した結果。waited: 開いてから十分待ったか。目印が変わって「読み込み中」のままにならないように）。 */
  function detect(doc, drm, waited) {
    const info = read(doc);
    const loggedOut = !!find(doc, 'login') && !doc.querySelector(SEL.user);
    const ready = appOk() || !!find(doc, 'bar') || !!media(doc) || !!session(doc) || !!waited;
    return { kind: statusOf({ loggedOut, hasTrack: info.hasTrack, ready, drm }), info };
  }

  /** 再生に必要な保護機能（Widevine）が使えるか。 */
  function checkWidevine(win) {
    const n = win && win.navigator;
    if (!n || typeof n.requestMediaKeySystemAccess !== 'function') return Promise.resolve(false);
    return n
      .requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }])
      .then(() => true, () => false);
  }

  /**
   * 読み取り役を作る。snapshot() で、いまの状態（自前ページへ送る形）を返す。command() で、自前ページからの操作の依頼を実行する。
   *   歌詞は、設定（opts.getLyrics）がオンのとき、Spotify の歌詞ボタンを押して歌詞の画面を作らせ（Spotify のタブは見えないので、ボタンを押すのは拡張だけ）、
   *   React の部品の木から行（文字・開始時刻）を読む。
   */
  function createReader(opts) {
    const doc = (opts && opts.document) || document;
    const win = doc.defaultView;
    const createdAt = Date.now();
    let drm = null;
    let openedLyrics = false; // 歌詞を出すために、こちらで歌詞ボタンを押したか
    let lastSyncAt = 0;
    let lastAppAsk = 0;
    let lyricLines = []; // react-main.js から受け取った歌詞の行 [{ text, start }]
    let lyricTitle = '';
    let lyricTitleAt = 0;
    let lyricOldSig = '';
    let lyricAskAt = 0;
    let lyricAskGap = 500;
    let lyricAsks = 0;
    const waited = () => Date.now() - createdAt > 8000; // 目印が変わっても、「読み込み中」のままにしない
    const wantLyrics = () => (opts && opts.getLyrics ? !!opts.getLyrics() : true);
    const click = (key) => {
      const b = find(doc, key);
      if (b) b.click();
      return !!b;
    };

    // 保護機能の確認は 1 回だけ
    (opts && opts.checkDrm ? opts.checkDrm() : checkWidevine(win)).then((ok) => {
      drm = !!ok;
      if (opts && opts.onDrm) opts.onDrm();
    });

    /**
     * 操作は、変わりにくい順に試す: メディアセッションのハンドラ（OS のメディアキーと同じ）→ 画面のボタン・範囲入力 → 音声を直接。
     */
    function playPause() {
      if (appOk()) return appCmd(app.state.paused ? 'resume' : 'pause'); // アプリ自身のサービス（画面のボタンを押すのと同じ）
      const playing = read(doc).playing;
      if (callSession(playing ? 'pause' : 'play')) return;
      click('playPause');
    }
    function skip(dir) {
      if (appOk()) return appCmd(dir > 0 ? 'next' : 'prev');
      if (callSession(dir > 0 ? 'nexttrack' : 'previoustrack')) return;
      click(dir > 0 ? 'next' : 'prev');
    }
    /** 再生位置を 10 秒動かす。 */
    function seekBy(dir) {
      if (appOk() && app.state.canSeek !== false) {
        const target = Math.min(app.state.durationMs, Math.max(0, (appPositionMs(Date.now()) || 0) + dir * 10000));
        appCmd('seek', target);
        // すぐ反映する（アプリが状態を出し直すのを待たない）
        app.state = Object.assign({}, app.state, { positionMs: target, timestamp: Date.now() });
        return;
      }
      const i = read(doc);
      if (i.positionSec != null && callSession('seekto', { seekTime: Math.min(i.durationSec, Math.max(0, i.positionSec + dir * 10)) })) return;
      if (callSession(dir > 0 ? 'seekforward' : 'seekbackward', { seekOffset: 10 })) return;
      stepRange('seek', dir);
    }
    /** 音量を 10% 動かす（メディアセッションに音量はないので、範囲入力 → 音声を直接）。 */
    function volumeBy(dir) {
      if (appOk() && app.vol != null) {
        const v = Math.min(1, Math.max(0, Math.round((app.vol + dir * 0.1) * 10) / 10));
        app.vol = v;
        return appCmd('volume', v);
      }
      stepRange('volume', dir);
    }

    /** 範囲入力を、決まった幅（再生位置は 10 秒、音量は 10%）だけ動かす。サイトの React が input イベントで気づく。入力がなければ、音声を直接動かす。 */
    function stepRange(kind, dir) {
      const r = range(doc, kind);
      if (r) {
        const max = Number(r.max) || 1;
        const delta = kind === 'seek' ? (max > 10000 ? 10000 : 10) : max * 0.1;
        const n = Math.max(1, Math.round(delta / (Number(r.step) > 0 ? Number(r.step) : 1)));
        if (dir > 0) r.stepUp(n);
        else r.stepDown(n);
        r.dispatchEvent(new Event('input', { bubbles: true }));
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      if (kind === 'volume' && bridge.vol != null) {
        root.postMessage({ svMsVolume: Math.round((bridge.vol + dir * 0.1) * 10) / 10 }, root.location.origin);
        return true;
      }
      const m = media(doc);
      if (!m) return false;
      if (kind === 'seek') m.currentTime = Math.min(m.duration, Math.max(0, m.currentTime + dir * 10));
      else m.volume = Math.min(1, Math.max(0, Math.round((m.volume + dir * 0.1) * 10) / 10));
      return true;
    }


    const sigOf = (L) => L.length + '\n' + (L[0] ? L[0].text : '') + '\n' + (L.length ? L[L.length - 1].text : '');
    root.addEventListener('message', (e) => {
      if (e.source === root && e.data && e.data.svReact === 'diag' && opts && opts.onDiag) opts.onDiag(e.data.report); // 診断の報告（読み取りだけ。react-main.js）
      if (e.source !== root || !e.data || e.data.svReact !== 'lyrics') return;
      const L = Array.isArray(e.data.lines) ? e.data.lines : [];
      // 曲が変わった直後は、前の曲の歌詞がまだ部品の木に残っている。違う歌詞になるまで（または 5 秒たつまで）、新しい曲の歌詞とみなさない
      if (L.length && sigOf(L) === lyricOldSig && Date.now() - lyricTitleAt < 5000) return;
      lyricLines = L;
    });

    /** Spotify の歌詞表示を、設定に合わせる（歌詞は、歌詞の画面が作られているときだけ、部品の木にある）。押しすぎないよう、1.5 秒に 1 回まで */
    function syncLyrics() {
      const now = Date.now();
      if (now - lastSyncAt < 1500) return;
      const lb = find(doc, 'lyricsButton');
      if (!lb) return;
      const pressed = lb.getAttribute('aria-pressed') === 'true';
      if (wantLyrics() && !pressed) {
        lastSyncAt = now;
        lb.click();
        openedLyrics = true;
      } else if (!wantLyrics() && pressed && openedLyrics) {
        lastSyncAt = now;
        lb.click();
        openedLyrics = false;
      }
    }

    /** 歌詞の行を、部品の木から読む（問い合わせ）。返ってこない間は、間隔を広げる（木をたどるのは、安くない）。 */
    function askLyrics(title) {
      const now = Date.now();
      if (title !== lyricTitle) {
        lyricTitle = title;
        lyricTitleAt = now;
        lyricOldSig = sigOf(lyricLines);
        lyricLines = [];
        lyricAskAt = 0;
        lyricAskGap = 500;
        lyricAsks = 0;
      }
      if (wantLyrics() && !lyricLines.length && now - lyricAskAt > lyricAskGap) {
        lyricAskAt = now;
        lyricAsks++;
        lyricAskGap = lyricAsks < 6 ? 500 : lyricAsks < 12 ? 1500 : lyricAsks < 20 ? 4000 : 8000;
        root.postMessage({ svReactAsk: 'lyrics' }, root.location.origin);
      }
    }

    /** 自前ページから届いた依頼を実行する。 */
    function command(cmd, arg) {
      if (cmd === 'playPause') playPause();
      else if (cmd === 'next') skip(1);
      else if (cmd === 'prev') skip(-1);
      else if (cmd === 'seek') seekBy(arg > 0 ? 1 : -1);
      else if (cmd === 'volume') volumeBy(arg > 0 ? 1 : -1);
      else if (cmd === 'login') click('login');
      else if (cmd === 'diag') root.postMessage({ svReactAsk: 'diag' }, root.location.origin);
      else if (cmd === 'lyrics') {
        lastSyncAt = 0;
        lyricAskAt = 0;
        lyricAsks = 0;
        lyricAskGap = 500;
        syncLyrics();
      }
    }

    /** いまの状態。自前ページへ送る形（再生位置は、at（この時刻）の値。受け取り側が、再生中は経過時間で進める）。 */
    function snapshot() {
      if (!appOk() && Date.now() - lastAppAsk > 2000) {
        lastAppAsk = Date.now();
        root.postMessage({ svAppAsk: 1 }, root.location.origin); // アプリのサービスの状態を、すぐ求める
      }
      const d = detect(doc, drm, waited());
      const i = d.info;
      syncLyrics();
      askLyrics(i.title);
      return {
        kind: d.kind,
        drm,
        at: Date.now(),
        source: i.source,
        info: {
          hasTrack: i.hasTrack,
          title: i.title,
          artists: i.artists,
          cover: i.cover,
          playing: i.playing,
          position: i.position,
          duration: i.duration,
          positionSec: i.positionSec,
          durationSec: i.durationSec,
          volume: i.volume,
        },
        lyrics: { on: wantLyrics(), lines: lyricLines, asks: lyricAsks },
      };
    }

    return { snapshot, command };
  }

  SV.spotifyEngine = {
    SEL,
    LABEL,
    find,
    trackTitle,
    read,
    detect,
    checkWidevine,
    createReader,
    appOk,
    onSessionChange: (fn) => {
      bridge.onChange = fn;
      app.onChange = fn;
    },
  };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyEngine;
})(typeof self !== 'undefined' ? self : globalThis);
