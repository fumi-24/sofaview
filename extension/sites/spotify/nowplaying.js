/*
 * Spotify: 再生中の大きな画面（リモコンで操作する用）。ジャケット・曲名・アーティスト・再生位置を大きく出す。
 * 画面は拡張が作る（Spotify 自身の「再生中ビュー」は、サイトの内側の作りに依存するので使わない）。読み取りは、再生バーの data-testid だけ。
 *   開く: 再生バーのジャケット（cover-art-button）で OK／黄色キー。操作: OK 再生/一時停止、← → 10 秒、↑ ↓ 前/次、戻る 閉じる
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
    seek: '[data-testid="playback-progressbar"] input[type="range"]',
    lyricsButton: '[data-testid="lyrics-button"]',
    lyricsLine: '[data-testid="lyrics-line"]',
  });

  const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /** 再生バーから、いま再生中の曲の情報を読む（DOM に触るのは読むだけ）。 */
  function read(doc) {
    const w = doc.querySelector(SEL.widget);
    const title = text(w && w.querySelector(SEL.title));
    const img = w && w.querySelector(SEL.cover);
    const seek = doc.querySelector(SEL.seek);
    const max = seek ? Number(seek.max) : 0;
    const label = (doc.querySelector(SEL.playPause) || { getAttribute: () => '' }).getAttribute('aria-label') || '';
    return {
      hasTrack: !!title,
      title,
      artists: text(w && w.querySelector(SEL.byline)),
      cover: img ? img.currentSrc || img.src || '' : '',
      playing: /一時停止|pause/i.test(label),
      position: text(doc.querySelector(SEL.position)),
      duration: text(doc.querySelector(SEL.duration)),
      ratio: seek && max > 0 ? Math.min(1, Math.max(0, Number(seek.value) / max)) : 0,
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

  /** 画面の部品を作る。open / close / isOpen / refresh。 */
  function create(opts) {
    const doc = (opts && opts.document) || document;
    let el = null;
    let timer = 0;
    let openedLyrics = false; // 歌詞を出すために、こちらで歌詞ボタンを押したか（閉じるときに戻す）

    const mk = (tag, cls, txt) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (txt != null) e.textContent = txt;
      return e;
    };

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
      const ly = readLyrics(doc);
      const box = el.querySelector('.sv-np-lyrics');
      box.hidden = !ly;
      if (ly) {
        const sig = ly.active + '|' + ly.lines.join('\n');
        if (box.getAttribute('data-sig') !== sig) {
          box.setAttribute('data-sig', sig);
          box.textContent = '';
          ly.lines.forEach((t, i) => box.appendChild(mk('div', 'sv-np-line' + (i === ly.active ? ' is-current' : ''), t)));
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
      const body = mk('div', 'sv-np-body');
      const info = mk('div', 'sv-np-info');
      const bar = mk('div', 'sv-np-bar');
      bar.appendChild(mk('div', 'sv-np-fill'));
      const times = mk('div', 'sv-np-times');
      times.append(mk('span', 'sv-np-pos'), mk('span', 'sv-np-dur'));
      const lyrics = mk('div', 'sv-np-lyrics');
      lyrics.hidden = true;
      info.append(mk('div', 'sv-np-state'), mk('h1', 'sv-np-title'), mk('div', 'sv-np-artist'), bar, times, lyrics, mk('div', 'sv-np-hint', 'OK 再生/一時停止　← → 10 秒　↑ 前の曲　↓ 次の曲　戻る 閉じる'));
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
      refresh();
      timer = setInterval(refresh, 400);
    }

    function close() {
      if (!el) return;
      clearInterval(timer);
      el.remove();
      el = null;
      doc.documentElement.classList.remove('sv-np-open');
      if (openedLyrics) {
        const lb = doc.querySelector(SEL.lyricsButton);
        if (lb && lb.getAttribute('aria-pressed') === 'true') lb.click();
        openedLyrics = false;
      }
    }

    return { open, close, refresh, isOpen: () => !!el };
  }

  SV.spotifyNp = { SEL, read, readLyrics, create };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyNp;
})(typeof self !== 'undefined' ? self : globalThis);
