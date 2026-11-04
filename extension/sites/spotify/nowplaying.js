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
  });

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
    const w = doc.querySelector(SEL.widget);
    return text(w && w.querySelector(SEL.title));
  }

  /** 再生バーから、いま再生中の曲の情報を読む（DOM に触るのは読むだけ）。 */
  function read(doc) {
    const w = doc.querySelector(SEL.widget);
    const title = text(w && w.querySelector(SEL.title));
    const img = w && w.querySelector(SEL.cover);
    const seek = doc.querySelector(SEL.seek);
    const max = seek ? Number(seek.max) : 0;
    const label = (doc.querySelector(SEL.playPause) || { getAttribute: () => '' }).getAttribute('aria-label') || '';
    const vol = doc.querySelector('[data-testid="volume-bar"] input[type="range"]');
    return {
      hasTrack: !!title,
      title,
      artists: text(w && w.querySelector(SEL.byline)),
      cover: img ? img.currentSrc || img.src || '' : '',
      playing: /一時停止|pause/i.test(label),
      position: text(doc.querySelector(SEL.position)),
      duration: text(doc.querySelector(SEL.duration)),
      ratio: seek && max > 0 ? Math.min(1, Math.max(0, Number(seek.value) / max)) : 0,
      volume: vol && Number(vol.max) > 0 ? Number(vol.value) / Number(vol.max) : null,
    };
  }

  /** ページから、状態を読む（drm は呼び出し側が確認した結果）。 */
  function detect(doc, drm) {
    const info = read(doc);
    const loggedOut = !!doc.querySelector(SEL.login) && !doc.querySelector(SEL.user);
    const ready = !!doc.querySelector(SEL.bar);
    return { kind: statusOf({ loggedOut, hasTrack: info.hasTrack, ready, drm }), info };
  }

  /**
   * 歌詞（サイトの歌詞表示が開いているときだけ DOM にある）。いま歌っている行は、文字色で見分ける
   * （サイトの色の変数 --lyrics-color-active の色で、普通の行（--lyrics-color-inactive）とは違うもの。クラス名のハッシュには頼らない）。
   * 返す: { lines: [表示する行（前 2・いま・次 3）], active: lines の中の位置 } か、歌詞がない・いまの行が分からないときは null。
   */
  function readLyrics(doc) {
    const nodes = Array.from(doc.querySelectorAll(SEL.lyricsLine));
    const items = nodes.map((n) => ({ text: text(n), node: n })).filter((x) => x.text);
    if (!items.length) return null;
    const win = doc.defaultView;
    const col = (n) => win.getComputedStyle(n.firstElementChild || n).color;
    const cs = win.getComputedStyle(nodes[0]);
    const norm = (c) => c.replace(/\s+/g, '').replace(/^rgba\((\d+),(\d+),(\d+),1\)$/, 'rgb($1,$2,$3)');
    const active = norm(cs.getPropertyValue('--lyrics-color-active'));
    const inactive = norm(cs.getPropertyValue('--lyrics-color-inactive'));
    let cur = -1;
    if (active && active !== inactive) items.forEach((x, i) => { if (norm(col(x.node)) === active) cur = i; });
    if (cur < 0) return null; // いまの行が分からないときは、歌詞は出さない（ずれた行を出すより、出さない）
    const from = Math.max(0, cur - 2);
    const to = Math.min(items.length, cur + 4);
    return { lines: items.slice(from, to).map((x) => x.text), active: cur - from };
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
    let el = null;
    let timer = 0;
    let toastTimer = 0;
    let openedLyrics = false; // 歌詞を出すために、こちらで歌詞ボタンを押したか（閉じるときに戻す）
    let drm = null;
    let lock = null;
    let barTimer = 0;
    let fi = 2; // ボタンの列で、フォーカスがある位置（初めは再生/一時停止）
    let lyricsSynced = false; // サイトの歌詞表示を、設定に合わせたか
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
    const click = (sel) => {
      const b = doc.querySelector(sel);
      if (b) b.click();
      return !!b;
    };

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
      if (el) acquireLock();
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

    /** サイトの歌詞表示を、設定に合わせる（歌詞は、サイトの歌詞表示が開いているときだけ DOM にある）。ボタンが現れたら 1 回だけ合わせる */
    function syncLyrics(force) {
      if (!el || (lyricsSynced && !force)) return;
      const lb = doc.querySelector(SEL.lyricsButton);
      if (!lb) return;
      lyricsSynced = true;
      const pressed = lb.getAttribute('aria-pressed') === 'true';
      if (wantLyrics() && !pressed) {
        lb.click();
        openedLyrics = true;
      } else if (!wantLyrics() && pressed && openedLyrics) {
        lb.click();
        openedLyrics = false;
      }
    }

    function paintButtons(i) {
      const bar = el.querySelector('.sv-np-controls');
      const play = bar.querySelector('[data-id="play"]');
      play.textContent = i.playing ? '⏸' : '▶';
      play.setAttribute('aria-label', i.playing ? '一時停止' : '再生');
      const ly = bar.querySelector('[data-id="lyrics"]');
      ly.textContent = '歌詞 ' + (wantLyrics() ? 'オン' : 'オフ');
      ly.setAttribute('aria-pressed', wantLyrics() ? 'true' : 'false');
    }

    function barVisible() {
      return !!el && !el.querySelector('.sv-np-controls').hidden;
    }
    function hideBar() {
      if (!el) return false;
      clearTimeout(barTimer);
      const bar = el.querySelector('.sv-np-controls');
      const was = !bar.hidden;
      bar.hidden = true;
      el.querySelector('.sv-np-hint').hidden = false;
      return was;
    }
    /** 操作されたとき、ボタンの列を出して、しばらく（5 秒）操作がなければ隠す。 */
    function showBar() {
      if (!el) return;
      const bar = el.querySelector('.sv-np-controls');
      const was = !bar.hidden;
      bar.hidden = false;
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
      const step = (box, dir) => {
        if (SV.spotify) SV.spotify.markSliders(doc);
        const b = doc.querySelector(box);
        return b ? SV.spotify.stepSlider(b, dir) : false;
      };
      if (id === 'prev') click(SEL.prev);
      else if (id === 'next') click(SEL.next);
      else if (id === 'play') click(SEL.playPause);
      else if (id === 'back') step(SEL.seekBox, -1);
      else if (id === 'fwd') step(SEL.seekBox, 1);
      else if (id === 'lyrics') {
        const v = !wantLyrics();
        if (opts && opts.onLyrics) opts.onLyrics(v);
        syncLyrics(true);
        toast('歌詞 ' + (v ? 'オン' : 'オフ'));
        refresh();
      }
    }

    function refresh() {
      if (!el) return;
      const d = detect(doc, drm);
      el.setAttribute('data-kind', d.kind);
      const trackView = d.kind === 'track';
      el.setAttribute('data-view', trackView ? 'track' : 'status');
      el.querySelector('.sv-np-hint').textContent = trackView ? 'どれかのキーで、ボタンを出す　↑ ↓ 音量' : '';
      if (!trackView) {
        hideBar();
        paintStatus(d.kind);
        return;
      }
      const i = d.info;
      el.setAttribute('data-state', i.playing ? 'playing' : 'paused');
      el.querySelector('.sv-np-state').textContent = i.playing ? '▶ 再生中' : '⏸ 一時停止';
      el.querySelector('.sv-np-title').textContent = i.title;
      el.querySelector('.sv-np-artist').textContent = i.artists;
      const cover = el.querySelector('.sv-np-cover');
      if (i.cover && cover.getAttribute('src') !== i.cover) {
        cover.setAttribute('src', i.cover);
        el.querySelector('.sv-np-bg').style.backgroundImage = 'url("' + i.cover.replace(/"/g, '%22') + '")';
      }
      cover.hidden = !i.cover;
      syncLyrics();
      paintButtons(i);
      const ly = wantLyrics() ? readLyrics(doc) : null;
      const box = el.querySelector('.sv-np-lyrics');
      box.hidden = !ly;
      if (ly) {
        const sig = ly.active + '|' + ly.lines.join('\n');
        if (box.getAttribute('data-sig') !== sig) {
          box.setAttribute('data-sig', sig);
          box.textContent = '';
          ly.lines.forEach((t, k) => box.appendChild(mk('div', 'sv-np-line' + (k === ly.active ? ' is-current' : ''), t)));
        }
      }
      el.querySelector('.sv-np-fill').style.width = Math.round(i.ratio * 1000) / 10 + '%';
      el.querySelector('.sv-np-pos').textContent = i.position;
      el.querySelector('.sv-np-dur').textContent = i.duration;
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
      controls.hidden = true;
      controls.setAttribute('role', 'toolbar');
      BUTTONS.forEach((b) => {
        const btn = mk('button', 'sv-np-btn', b.text);
        btn.type = 'button';
        btn.setAttribute('data-id', b.id);
        btn.setAttribute('aria-label', b.label);
        btn.tabIndex = -1;
        controls.appendChild(btn);
      });
      el.append(mk('div', 'sv-np-bg'), track, status, toastEl, controls, mk('div', 'sv-np-hint'));
      (doc.body || doc.documentElement).appendChild(el);
      doc.documentElement.classList.add('sv-np-open');
      if (SV.spotify) SV.spotify.markSliders(doc);
      refresh();
      acquireLock();
      timer = setInterval(refresh, 400);
    }

    function close() {
      if (!el) return;
      clearInterval(timer);
      clearTimeout(toastTimer);
      clearTimeout(barTimer);
      lyricsSynced = false;
      el.remove();
      el = null;
      doc.documentElement.classList.remove('sv-np-open');
      if (lock) {
        lock.release().catch(() => {});
        lock = null;
      }
      if (openedLyrics) {
        const lb = doc.querySelector(SEL.lyricsButton);
        if (lb && lb.getAttribute('aria-pressed') === 'true') lb.click();
        openedLyrics = false;
      }
    }

    /** 開いている間の、決定・方向のキー（action は SV.keys の論理名）。処理したら true。 */
    function handleAction(action) {
      if (!el) return false;
      const kind = el.getAttribute('data-kind');
      if (kind !== 'track') {
        if (action === 'OK' && kind === 'loggedOut') click(SEL.login); // 曲がないときは、ほかの操作はない
        return action === 'OK' && kind === 'loggedOut';
      }
      // 再生・次・前のキー（リモコンのメディアキー）は、ボタンを出さずにそのまま
      if (action === 'PLAY_PAUSE' || action === 'PLAY' || action === 'PAUSE') click(SEL.playPause);
      else if (action === 'NEXT') click(SEL.next);
      else if (action === 'PREV') click(SEL.prev);
      else if (action === 'SEEK_BACK') activate('back');
      else if (action === 'SEEK_FWD') activate('fwd');
      else if (action === 'UP' || action === 'DOWN') {
        // 音量は、ボタンの列が出ていなくても、すぐ動かす
        if (SV.spotify) SV.spotify.markSliders(doc);
        const vb = doc.querySelector(SEL.volumeBox);
        if (vb) SV.spotify.stepSlider(vb, action === 'UP' ? 1 : -1);
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

    return { open, close, refresh, handleAction, hideBar, isOpen: () => !!el, status: () => detect(doc, drm) };
  }

  SV.spotifyNp = { SEL, STATUS_TEXT, statusOf, trackTitle, read, detect, readLyrics, checkWidevine, create };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyNp;
})(typeof self !== 'undefined' ? self : globalThis);
