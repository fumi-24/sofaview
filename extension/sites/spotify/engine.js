/*
 * Spotify のページ（open.spotify.com）の、読み取りと操作。画面（自前）と同じページ・同じ世界で動く。Spotify 自身の画面は、文書の外に描かれる（boot-main.js）。
 * 状態・操作・音量は、変わりにくい順に:
 *   1) Spotify のアプリ自身のサービス（react-main.js。登録簿の PlayerAPI・PlaybackAPI）。状態は svApp で届き、操作は svAppCmd で依頼する
 *   2) メディアセッション（標準の API。session-main.js が、登録された処理と再生位置を覚える）
 * 歌詞は、Spotify の問い合わせキャッシュ（react-main.js）から受け取る。歌詞の画面は、アプリ自身の歌詞ボタンの移動で作らせる。歌詞の位置は、実際に鳴っている音声に合わせて補正する。
 * 呼ぶのはアプリ自身のサービスだけ。通信はアプリ自身が行い、拡張は認証情報に触らない。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});
  const { fmt, statusOf } = SV.spotifyCore;
  const core = SV.spotifyCore;

  // ---- 1) アプリ自身のサービス ----
  const app = { state: null, vol: null, anonymous: null, recv: 0, onChange: null };
  if (typeof root.addEventListener === 'function' && root.location) {
    root.addEventListener('message', (e) => {
      if (e.source !== root || !e.data) return;
      if (e.data.svApp === 'state') {
        app.state = e.data.state;
        app.vol = typeof e.data.vol === 'number' ? e.data.vol : null;
        if (typeof e.data.anonymous === 'boolean') app.anonymous = e.data.anonymous;
        app.recv = Date.now();
        if (app.onChange) app.onChange();
      } else if (e.data.svApp === 'none') {
        app.state = null;
        if (typeof e.data.anonymous === 'boolean') app.anonymous = e.data.anonymous;
        if (app.onChange) app.onChange();
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

  // ---- 2) メディアセッション（代わり）----
  /** ブラウザの標準の「メディアセッション」API（Spotify が OS のメディアキー用に出している）。曲の情報・再生状態は直接読める。 */
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
    if (action === 'seekto' && bridge.pos && details && Number.isFinite(details.seekTime)) bridge.pos = Object.assign({}, bridge.pos, { position: details.seekTime, at: Date.now() });
    return true;
  }
  /** setPositionState から、いまの再生位置（秒）。再生中は、時間の経過ぶん進める。再生と一時停止の切り替えで、その時点の位置に合わせ直す。 */
  function sessionPosition(playing) {
    const p = bridge.pos;
    if (!p || !(p.duration > 0)) return null;
    const now = Date.now();
    if (bridge.wasPlaying === null) bridge.wasPlaying = playing;
    else if (bridge.wasPlaying !== playing) {
      if (bridge.wasPlaying) p.position = Math.min(p.duration, p.position + ((now - p.at) / 1000) * p.rate);
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

  // ---- 読み取り ----
  /** アプリ自身のサービスの状態から、画面に出す情報を作る。 */
  function readApp() {
    const st = app.state;
    const posMs = appPositionMs(Date.now());
    const durationSec = st.durationMs > 0 ? st.durationMs / 1000 : null;
    const positionSec = posMs != null && durationSec != null ? posMs / 1000 : null;
    return {
      source: 'app',
      hasTrack: !!st.has && !!st.title,
      title: st.title,
      artists: st.artists.join(', '),
      cover: st.cover,
      playing: !st.paused,
      positionSec,
      durationSec,
      volume: app.vol,
    };
  }

  /** メディアセッションから（代わり）。 */
  function readSession(doc) {
    const ses = session(doc);
    const playing = ses && ses.state === 'playing';
    const sp = sessionPosition(playing);
    return {
      source: ses ? 'session' : 'none',
      hasTrack: !!ses,
      title: ses ? ses.title : '',
      artists: ses ? ses.artist : '',
      cover: ses ? ses.cover : '',
      playing: !!playing,
      positionSec: sp ? sp.position : null,
      durationSec: sp ? sp.duration : null,
      volume: bridge.vol,
    };
  }

  /** いま再生中の曲の情報。アプリ自身のサービス → メディアセッションの順。 */
  const read = (doc) => (appOk() ? readApp() : readSession(doc));
  const trackTitle = (doc) => read(doc).title;

  /** 状態を読む（drm は確認した結果。waited: 開いてから十分待ったか）。ログインしていないかは、プラットフォームのセッション。 */
  function detect(doc, drm, waited) {
    const info = read(doc);
    const loggedOut = app.anonymous === true;
    const ready = appOk() || app.anonymous != null || info.hasTrack || !!waited;
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
   * 読み取り役を作る。snapshot() で、いまの状態（画面に出す形）を返す。command() で、操作を実行する。
   * 歌詞は、設定（opts.getLyrics）がオンのとき、歌詞の画面（アプリ内の /lyrics）へ移らせ、React の部品の木から行（文字・開始時刻）を読む。
   */
  function createReader(opts) {
    const doc = (opts && opts.document) || document;
    const win = doc.defaultView;
    const createdAt = Date.now();
    let drm = null;
    let lastAppAsk = 0;
    let lyricLines = []; // react-main.js から受け取った歌詞の行 [{ text, start }]
    let lyricDbg = null; // 歌詞が出ない理由を探すための情報（数だけ）
    let lyricUri = ''; // 問い合わせキャッシュから届いた歌詞の曲の URI
    let lyricNone = false; // この曲には歌詞がない（キャッシュで分かった）
    let lyricSrc = ''; // 歌詞の出どころ: cache（問い合わせキャッシュ）/ tree（部品の木）
    let lyricViewTries = 0; // 歌詞の画面へ移る依頼の回数（同じ曲で、数回まで。アプリのボタンの切り替えを繰り返さない）
    let lyricTitle = '';
    let lyricTitleAt = 0;
    let lyricOldSig = '';
    let lyricAskAt = 0;
    let lyricAskGap = 250;
    let lyricAsks = 0;
    let lyricViewWant = null;
    let lyricViewAt = 0;
    const waited = () => Date.now() - createdAt > 8000; // サービスが見つからなくても、「読み込み中」のままにしない
    const wantLyrics = () => (opts && opts.getLyrics ? !!opts.getLyrics() : true);

    (opts && opts.checkDrm ? opts.checkDrm() : checkWidevine(win)).then((ok) => {
      drm = !!ok;
      if (opts && opts.onDrm) opts.onDrm();
    });

    // ---- 操作: アプリ自身のサービス → メディアセッション ----
    function playPause() {
      if (appOk()) return appCmd(app.state.paused ? 'resume' : 'pause');
      const playing = read(doc).playing;
      callSession(playing ? 'pause' : 'play');
    }
    function skip(dir) {
      if (appOk()) return appCmd(dir > 0 ? 'next' : 'prev');
      callSession(dir > 0 ? 'nexttrack' : 'previoustrack');
    }
    /** 再生位置を 10 秒動かす。 */
    function seekBy(dir) {
      if (appOk() && app.state.canSeek !== false) {
        const target = Math.min(app.state.durationMs, Math.max(0, (appPositionMs(Date.now()) || 0) + dir * 10000));
        appCmd('seek', target);
        app.state = Object.assign({}, app.state, { positionMs: target, timestamp: Date.now() }); // すぐ反映する（アプリが状態を出し直すのを待たない）
        return;
      }
      const i = read(doc);
      if (i.positionSec != null && callSession('seekto', { seekTime: Math.min(i.durationSec, Math.max(0, i.positionSec + dir * 10)) })) return;
      callSession(dir > 0 ? 'seekforward' : 'seekbackward', { seekOffset: 10 });
    }
    /** 音量を 10% 動かす。 */
    function volumeBy(dir) {
      if (appOk() && app.vol != null) {
        const v = Math.min(1, Math.max(0, Math.round((app.vol + dir * 0.1) * 10) / 10));
        app.vol = v;
        return appCmd('volume', v);
      }
      if (bridge.vol != null) root.postMessage({ svMsVolume: Math.round((bridge.vol + dir * 0.1) * 10) / 10 }, root.location.origin);
    }

    // ---- 歌詞 ----
    const sigOf = (L) => L.length + '\n' + (L[0] ? L[0].text : '') + '\n' + (L.length ? L[L.length - 1].text : '');
    // 実際に鳴っている音声の位置と、アプリの再生位置の差（秒。診断用）。音声の位置が曲の中の位置でないとき（差が大きすぎる）は null
    let mediaDiff = null;
    let mediaAskAt = 0;
    const mediaSamples = [];
    let lyricShift = 0; // 歌詞の位置の補正（秒。時計のずれ・アプリの位置の遅れを、実際の音声に合わせる）
    root.addEventListener('message', (e) => {
      if (e.source === root && e.data && e.data.svMs === 'media') {
        // 実際に鳴っている音声の位置と、アプリの再生位置の差。アプリの位置が遅れているなら、歌詞の位置をその分進める（歌詞は、聞こえている音に合わせる）
        const playing = app.state && appOk() && !app.state.paused && !app.state.buffering;
        const pm = playing ? appPositionMs(Date.now()) : null;
        const ct = Number.isFinite(e.data.ct) && e.data.paused === false ? e.data.ct : null;
        const d = pm != null && ct != null ? pm / 1000 - ct : null;
        mediaDiff = d != null && Math.abs(d) < 30 ? d : null;
        if (mediaDiff != null && Math.abs(mediaDiff) <= 8) {
          mediaSamples.push(mediaDiff);
          if (mediaSamples.length > 5) mediaSamples.shift();
          const sh = core.lyricShift(mediaSamples);
          if (sh != null) lyricShift = sh;
        } else mediaSamples.length = 0; // 止まっている・曲の変わり目などは、集め直す（補正は前のまま）
      }
      if (e.source === root && e.data && e.data.svReact === 'diag' && opts && opts.onDiag) opts.onDiag(e.data.report); // 診断の報告（読み取りだけ。react-main.js）
      if (e.source !== root || !e.data || e.data.svReact !== 'lyrics') return;
      const L = Array.isArray(e.data.lines) ? e.data.lines : [];
      if (e.data.src === 'cache') {
        // 問い合わせキャッシュから（曲の URI つき）。いまの曲のものだけ受け取る。前の曲のものが残っている心配はない
        const cur = app.state && app.state.uri;
        if (cur && e.data.uri && e.data.uri !== cur) return;
        lyricUri = e.data.uri || '';
        lyricNone = !!e.data.none;
        lyricLines = L;
        lyricSrc = 'cache';
        lyricDbg = null;
        return;
      }
      // 部品の木から。曲が変わった直後は、前の曲の歌詞がまだ部品の木に残っている。違う歌詞になるまで（または 5 秒たつまで）、新しい曲の歌詞とみなさない
      if (L.length && sigOf(L) === lyricOldSig && Date.now() - lyricTitleAt < 5000) return;
      if (lyricSrc === 'cache' && lyricLines.length && lyricUri && lyricUri === (app.state && app.state.uri)) return; // キャッシュのほうが確か
      lyricLines = L;
      lyricSrc = L.length ? 'tree' : '';
      lyricDbg = e.data.dbg || null;
    });

    /** 歌詞の画面（アプリ内の /lyrics）へ移る・戻る。設定に合わせる（変わったとき、または 5 秒に 1 回）。 */
    function syncLyricsView() {
      const want = wantLyrics();
      const now = Date.now();
      if (want === lyricViewWant && now - lyricViewAt < 8000) return;
      // 歌詞を出したい間は、行が届くまで、同じ曲で 4 回まで依頼する（アプリ側は、すでに歌詞の画面なら何もしない）
      if (want && want === lyricViewWant && (lyricLines.length || lyricViewTries >= 4)) return;
      lyricViewWant = want;
      lyricViewAt = now;
      lyricViewTries = want ? lyricViewTries + 1 : 0;
      appCmd('lyricsView', want);
    }

    /** 歌詞の行を、部品の木から読む（問い合わせ）。返ってこない間は、間隔を広げる（木をたどるのは、安くない）。 */
    function askLyrics(title) {
      const now = Date.now();
      const key = (appOk() && app.state.uri) || title;
      if (key !== lyricTitle) {
        const keep = !!lyricUri && lyricUri === key; // 先読みのキャッシュから、もう届いている
        lyricTitle = key;
        lyricTitleAt = now;
        lyricOldSig = sigOf(lyricLines);
        if (!keep) {
          lyricLines = [];
          lyricNone = false;
          lyricSrc = '';
          lyricUri = '';
        }
        lyricDbg = null;
        lyricViewTries = 0;
        lyricAskAt = 0;
        lyricAskGap = 250;
        lyricAsks = 0;
      }
      if (wantLyrics() && !lyricLines.length && !lyricNone && now - lyricAskAt > lyricAskGap) {
        lyricAskAt = now;
        lyricAsks++;
        lyricAskGap = lyricAsks < 24 ? 250 : lyricAsks < 34 ? 1000 : lyricAsks < 44 ? 3000 : 8000; // 曲が変わった直後の 6 秒は、0.25 秒おき（歌詞の出方を速く）。出なければ、間隔を広げる
        root.postMessage({ svReactAsk: 'lyrics', n: lyricAsks }, root.location.origin);
      }
    }

    /** 画面からの操作の依頼を実行する。 */
    function command(cmd, arg) {
      if (cmd === 'playPause') playPause();
      else if (cmd === 'next') skip(1);
      else if (cmd === 'prev') skip(-1);
      else if (cmd === 'seek') seekBy(arg > 0 ? 1 : -1);
      else if (cmd === 'volume') volumeBy(arg > 0 ? 1 : -1);
      else if (cmd === 'login') appCmd('login');
      else if (cmd === 'activate') appCmd('activate'); // ユーザーの操作の直後に、音を有効にする
      else if (cmd === 'lyrics') {
        lyricViewWant = null;
        lyricViewTries = 0;
        lyricAskAt = 0;
        lyricAsks = 0;
        lyricAskGap = 250;
        syncLyricsView();
      } else if (cmd === 'diag') root.postMessage({ svReactAsk: 'diag' }, root.location.origin);
    }

    /** いまの状態（画面に出す形）。 */
    function snapshot() {
      if (Date.now() - mediaAskAt > 1000) {
        mediaAskAt = Date.now();
        root.postMessage({ svMsAsk: 1 }, root.location.origin); // 実際の音声の位置を求める（診断用）
      }
      if (!appOk() && Date.now() - lastAppAsk > 2000) {
        lastAppAsk = Date.now();
        root.postMessage({ svAppAsk: 1 }, root.location.origin); // アプリのサービスの状態を、すぐ求める
      }
      const d = detect(doc, drm, waited());
      const i = d.info;
      if (d.kind === 'track') syncLyricsView();
      askLyrics(i.title);
      return {
        kind: d.kind,
        drm,
        at: Date.now(),
        source: i.source,
        service: appOk() || app.anonymous != null, // アプリのサービス（登録簿）につながっているか
        info: {
          hasTrack: i.hasTrack,
          title: i.title,
          artists: i.artists,
          cover: i.cover,
          playing: i.playing,
          positionSec: i.positionSec,
          durationSec: i.durationSec,
          volume: i.volume,
        },
        lyrics: { on: wantLyrics(), lines: lyricLines, asks: lyricAsks, dbg: lyricDbg, tries: lyricViewTries, none: lyricNone, src: lyricSrc },
        mediaDiff,
        lyricShift,
      };
    }

    return { snapshot, command };
  }

  SV.spotifyEngine = {
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
