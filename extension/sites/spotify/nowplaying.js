/*
 * Spotify: 再生中の画面（テレビに出す専用の画面）。スマホから再生して、テレビには「いま何が流れているか」を大きく出す使い方が主。
 * 画面は拡張が作る（Spotify 自身の「再生中ビュー」は、サイトの内側の作りに依存するので使わない）。読み取り・操作は、再生バーの data-testid だけ。
 *   曲があるとき: ジャケット・曲名・アーティスト・歌詞・再生位置。操作されたとき（← → OK）にボタンの列（前・10 秒戻る・再生/一時停止・10 秒進む・次・歌詞）を出し、5 秒で隠す。↑ ↓ は音量。歌詞は設定 spotify.lyrics（ボタンでも切り替え）。
 *   曲がないとき（状態の画面）: 読み込み中／ログインしていない／再生できない（Widevine がない）／スマホから再生するのを待っている、を、理由とやることつきで出す。
 *   開く: 再生バーのジャケット（cover-art-button）で OK／黄色キー／スマホから再生が始まったとき／待機の設定のとき（読み込み時）
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

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
  let extraRoots = () => []; // 取り外した本来の画面（DocumentFragment）。歌詞ボタンを押すために、探す範囲に加える

  function find(doc, key) {
    let c = found.get(doc);
    if (!c) found.set(doc, (c = {}));
    const hit = c[key];
    if (hit && (hit.isConnected || extraRoots().some((r) => r.contains && r.contains(hit)))) return hit;
    const roots = [doc].concat(extraRoots());
    let el = null;
    for (const r of roots) {
      el = r.querySelector(SEL[key]);
      if (el) break;
    }
    if (el) {
      c[key] = el;
      return el;
    }
    // 目印がないときの探し直し（全部のボタンを調べるので、3 秒に 1 回まで）
    const now = Date.now();
    if (now - (c['miss:' + key] || 0) < 3000) return null;
    c['miss:' + key] = now;
    if (key === 'bar') el = Array.from(doc.querySelectorAll('footer, aside')).find((x) => x.querySelector('input[type="range"]')) || null;
    else if (LABEL[key]) {
      const scope = key === 'login' ? 'header, nav, [role="banner"]' : null; // ログインは上のバーにある（ページ全体は調べない）
      const bases = scope ? Array.from(doc.querySelectorAll(scope)) : [find(doc, 'bar') || doc].concat(extraRoots());
      for (const b of bases.flatMap((r) => Array.from(r.querySelectorAll('button, [role="button"], a')))) {
        const name = (b.getAttribute('aria-label') || (key === 'login' ? text(b) : '')).trim();
        if (name && LABEL[key].test(name)) {
          el = b;
          break;
        }
      }
    }
    if (el) c[key] = el;
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

  const bridge = { actions: new Set(), pos: null, vol: null, onChange: null };
  /** 登録された処理があれば呼ぶ（OS のメディアキーが押されたのと同じ）。呼べたら true。 */
  function callSession(action, details) {
    if (!bridge.actions.has(action) || typeof root.postMessage !== 'function') return false;
    root.postMessage({ svMsCall: action, details: details || {} }, root.location.origin);
    return true;
  }
  /** setPositionState から、いまの再生位置（秒）。再生中は、時間の経過ぶん進める。なければ null。 */
  function sessionPosition(playing) {
    const p = bridge.pos;
    if (!p || !(p.duration > 0)) return null;
    const t = p.position + (playing ? ((Date.now() - p.at) / 1000) * p.rate : 0);
    return { position: Math.min(p.duration, Math.max(0, t)), duration: p.duration };
  }
  if (typeof root.addEventListener === 'function' && root.location) {
    root.addEventListener('message', (e) => {
      if (e.source !== root || !e.data || e.data.svMs !== 'caps') return;
      bridge.actions = new Set(e.data.actions || []);
      bridge.pos = e.data.pos || null;
      bridge.vol = typeof e.data.vol === 'number' ? e.data.vol : null;
      if (bridge.onChange) bridge.onChange();
    });
    root.postMessage({ svMsHello: 1 }, root.location.origin);
  }

  /** 秒 → m:ss（サイトの表示と同じ形）。 */
  function fmt(sec) {
    const t = Math.max(0, Math.floor(sec));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /**
   * いまの状態（画面の種類）。純粋な判定（DOM に触らない）。
   *   loggedOut: ログインしていない（曲があっても、再生できない）／loading: 読み込み中／track: 曲がある／noDrm: 再生に必要な保護機能がない／idle: スマホから再生するのを待っている
   * drm: true / false / null（まだ確認中）。
   */
  function statusOf(i) {
    if (i.loggedOut) return 'loggedOut';
    if (i.hasTrack) return 'track';
    if (!i.ready) return 'loading';
    if (i.drm === false) return 'noDrm';
    return 'idle';
  }

  /** 状態の画面に出す文言。 */
  const STATUS_TEXT = Object.freeze({
    loading: { icon: '…', head: 'Spotify を読み込んでいます', lines: [], hint: '' },
    loggedOut: {
      icon: '🔒',
      head: 'Spotify にログインしていません',
      lines: ['ログインすると、スマホの Spotify から、このテレビで再生できます', 'ログイン画面は文字入力が必要です。キーボードをつなぐか、パソコンから操作してください'],
      hint: 'OK でログイン画面を開く',
    },
    noDrm: {
      icon: '🔇',
      head: 'このブラウザでは、音楽を再生できません',
      lines: ['再生に必要な保護機能（Widevine）が、このブラウザにありません', 'Google Chrome など、Widevine のあるブラウザで開いてください'],
      hint: '',
    },
    idle: {
      icon: '📱',
      head: 'スマホの Spotify から、再生してください',
      lines: ['① スマホで Spotify を開いて、曲を再生する', '② 再生画面の下の「デバイスに接続」を押す', '③ 一覧から、「Web Player」と書かれたこのブラウザを選ぶ'],
      hint: '戻る　Spotify の画面で、曲を探す',
    },
  });

  /** いま再生中の曲名だけ（軽い読み取り。曲が変わったかの確認用）。 */
  function trackTitle(doc) {
    const m = session(doc);
    if (m) return m.title;
    const w = doc.querySelector(SEL.widget);
    return text(w && w.querySelector(SEL.title));
  }

  /**
   * いま再生中の曲の情報を読む（DOM に触るのは読むだけ）。優先順は、変わりにくい順:
   *   曲の情報: メディアセッション → 画面の目印    再生状態: メディアセッション → 音声 → ボタンの表示名
   *   再生位置: メディアセッションの再生位置 → 音声（audio/video）→ 画面（範囲入力・時間の表示）
   */
  function read(doc) {
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
    const ready = !!find(doc, 'bar') || !!media(doc) || !!session(doc) || !!waited;
    return { kind: statusOf({ loggedOut, hasTrack: info.hasTrack, ready, drm }), info };
  }

  /**
   * 歌詞。Spotify の React の部品の木から、行の文字と開始時刻を読む（react-main.js。画面の要素・色には頼らない）。
   * いまの行は、再生位置（メディアセッション）と開始時刻を比べて決める。
   *   lines: [{ text, start }]（start は ミリ秒。曲の長さより小さい値ばかりなら、秒とみなす）  positionSec / durationSec: 秒
   * 返す: { lines: [文字], cur: いまの行の位置（まだ最初の行の前なら -1） }。時刻が付いていない（順に増えない）歌詞は null（そのときは歌詞を出さない）。
   */
  function lyricsAt(lines, positionSec, durationSec, hint) {
    if (!lines || !lines.length) return null;
    const starts = lines.map((l) => l.start);
    if (starts.some((t) => !Number.isFinite(t))) return null;
    for (let i = 1; i < starts.length; i++) if (starts[i] < starts[i - 1]) return null;
    if (starts[starts.length - 1] <= 0) return null; // 時刻のない歌詞
    const max = starts[starts.length - 1];
    const unit = durationSec > 0 && max <= durationSec + 5 ? 1 : 1000; // 秒か、ミリ秒か
    const t = positionSec == null ? 0 : positionSec * unit;
    // いまの行 = 開始時刻が t 以下の、最後の行。前回の位置から探す（ほとんど同じか次の行）
    let cur = Math.max(-1, Math.min(starts.length - 1, hint == null ? -1 : hint));
    while (cur >= 0 && starts[cur] > t) cur--;
    while (cur + 1 < starts.length && starts[cur + 1] <= t) cur++;
    return { lines: lines.map((l) => l.text), cur };
  }

  /** 再生に必要な保護機能（Widevine）が使えるか。 */
  function checkWidevine(win) {
    const n = win && win.navigator;
    if (!n || typeof n.requestMediaKeySystemAccess !== 'function') return Promise.resolve(false);
    return n
      .requestMediaKeySystemAccess('com.widevine.alpha', [{ initDataTypes: ['cenc'], audioCapabilities: [{ contentType: 'audio/mp4;codecs="mp4a.40.2"' }] }])
      .then(() => true, () => false);
  }

  /** 画面の部品を作る。 */
  function create(opts) {
    const doc = (opts && opts.document) || document;
    const win = doc.defaultView;
    const createdAt = Date.now();
    let el = null;
    let timer = 0;
    let toastTimer = 0;
    let barTimer = 0;
    let openedLyrics = false; // 歌詞を出すために、こちらで歌詞ボタンを押したか（閉じるときに戻す）
    let drm = null;
    let lock = null;
    let fi = 2; // ボタンの列で、フォーカスがある位置（初めは再生/一時停止）
    let lastSyncAt = 0;
    let lyricHint = -1;
    let lyricSig = '';
    let lyricCur = -2;
    let lyricLines = []; // react-main.js から受け取った歌詞の行 [{ text, start }]
    let lyricTitle = '';
    let lyricTitleAt = 0;
    let lyricOldSig = '';
    let lyricAskAt = 0;
    let lastRatio = 0;
    const waited = () => Date.now() - createdAt > 8000; // 目印が変わっても、「読み込み中」のままにしない
    const wantLyrics = () => (opts && opts.getLyrics ? !!opts.getLyrics() : true);
    const BUTTONS = [
      { id: 'prev', text: '⏮', label: '前の曲' },
      { id: 'back', text: '−10秒', label: '10 秒戻る' },
      { id: 'play', text: '⏯', label: '再生/一時停止' },
      { id: 'fwd', text: '+10秒', label: '10 秒進む' },
      { id: 'next', text: '⏭', label: '次の曲' },
      { id: 'lyrics', text: '歌詞', label: '歌詞の表示' },
    ];

    const mk = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };
    const click = (key) => {
      const b = find(doc, key);
      if (b) b.click();
      return !!b;
    };
    // 値が変わったときだけ書く（同じ文字を書き直すと、画面の再計算が毎回走って重い）
    const put = (node, v) => {
      if (node.textContent !== v) node.textContent = v;
    };

    /**
     * 操作は、変わりにくい順に試す: メディアセッションのハンドラ（OS のメディアキーと同じ）→ 画面のボタン・範囲入力 → 音声を直接。
     */
    function playPause() {
      const playing = read(doc).playing;
      if (callSession(playing ? 'pause' : 'play')) return;
      click('playPause');
    }
    function skip(dir) {
      if (callSession(dir > 0 ? 'nexttrack' : 'previoustrack')) return;
      click(dir > 0 ? 'next' : 'prev');
    }
    /** 再生位置を 10 秒動かす。 */
    function seekBy(dir) {
      const i = read(doc);
      if (i.positionSec != null && callSession('seekto', { seekTime: Math.min(i.durationSec, Math.max(0, i.positionSec + dir * 10)) })) return;
      if (callSession(dir > 0 ? 'seekforward' : 'seekbackward', { seekOffset: 10 })) return;
      stepRange('seek', dir);
    }
    /** 音量を 10% 動かす（メディアセッションに音量はないので、範囲入力 → 音声を直接）。 */
    function volumeBy(dir) {
      stepRange('volume', dir);
    }

    /** メディアセッションで、再生・一時停止・前・次・シークを操作できるか（本来の画面の要素を取り外してよいかの条件）。 */
    const sessionReady = () => ['play', 'pause', 'nexttrack', 'previoustrack'].every((a) => bridge.actions.has(a)) && (bridge.actions.has('seekto') || (bridge.actions.has('seekforward') && bridge.actions.has('seekbackward')));

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

    // 保護機能の確認は 1 回だけ（結果は画面に反映する）
    (opts && opts.checkDrm ? opts.checkDrm() : checkWidevine(win)).then((ok) => {
      drm = !!ok;
      if (el) refresh();
    });

    /** 画面を点けたままにする（テレビの画面が消えないように）。画面が見えなくなると外れるので、見えたら取り直す。 */
    async function acquireLock() {
      try {
        if (!el || lock || !win.navigator.wakeLock || doc.visibilityState !== 'visible') return;
        lock = await win.navigator.wakeLock.request('screen');
        lock.addEventListener('release', () => {
          lock = null;
        });
      } catch (e) {
        /* 許可されない環境では何もしない */
      }
    }
    doc.addEventListener('visibilitychange', () => {
      if (!el) return;
      acquireLock();
      refresh();
    });

    function toast(msg) {
      if (!el) return;
      const t = el.querySelector('.sv-np-toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        t.hidden = true;
      }, 1500);
    }

    function paintStatus(kind) {
      const t = STATUS_TEXT[kind];
      const box = el.querySelector('.sv-np-status');
      box.querySelector('.sv-np-s-icon').textContent = t.icon;
      box.querySelector('.sv-np-s-head').textContent = t.head;
      const lines = box.querySelector('.sv-np-s-lines');
      lines.textContent = '';
      t.lines.forEach((l) => lines.appendChild(mk('div', 'sv-np-s-line', l)));
      box.querySelector('.sv-np-s-hint').textContent = t.hint;
    }

    /** サイトの歌詞表示を、設定に合わせる（歌詞は、サイトの歌詞表示が開いているときだけ DOM にある）。画面が見えないので、ボタンを押すのは拡張だけ。押しすぎないよう、1.5 秒に 1 回まで */
    function syncLyrics() {
      const now = Date.now();
      if (!el || now - lastSyncAt < 1500) return;
      const lb = find(doc, 'lyricsButton');
      if (!lb) return; // 本来の画面の要素が取り外されているとき（歌詞を出さない）は、ない
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

    const sigOf = (L) => L.length + '\n' + (L[0] ? L[0].text : '') + '\n' + (L.length ? L[L.length - 1].text : '');
    win.addEventListener('message', (e) => {
      if (e.source !== win || !e.data || e.data.svReact !== 'lyrics') return;
      const L = Array.isArray(e.data.lines) ? e.data.lines : [];
      // 曲が変わった直後は、前の曲の歌詞がまだ部品の木に残っている。違う歌詞になるまで（または 5 秒たつまで）、新しい曲の歌詞とみなさない
      if (L.length && sigOf(L) === lyricOldSig && Date.now() - lyricTitleAt < 5000) return;
      lyricLines = L;
    });

    /**
     * 歌詞。React の部品の木から読んだ行（react-main.js）と、再生位置から、いまの行を決める。全部の行を並べて、
     * いまの行が真ん中に来るよう、列ごと滑らかに動かす（行の作り直しは、曲が変わったときだけ）。
     */
    function paintLyrics(i) {
      const box = el.querySelector('.sv-np-lyrics');
      const now = Date.now();
      if (i.title !== lyricTitle) {
        lyricTitle = i.title;
        lyricTitleAt = now;
        lyricOldSig = sigOf(lyricLines);
        lyricLines = [];
        lyricHint = -1;
        lyricAskAt = 0;
      }
      if (wantLyrics() && !lyricLines.length && now - lyricAskAt > 1500) {
        lyricAskAt = now;
        win.postMessage({ svReactAsk: 'lyrics' }, win.location.origin); // 歌詞の画面が作られていれば、行が返ってくる
      }
      const ly = wantLyrics() ? lyricsAt(lyricLines, i.positionSec, i.durationSec, lyricHint) : null;
      box.hidden = !ly;
      if (!ly) return;
      lyricHint = ly.cur;
      const track = box.firstChild;
      const L = ly.lines;
      const sig = L.length + '\n' + L[0] + '\n' + L[L.length >> 1] + '\n' + L[L.length - 1];
      if (sig !== lyricSig) {
        lyricSig = sig;
        lyricCur = -2;
        track.textContent = '';
        L.forEach((t) => track.appendChild(mk('div', 'sv-np-line', t)));
        track.style.transition = 'none'; // 曲が変わったときは、滑らせずに合わせる
        track.style.setProperty('--cur', String(Math.max(0, ly.cur)));
        void track.offsetWidth;
        track.style.transition = '';
      }
      if (ly.cur !== lyricCur) {
        const kids = track.children;
        if (kids[lyricCur]) kids[lyricCur].classList.remove('is-current');
        if (kids[ly.cur]) kids[ly.cur].classList.add('is-current');
        track.style.setProperty('--cur', String(Math.max(0, ly.cur)));
        lyricCur = ly.cur;
      }
    }

    function paintButtons(i) {
      const bar = el.querySelector('.sv-np-controls');
      const play = bar.querySelector('[data-id="play"]');
      put(play, i.playing ? '⏸' : '▶');
      play.setAttribute('aria-label', i.playing ? '一時停止' : '再生');
      const ly = bar.querySelector('[data-id="lyrics"]');
      put(ly, '歌詞 ' + (wantLyrics() ? 'オン' : 'オフ'));
      ly.setAttribute('aria-pressed', wantLyrics() ? 'true' : 'false');
    }

    function barVisible() {
      return !!el && el.querySelector('.sv-np-controls').hasAttribute('data-show');
    }
    function hideBar() {
      if (!el) return false;
      clearTimeout(barTimer);
      const bar = el.querySelector('.sv-np-controls');
      const was = bar.hasAttribute('data-show');
      bar.removeAttribute('data-show');
      el.querySelector('.sv-np-hint').hidden = false;
      return was;
    }
    /** 操作されたとき、ボタンの列を出して、しばらく（5 秒）操作がなければ隠す。 */
    function showBar() {
      if (!el) return;
      const bar = el.querySelector('.sv-np-controls');
      const was = bar.hasAttribute('data-show');
      bar.setAttribute('data-show', '1');
      el.querySelector('.sv-np-hint').hidden = true;
      if (!was) focusButton(fi);
      clearTimeout(barTimer);
      barTimer = setTimeout(hideBar, 5000);
    }
    function focusButton(k) {
      fi = (k + BUTTONS.length) % BUTTONS.length;
      const b = el.querySelector('.sv-np-controls [data-id="' + BUTTONS[fi].id + '"]');
      if (b) b.focus({ preventScroll: true });
    }
    function activate(id) {
      if (id === 'prev') skip(-1);
      else if (id === 'next') skip(1);
      else if (id === 'play') playPause();
      else if (id === 'back') seekBy(-1);
      else if (id === 'fwd') seekBy(1);
      else if (id === 'lyrics') {
        const v = !wantLyrics();
        if (opts && opts.onLyrics) opts.onLyrics(v);
        lastSyncAt = 0;
        syncLyrics();
        toast('歌詞 ' + (v ? 'オン' : 'オフ'));
        lyricAskAt = 0;
        refresh();
      }
    }

    function refresh() {
      if (!el) return;
      const d = detect(doc, drm, waited());
      el.setAttribute('data-kind', d.kind);
      const trackView = d.kind === 'track';
      el.setAttribute('data-view', trackView ? 'track' : 'status');
      put(el.querySelector('.sv-np-hint'), trackView ? 'どれかのキーで、ボタンを出す　↑ ↓ 音量' : '');
      if (!trackView) {
        hideBar();
        paintStatus(d.kind);
        return;
      }
      const i = d.info;
      el.setAttribute('data-state', i.playing ? 'playing' : 'paused');
      put(el.querySelector('.sv-np-state'), i.playing ? '▶ 再生中' : '⏸ 一時停止');
      put(el.querySelector('.sv-np-title'), i.title);
      put(el.querySelector('.sv-np-artist'), i.artists);
      const cover = el.querySelector('.sv-np-cover');
      if (i.cover && cover.getAttribute('src') !== i.cover) {
        cover.setAttribute('src', i.cover);
        el.querySelector('.sv-np-bg').style.backgroundImage = 'url("' + i.cover.replace(/"/g, '%22') + '")';
      }
      cover.hidden = !i.cover;
      syncLyrics();
      paintButtons(i);
      paintLyrics(i);
      // 再生位置: 動かすのは transform だけ（レイアウトが走らない）。再生中の小さな進みは滑らかに、大きな飛び（シーク・曲の変わり目）は一気に
      const fill = el.querySelector('.sv-np-fill');
      const r = Math.round(i.ratio * 10000) / 10000;
      if (fill.getAttribute('data-r') !== String(r)) {
        fill.setAttribute('data-r', String(r));
        fill.style.transition = i.playing && Math.abs(r - lastRatio) < 0.03 ? 'transform 0.3s linear' : 'none';
        fill.style.transform = 'scaleX(' + r + ')';
        lastRatio = r;
      }
      put(el.querySelector('.sv-np-pos'), i.position);
      put(el.querySelector('.sv-np-dur'), i.duration);
    }

    function open() {
      if (el) return;
      el = mk('div');
      el.id = 'sv-np';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '再生中');
      const track = mk('div', 'sv-np-body');
      const info = mk('div', 'sv-np-info');
      const bar = mk('div', 'sv-np-bar');
      bar.appendChild(mk('div', 'sv-np-fill'));
      const times = mk('div', 'sv-np-times');
      times.append(mk('span', 'sv-np-pos'), mk('span', 'sv-np-dur'));
      const lyrics = mk('div', 'sv-np-lyrics');
      lyrics.appendChild(mk('div', 'sv-np-ly-track'));
      lyrics.hidden = true;
      info.append(mk('div', 'sv-np-state'), mk('h1', 'sv-np-title'), mk('div', 'sv-np-artist'), lyrics, bar, times);
      const cover = mk('img', 'sv-np-cover');
      cover.alt = '';
      track.append(cover, info);
      const status = mk('div', 'sv-np-status');
      status.append(mk('div', 'sv-np-s-icon'), mk('h1', 'sv-np-s-head'), mk('div', 'sv-np-s-lines'), mk('div', 'sv-np-s-hint'));
      const toastEl = mk('div', 'sv-np-toast');
      toastEl.hidden = true;
      const controls = mk('div', 'sv-np-controls');
      controls.setAttribute('role', 'toolbar');
      BUTTONS.forEach((b) => {
        const btn = mk('button', 'sv-np-btn', b.text);
        btn.type = 'button';
        btn.setAttribute('data-id', b.id);
        btn.setAttribute('aria-label', b.label);
        btn.tabIndex = -1;
        controls.appendChild(btn);
      });
      el.append(mk('div', 'sv-np-bg'), track, status, toastEl, controls, mk('div', 'sv-np-hint'), mk('div', 'sv-np-ver', 'SofaView v' + (SV.VERSION || '')));
      (doc.body || doc.documentElement).appendChild(el);
      doc.documentElement.classList.add('sv-np-open');
      refresh();
      acquireLock();
      timer = setInterval(() => {
        if (doc.visibilityState === 'visible') refresh(); // 見えていないときは、描画を更新しない
      }, 250);
    }

    function close() {
      if (!el) return;
      clearInterval(timer);
      clearTimeout(toastTimer);
      clearTimeout(barTimer);
      lyricSig = '';
      lyricCur = -2;
      el.remove();
      el = null;
      doc.documentElement.classList.remove('sv-np-open');
      if (lock) {
        lock.release().catch(() => {});
        lock = null;
      }
      if (openedLyrics) {
        const lb = find(doc, 'lyricsButton');
        if (lb && lb.getAttribute('aria-pressed') === 'true') lb.click();
        openedLyrics = false;
      }
    }

    /** 開いている間の、決定・方向のキー（action は SV.keys の論理名）。処理したら true。 */
    function handleAction(action) {
      if (!el) return false;
      const kind = el.getAttribute('data-kind');
      if (kind !== 'track') {
        if (action === 'OK' && kind === 'loggedOut') {
          click('login'); // 曲がないときは、ほかの操作はない
          return true;
        }
        return false;
      }
      // 再生・次・前のキー（リモコンのメディアキー）は、ボタンを出さずにそのまま
      if (action === 'PLAY_PAUSE' || action === 'PLAY' || action === 'PAUSE') playPause();
      else if (action === 'NEXT') skip(1);
      else if (action === 'PREV') skip(-1);
      else if (action === 'SEEK_BACK') activate('back');
      else if (action === 'SEEK_FWD') activate('fwd');
      else if (action === 'UP' || action === 'DOWN') {
        // 音量は、ボタンの列が出ていなくても、すぐ動かす
        volumeBy(action === 'UP' ? 1 : -1);
        setTimeout(() => {
          const v = read(doc).volume;
          if (v != null) toast('音量 ' + Math.round(v * 100) + '%');
        }, 150);
      } else if (action === 'LEFT' || action === 'RIGHT' || action === 'OK') {
        // 最初の 1 回は、ボタンの列を出すだけ（うっかり押して止まらないように）
        if (!barVisible()) showBar();
        else {
          showBar();
          if (action === 'OK') activate(BUTTONS[fi].id);
          else focusButton(fi + (action === 'RIGHT' ? 1 : -1));
        }
      } else return false;
      setTimeout(refresh, 150);
      return true;
    }

    return { open, close, refresh, handleAction, hideBar, sessionReady, isOpen: () => !!el, status: () => detect(doc, drm, waited()) };
  }

  SV.spotifyNp = { setExtraRoots: (fn) => { extraRoots = fn; }, lyricsAt, onSessionChange: (fn) => { bridge.onChange = fn; }, SEL, LABEL, fmt, STATUS_TEXT, statusOf, trackTitle, read, detect, checkWidevine, find, create };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyNp;
})(typeof self !== 'undefined' ? self : globalThis);
