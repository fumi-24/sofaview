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

  /** 画面の部品を作る。open / close / isOpen / refresh。 */
  function create(opts) {
    const doc = (opts && opts.document) || document;
    let el = null;
    let timer = 0;

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
      info.append(mk('div', 'sv-np-state'), mk('h1', 'sv-np-title'), mk('div', 'sv-np-artist'), bar, times, mk('div', 'sv-np-hint', 'OK 再生/一時停止　← → 10 秒　↑ 前の曲　↓ 次の曲　戻る 閉じる'));
      const cover = mk('img', 'sv-np-cover');
      cover.alt = '';
      body.append(cover, info);
      el.append(mk('div', 'sv-np-bg'), body);
      (doc.body || doc.documentElement).appendChild(el);
      doc.documentElement.classList.add('sv-np-open');
      refresh();
      timer = setInterval(refresh, 400);
    }

    function close() {
      if (!el) return;
      clearInterval(timer);
      el.remove();
      el = null;
      doc.documentElement.classList.remove('sv-np-open');
    }

    return { open, close, refresh, isOpen: () => !!el };
  }

  SV.spotifyNp = { SEL, read, create };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyNp;
})(typeof self !== 'undefined' ? self : globalThis);
