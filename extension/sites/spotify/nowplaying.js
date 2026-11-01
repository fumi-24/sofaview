/*
 * Spotify: 再生中の大きな画面（リモコンで操作する用）。ジャケット・曲名・アーティスト・歌詞・再生位置と、操作の列を大きく出す。
 * 画面は拡張が作る（Spotify 自身の「再生中ビュー」は、サイトの内側の作りに依存するので使わない）。読み取り・操作は、再生バーの data-testid だけ。
 *   開く: 再生バーのジャケット（cover-art-button）で OK／黄色キー／スマホから再生が始まったとき（キャスト待機）
 *   操作: 3 段（再生位置・ボタンの列・音量）。↑ ↓ で段を移り、← → は、再生位置は 10 秒・ボタンの列は移動・音量は 10%。OK で押す。戻る・黄色で閉じる
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
    repeat: '[data-testid="control-button-repeat"]',
    shuffle: '[data-testid="general-controls"] button:not([data-testid])', // 前の曲の左の、テスト用の印がないボタン
    like: '[data-testid="now-playing-widget-v2"] button[aria-checked], [data-testid="now-playing-widget"] button[aria-checked]',
    seek: '[data-testid="playback-progressbar"] input[type="range"]',
    lyricsButton: '[data-testid="lyrics-button"]',
    lyricsLine: '[data-testid="lyrics-line"]',
    volumeBox: '[data-sv-slider="volume"]',
    seekBox: '[data-sv-slider="seek"]',
  });

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const SLEEP_STEPS = Object.freeze([0, 15, 30, 60, 90]); // 分。0 = オフ

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
    const checked = (sel) => {
      const b = doc.querySelector(sel);
      return !!b && b.getAttribute('aria-checked') === 'true';
    };
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
      liked: checked(SEL.like),
      repeat: checked(SEL.repeat),
    };
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

  /** 画面の部品を作る。 */
  function create(opts) {
    const doc = (opts && opts.document) || document;
    let el = null;
    let timer = 0;
    let openedLyrics = false; // 歌詞を出すために、こちらで歌詞ボタンを押したか（閉じるときに戻す）
    let showLyrics = true;
    let row = 1; // 0 = 再生位置・1 = ボタンの列・2 = 音量
    let col = 2; // ボタンの列の位置（初期は再生/一時停止）
    let sleepIdx = 0;
    let sleepTimer = 0;
    let sleepUntil = 0;
    let toastTimer = 0;

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

    // ボタンの列。state(info) は、押された状態の見た目（true で強調）。label は、文字（画面に出る）
    const BUTTONS = [
      { id: 'shuffle', icon: '⇄', label: 'シャッフル', run: () => click(SEL.shuffle) },
      { id: 'prev', icon: '⏮', label: '前の曲', run: () => click(SEL.prev) },
      { id: 'play', icon: '▶', label: '再生', run: () => click(SEL.playPause), icons: (i) => (i.playing ? '⏸' : '▶'), labelOf: (i) => (i.playing ? '一時停止' : '再生') },
      { id: 'next', icon: '⏭', label: '次の曲', run: () => click(SEL.next) },
      { id: 'repeat', icon: '↻', label: 'リピート', run: () => click(SEL.repeat), state: (i) => i.repeat },
      { id: 'like', icon: '♡', label: 'お気に入り', run: () => click(SEL.like), state: (i) => i.liked, icons: (i) => (i.liked ? '♥' : '♡') },
      { id: 'lyrics', icon: '歌', label: '歌詞', run: () => { showLyrics = !showLyrics; refresh(); }, state: () => showLyrics },
      { id: 'sleep', icon: '⏲', label: 'スリープ', run: () => cycleSleep(), state: () => sleepIdx > 0, labelOf: () => (sleepIdx > 0 ? 'スリープ ' + SLEEP_STEPS[sleepIdx] + ' 分' : 'スリープ') },
    ];

    function toast(msg) {
      if (!el) return;
      const t = el.querySelector('.sv-np-toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        t.hidden = true;
      }, 2500);
    }

    /** スリープタイマー: オフ → 15 → 30 → 60 → 90 分 → オフ。時間が来たら、再生中なら一時停止する。 */
    function cycleSleep() {
      sleepIdx = (sleepIdx + 1) % SLEEP_STEPS.length;
      clearTimeout(sleepTimer);
      sleepUntil = 0;
      if (sleepIdx > 0) {
        sleepUntil = Date.now() + SLEEP_STEPS[sleepIdx] * 60000;
        sleepTimer = setTimeout(() => {
          sleepIdx = 0;
          sleepUntil = 0;
          if (read(doc).playing) click(SEL.playPause);
          toast('スリープタイマー: 一時停止しました');
          refresh();
        }, SLEEP_STEPS[sleepIdx] * 60000);
        toast('スリープタイマー: ' + SLEEP_STEPS[sleepIdx] + ' 分後に一時停止');
      } else {
        toast('スリープタイマー: オフ');
      }
      refresh();
    }

    function paintFocus() {
      if (!el) return;
      const bar = el.querySelector('.sv-np-bar');
      const vol = el.querySelector('.sv-np-vol');
      const btns = el.querySelectorAll('.sv-np-btn');
      const target = row === 0 ? bar : row === 2 ? vol : btns[col];
      if (target && doc.activeElement !== target) target.focus({ preventScroll: true });
    }

    function refresh() {
      if (!el) return;
      const i = read(doc);
      el.setAttribute('data-state', i.hasTrack ? (i.playing ? 'playing' : 'paused') : 'empty');
      el.querySelector('.sv-np-state').textContent = i.hasTrack ? (i.playing ? '▶ 再生中' : '⏸ 一時停止') : '';
      el.querySelector('.sv-np-title').textContent = i.hasTrack ? i.title : '再生している曲がありません';
      el.querySelector('.sv-np-artist').textContent = i.hasTrack ? i.artists : 'スマホの Spotify から送るか、曲を選んで再生してください';
      const cover = el.querySelector('.sv-np-cover');
      if (i.cover && cover.getAttribute('src') !== i.cover) {
        cover.setAttribute('src', i.cover);
        el.querySelector('.sv-np-bg').style.backgroundImage = 'url("' + i.cover.replace(/"/g, '%22') + '")';
      }
      cover.hidden = !i.cover;
      const ly = showLyrics ? readLyrics(doc) : null;
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
      el.querySelector('.sv-np-vol-fill').style.width = (i.volume == null ? 0 : Math.round(i.volume * 100)) + '%';
      el.querySelector('.sv-np-vol-text').textContent = i.volume == null ? '' : Math.round(i.volume * 100) + '%';
      el.querySelectorAll('.sv-np-btn').forEach((b, k) => {
        const d = BUTTONS[k];
        b.querySelector('.sv-np-icon').textContent = d.icons ? d.icons(i) : d.icon;
        b.querySelector('.sv-np-cap').textContent = d.labelOf ? d.labelOf(i) : d.label;
        b.setAttribute('aria-pressed', d.state ? String(!!d.state(i)) : 'false');
      });
    }

    function open() {
      if (el) return;
      row = 1;
      col = 2;
      el = mk('div');
      el.id = 'sv-np';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '再生中');
      const body = mk('div', 'sv-np-body');
      const info = mk('div', 'sv-np-info');
      const bar = mk('div', 'sv-np-bar');
      bar.tabIndex = 0;
      bar.setAttribute('aria-label', '再生位置');
      bar.appendChild(mk('div', 'sv-np-fill'));
      const times = mk('div', 'sv-np-times');
      times.append(mk('span', 'sv-np-pos'), mk('span', 'sv-np-dur'));
      const lyrics = mk('div', 'sv-np-lyrics');
      lyrics.hidden = true;
      const btns = mk('div', 'sv-np-btns');
      BUTTONS.forEach((d, k) => {
        const b = mk('button', 'sv-np-btn');
        b.type = 'button';
        b.setAttribute('data-id', d.id);
        b.append(mk('span', 'sv-np-icon', d.icon), mk('span', 'sv-np-cap', d.label));
        b.addEventListener('focus', () => {
          row = 1;
          col = k;
        });
        btns.appendChild(b);
      });
      const vol = mk('div', 'sv-np-vol');
      vol.tabIndex = 0;
      vol.setAttribute('aria-label', '音量');
      vol.append(mk('span', 'sv-np-vol-label', '音量'), (() => { const t = mk('div', 'sv-np-vol-track'); t.appendChild(mk('div', 'sv-np-vol-fill')); return t; })(), mk('span', 'sv-np-vol-text'));
      const toastEl = mk('div', 'sv-np-toast');
      toastEl.hidden = true;
      info.append(mk('div', 'sv-np-state'), mk('h1', 'sv-np-title'), mk('div', 'sv-np-artist'), lyrics, bar, times, btns, vol, toastEl, mk('div', 'sv-np-hint', '↑ ↓ 段を移る　← → 動かす　OK 押す　戻る 閉じる'));
      const cover = mk('img', 'sv-np-cover');
      cover.alt = '';
      body.append(cover, info);
      el.append(mk('div', 'sv-np-bg'), body);
      (doc.body || doc.documentElement).appendChild(el);
      doc.documentElement.classList.add('sv-np-open');
      // 歌詞は、サイトの歌詞表示が開いているときだけ DOM にある。閉じていれば、開く（閉じるときに戻す）
      const lb = doc.querySelector(SEL.lyricsButton);
      if (lb && lb.getAttribute('aria-pressed') === 'false') {
        lb.click();
        openedLyrics = true;
      }
      if (SV.spotify) SV.spotify.markSliders(doc);
      refresh();
      paintFocus();
      timer = setInterval(refresh, 400);
    }

    function close() {
      if (!el) return;
      clearInterval(timer);
      clearTimeout(toastTimer);
      el.remove();
      el = null;
      doc.documentElement.classList.remove('sv-np-open');
      if (openedLyrics) {
        const lb = doc.querySelector(SEL.lyricsButton);
        if (lb && lb.getAttribute('aria-pressed') === 'true') lb.click();
        openedLyrics = false;
      }
    }

    /**
     * 開いている間の、方向・決定のキー（action は SV.keys の論理名）。処理したら true。
     * 再生位置の段: ← → で 10 秒。ボタンの段: ← → で移動。音量の段: ← → で 10%。↑ ↓ で段を移る。OK は、再生位置の段では再生/一時停止。
     */
    function handleAction(action) {
      if (!el) return false;
      const step = (box, dir) => {
        if (SV.spotify) SV.spotify.markSliders(doc);
        const b = doc.querySelector(box);
        return b ? SV.spotify.stepSlider(b, dir) : false;
      };
      if (action === 'UP') row = Math.max(0, row - 1);
      else if (action === 'DOWN') row = Math.min(2, row + 1);
      else if (action === 'LEFT' || action === 'RIGHT') {
        const dir = action === 'RIGHT' ? 1 : -1;
        if (row === 0) step(SEL.seekBox, dir);
        else if (row === 2) step(SEL.volumeBox, dir);
        else col = Math.max(0, Math.min(BUTTONS.length - 1, col + dir));
      } else if (action === 'SEEK_FWD') step(SEL.seekBox, 1);
      else if (action === 'SEEK_BACK') step(SEL.seekBox, -1);
      else if (action === 'OK') {
        if (row === 1) BUTTONS[col].run();
        else if (row === 0) click(SEL.playPause);
      } else if (action === 'PLAY_PAUSE' || action === 'PLAY' || action === 'PAUSE') click(SEL.playPause);
      else if (action === 'NEXT') click(SEL.next);
      else if (action === 'PREV') click(SEL.prev);
      else return false;
      paintFocus();
      setTimeout(refresh, 150);
      return true;
    }

    return { open, close, refresh, handleAction, isOpen: () => !!el, sleepMinutes: () => (sleepIdx ? SLEEP_STEPS[sleepIdx] : 0) };
  }

  SV.spotifyNp = { SEL, SLEEP_STEPS, trackTitle, read, readLyrics, create };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyNp;
})(typeof self !== 'undefined' ? self : globalThis);
