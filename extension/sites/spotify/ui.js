/*
 * Spotify: 再生中の画面（自前）。Spotify のページの中に、全画面で出す。テレビに出す専用の画面。スマホから再生して、テレビには「いま何が流れているか」を大きく出す使い方が主。
 * Spotify 自身の画面は、文書の外に描かれる（boot-main.js）ので、この画面の下に、Spotify の要素はない。
 *   状態: 読み取り役（engine.js）から、250ms ごとに取る。再生位置は、再生中は経過時間で進める。
 *   操作: 読み取り役に依頼する（アプリ自身のサービス → メディアセッション）。
 *   曲があるとき: ジャケット・曲名・アーティスト・歌詞・再生位置。操作されたとき（← → OK）にボタンの列を出し、5 秒で隠す。↑ ↓ は音量。
 *   曲がないとき: 読み込み中／ログインしていない／再生できない（Widevine がない）／スマホから再生するのを待っている／Spotify のサービスにつながっていない、を、理由とやることつきで出す。
 * キーは、この画面がそのまま受ける。Home でハブへ。最初のキーで、音を有効にする（ブラウザの自動再生の制限）。
 */
(function (root) {
  'use strict';

  const SV = self.SV;
  const C = SV.spotifyCore;
  const doc = document;
  let reader = null; // 読み取り・操作（engine.js）

  const state = { st: null, recv: 0 }; // 読み取り役から取った、いまの状態と、取った時刻
  const ctl = { settings: SV.settings.defaults(), matcher: SV.keys.createMatcher(), gate: new SV.keys.RepeatGate({ maxPerSec: 12 }), hold: new SV.keys.HoldDetector({ holdMs: 800 }) };
  function applySettings(s) {
    ctl.settings = s;
    ctl.matcher = SV.keys.createMatcher(s.bindings);
    ctl.hold = new SV.keys.HoldDetector({ holdMs: s.holdMs });
  }
  SV.settings.load().then(applySettings);
  SV.settings.onChange(applySettings);

  const BUTTONS = [
    { id: 'prev', text: '⏮', label: '前の曲' },
    { id: 'back', text: '−10秒', label: '10 秒戻る' },
    { id: 'play', text: '⏯', label: '再生/一時停止' },
    { id: 'fwd', text: '+10秒', label: '10 秒進む' },
    { id: 'next', text: '⏭', label: '次の曲' },
    { id: 'lyrics', text: '歌詞', label: '歌詞の表示' },
  ];

  let el = null;
  let barTimer = 0;
  let toastTimer = 0;
  let fi = 2; // ボタンの列で、フォーカスがある位置（初めは再生/一時停止）
  let lock = null;
  let lastActivateAt = 0;
  let lyricHint = -1;
  let lyricSig = '';
  let lyricCur = -2;
  let lyricEnded = false; // 最後の行が終わったあと（後奏）か
  let lyricTitle = '';
  let lyricState = 'オフ'; // 診断用: オフ / 待ち n 回 / 時刻なし / n 行
  let refreshMs = 0; // 更新 1 回の時間（なだらかな平均）
  let perfObs = null;
  const longTasks = []; // 主スレッドが 50ms 以上ふさがった記録
  let prog = { state: '', from: 0, at: 0, dur: 0 }; // 位置の棒の、いまの動きの指示
  const startedAt = Date.now();

  const mk = (tag, cls, txt) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  // 値が変わったときだけ書く（同じ文字を書き直すと、画面の再計算が毎回走って重い）
  const put = (node, v) => {
    if (node.textContent !== v) node.textContent = v;
  };

  /** 操作を実行する（アプリ自身のサービス → メディアセッション。engine.js）。実行したあと、状態をすぐ取り直す。 */
  function send(cmd, arg) {
    reader.command(cmd, arg);
    setTimeout(refresh, 300);
  }
  let shownTitle = ''; // 曲が変わったとき、曲名・アーティストをふわっと出す
  const wantLyrics = () => !!ctl.settings.spotify.lyrics;
  /** 設定の「歌詞のタイミングの微調整」（秒。＋で歌詞が早く）。 */
  const lyricOffset = () => Number(ctl.settings.spotify.lyricsOffset) || 0;

  /** いまの状態の種類。アプリのサービスに、15 秒たってもつながらないときは、つながっていない。 */
  function viewKind() {
    const st = state.st;
    if (!st) return 'loading';
    if (!st.service && Date.now() - startedAt > 15000) return 'noEngine';
    return st.kind;
  }

  /** 画面を点けたままにする（テレビの画面が消えないように）。画面が見えなくなると外れるので、見えたら取り直す。 */
  async function acquireLock() {
    try {
      if (lock || !navigator.wakeLock || doc.visibilityState !== 'visible') return;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
      });
    } catch (e) {
      /* 許可されない環境では何もしない */
    }
  }
  doc.addEventListener('visibilitychange', () => {
    acquireLock();
    if (doc.visibilityState === 'visible') refresh();
  });

  function toast(msg) {
    const t = el.querySelector('.sv-np-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
    }, 1500);
  }

  function paintStatus(kind) {
    const t = C.STATUS_TEXT[kind];
    const box = el.querySelector('.sv-np-status');
    box.querySelector('.sv-np-s-icon').textContent = t.icon;
    box.querySelector('.sv-np-s-head').textContent = t.head;
    const lines = box.querySelector('.sv-np-s-lines');
    lines.textContent = '';
    t.lines.forEach((l) => lines.appendChild(mk('div', 'sv-np-s-line', l)));
    box.querySelector('.sv-np-s-hint').textContent = t.hint;
  }

  /** MV（ミュージックビデオ）の状態（右下の表示）: なし / 全画面 / 左右 / 検出（出せない理由）/ 検出（設定で出さない）。 */
  function mvText() {
    const st = state.st;
    if (!st || !st.video) return 'なし';
    if (st.mv) return st.mv === 'full' ? '全画面' : '左右';
    if (ctl.settings.spotify.mvLayout === 'off') return '検出（設定で出さない）';
    const i = st.mvInfo;
    return '検出（出せません' + (i && i.err ? ': ' + i.err : '') + '）';
  }

  /** アプリの再生位置 − 実際に鳴っている音声の位置（秒）。0 に近ければ、位置は正しい。 */
  function mediaDiffText() {
    const d = state.st && state.st.mediaDiff;
    const sh = state.st && state.st.lyricShift;
    return (d == null ? '–' : (d >= 0 ? '+' : '') + d.toFixed(1) + '秒') + (sh ? '（歌詞を ' + (sh > 0 ? '+' : '') + sh.toFixed(1) + '秒補正）' : '') + (lyricOffset() ? '（微調整 ' + (lyricOffset() > 0 ? '+' : '') + lyricOffset().toFixed(1) + '秒）' : '');
  }

  /** 歌詞が出ないときの診断（右下の表示）: 依頼の回数・いまのパス・歌詞ボタンの有無・歌詞の行の要素の数・Spotify の画面の大きさ。 */
  function dbgText(lyr) {
    const d = lyr.dbg;
    if (!d) return lyr.asks > 2 ? '（依頼' + (lyr.tries || 0) + '）' : '';
    if (d.error) return '（' + d.error + '）';
    return '（依頼' + (lyr.tries || 0) + ' 路' + d.path + ' ボタン' + (d.btn || 'なし') + (d.pressed ? ' 押下' + d.pressed : '') + ' 行要素' + d.lineEls + ' 本体' + d.main + ' 問合せ' + d.qc + '/' + d.cache + '）';
  }

  /**
   * 歌詞。アプリの問い合わせキャッシュから受け取った行（文字・開始時刻）と、再生位置から、いまの行を決める。全部の行を並べて、
   * いまの行が真ん中に来るよう、列ごと滑らかに動かす（行の作り直しは、曲が変わったときだけ）。
   */
  function paintLyrics(i, posSec, lyr) {
    const box = el.querySelector('.sv-np-lyrics');
    if (i.title !== lyricTitle) {
      lyricTitle = i.title;
      lyricHint = -1;
    }
    const ly = wantLyrics() ? C.lyricsAt(lyr.lines, posSec, i.durationSec, lyricHint) : null;
    lyricState = !wantLyrics() ? 'オフ' : lyr.none ? 'なし（この曲には歌詞がありません）' : ly ? ly.lines.length + '行・' + (lyr.src === 'cache' ? 'キャッシュ' : '部品') : lyr.lines.length ? '時刻なし' : '待ち' + lyr.asks + '回' + dbgText(lyr);
    box.hidden = !ly;
    if (!ly) return;
    lyricHint = ly.cur;
    const track = box.firstChild;
    const L = ly.lines;
    const sig = L.length + '\n' + L[0] + '\n' + L[L.length >> 1] + '\n' + L[L.length - 1];
    if (sig !== lyricSig) {
      lyricSig = sig;
      lyricCur = -2;
      lyricEnded = false;
      track.textContent = '';
      L.forEach((t) => track.appendChild(mk('div', 'sv-np-line', t)));
      track.style.transition = 'none'; // 曲が変わったときは、滑らせずに合わせる
      track.style.setProperty('--cur', String(Math.max(0, ly.cur)));
      void track.offsetWidth;
      track.style.transition = '';
    }
    if (ly.cur !== lyricCur || !!ly.ended !== lyricEnded) {
      const kids = track.children;
      // いまの行から離れるほど暗く（d1〜d3）。4 行以上離れた行は、もとから透明。変わるのは、前後 4 行ずつだけ
      const mark = (c) => {
        for (let k = Math.max(0, c - 4); k <= Math.min(kids.length - 1, c + 4); k++) {
          const d = Math.abs(k - Math.max(0, ly.cur));
          const cls = k === ly.cur ? (ly.ended ? 'sv-np-line d0 done' : 'sv-np-line is-current') : d <= 3 ? 'sv-np-line d' + d : 'sv-np-line'; // d0: まだ最初の行が始まっていない（いまの行がない）とき、いまの位置にある最初の行
          if (kids[k].className !== cls) kids[k].className = cls;
        }
      };
      if (lyricCur >= -1) mark(lyricCur); // 前のいまの行のまわり
      mark(Math.max(0, ly.cur)); // 新しいいまの行のまわり
      track.style.setProperty('--cur', String(Math.max(0, ly.cur)));
      lyricCur = ly.cur;
      lyricEnded = !!ly.ended;
    }
  }

  /**
   * 再生位置の棒。再生中は、「いまの位置 → 最後」へ、残り時間をかけて直線で動かす指示を 1 回だけ出す（あとは描画側が自動で進める。毎回書き換えない）。
   * 一時停止・シーク・曲の変わり目（見えている位置と実際の位置が 1.2% 以上ずれた）のときだけ、指示を出し直す。動かすのは transform だけ（レイアウトが走らない）。
   */
  function paintProgress(i, posSec) {
    const fill = el.querySelector('.sv-np-fill');
    if (posSec == null || !(i.durationSec > 0)) {
      if (fill.getAttribute('data-r') !== '0') {
        fill.setAttribute('data-r', '0');
        fill.style.transition = 'none';
        fill.style.transform = 'scaleX(0)';
      }
      prog.state = '';
      return;
    }
    const now = performance.now();
    const cur = Math.min(1, posSec / i.durationSec);
    const shown = prog.state === 'play' ? Math.min(1, prog.from + (now - prog.at) / 1000 / prog.dur) : prog.from;
    const stateKey = i.playing ? 'play' : 'pause';
    if (prog.state === stateKey && prog.dur === i.durationSec && Math.abs(shown - cur) < 0.012) return;
    prog = { state: stateKey, from: cur, at: now, dur: i.durationSec };
    fill.removeAttribute('data-r');
    fill.style.transition = 'none';
    fill.style.transform = 'scaleX(' + cur + ')';
    if (i.playing) {
      void fill.offsetWidth; // 起点を確定させてから、終点への動きを指示する
      fill.style.transition = 'transform ' + Math.max(0.1, i.durationSec - posSec) + 's linear';
      fill.style.transform = 'scaleX(1)';
    }
  }

  /** 右下の、版と処理時間（重いとき、原因を見分けるため）。更新: この画面の 1 回の更新の時間  停止: 主スレッドが 50ms 以上ふさがった回数（10 秒間）と最大。 */
  function paintPerf() {
    const t = performance.now();
    while (longTasks.length && t - longTasks[0].t > 10000) longTasks.shift();
    const max = longTasks.reduce((m, x) => Math.max(m, x.d), 0);
    const age = state.st ? Math.max(0, (Date.now() - state.st.at) / 1000).toFixed(0) + '秒前' : '–';
    put(el.querySelector('.sv-np-ver'), 'SofaView v' + (SV.VERSION || '') + '　更新 ' + refreshMs.toFixed(0) + 'ms　経路 ' + ({ app: 'アプリ', session: '標準API', dom: '画面' }[state.st && state.st.source] || '–') + '　歌詞 ' + lyricState + '　音声差 ' + mediaDiffText() + '　映像 ' + mvText() + '　取得 ' + age + '　停止 ' + longTasks.length + '回/10秒（最大 ' + max.toFixed(0) + 'ms）');
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

  const barVisible = () => el.querySelector('.sv-np-controls').hasAttribute('data-show');
  function hideBar() {
    clearTimeout(barTimer);
    const bar = el.querySelector('.sv-np-controls');
    const was = bar.hasAttribute('data-show');
    bar.removeAttribute('data-show');
    el.querySelector('.sv-np-hint').hidden = false;
    return was;
  }
  /** 操作されたとき、ボタンの列を出して、しばらく（5 秒）操作がなければ隠す。 */
  function showBar() {
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
    if (id === 'prev') send('prev');
    else if (id === 'next') send('next');
    else if (id === 'play') send('playPause');
    else if (id === 'back') send('seek', -1);
    else if (id === 'fwd') send('seek', 1);
    else if (id === 'lyrics') {
      const v = !wantLyrics();
      ctl.settings.spotify.lyrics = v; // すぐ反映する（保存の反映を待たない）
      SV.settings.save({ spotify: { lyrics: v } }).then(() => send('lyrics'));
      toast('歌詞 ' + (v ? 'オン' : 'オフ'));
      refresh();
    }
  }

  function refresh() {
    state.st = reader.snapshot();
    state.recv = Date.now();
    const kind = viewKind();
    el.setAttribute('data-kind', kind);
    if (state.st && state.st.mv && kind === 'track') el.setAttribute('data-mv', state.st.mv); // MV の映像を出しているとき（full / split）
    else el.removeAttribute('data-mv');
    if (state.st && state.st.mv && kind === 'track' && ctl.settings.spotify.mvOverlap === false) el.setAttribute('data-mv-apart', '1'); // MV の曲名・位置の棒を、映像に被せず、上下の帯に分ける
    else el.removeAttribute('data-mv-apart');
    const trackView = kind === 'track';
    el.setAttribute('data-view', trackView ? 'track' : 'status');
    put(el.querySelector('.sv-np-hint'), trackView ? 'どれかのキーで、ボタンを出す　↑ ↓ 音量' : '');
    if (!trackView) {
      hideBar();
      paintStatus(kind);
      paintPerf();
      return;
    }
    const st = state.st;
    const i = st.info;
    const now = Date.now();
    const posSec = C.positionNow(st, now);
    el.setAttribute('data-state', i.playing ? 'playing' : 'paused');
    put(el.querySelector('.sv-np-state'), i.playing ? '▶ 再生中' : '⏸ 一時停止');
    if (i.title !== shownTitle) {
      shownTitle = i.title;
      const inf = el.querySelector('.sv-np-info');
      inf.classList.remove('fresh');
      void inf.offsetWidth; // アニメーションを最初からやり直す
      inf.classList.add('fresh');
    }
    put(el.querySelector('.sv-np-title'), i.title);
    put(el.querySelector('.sv-np-artist'), i.artists);
    const cover = el.querySelector('.sv-np-cover');
    if (i.cover && cover.getAttribute('src') !== i.cover) {
      cover.style.transition = 'none';
      cover.style.opacity = '0'; // 読み込めたら（load）、ふわっと出す
      void cover.offsetWidth;
      cover.style.transition = '';
      cover.setAttribute('src', i.cover); // 背景も、読み込みが終わったとき（load）に描く
    }
    cover.hidden = !i.cover;
    paintButtons(i);
    paintLyrics(i, posSec == null ? posSec : posSec + (st.lyricShift || 0) + lyricOffset(), st.lyrics); // 歌詞は、実際に鳴っている音声に合わせた補正と、設定の微調整（秒）を足した位置で
    // MV の左右表示で、歌詞がない（設定オフ・この曲にはない・時刻がなくて出せない・待っても来ない）ときは、映像を画面いっぱいに（中央寄りで）広げる。歌詞を読み込み中の間は、広げない（揺れないように）
    const lyBox = el.querySelector('.sv-np-lyrics');
    const lyWaiting = wantLyrics() && !st.lyrics.none && !st.lyrics.lines.length && st.lyrics.asks < 30;
    if (st.mv === 'split' && lyBox.hidden && !lyWaiting) el.setAttribute('data-mv-wide', '1');
    else el.removeAttribute('data-mv-wide');
    paintProgress(i, posSec);
    put(el.querySelector('.sv-np-pos'), posSec != null ? C.fmt(posSec) : i.position);
    put(el.querySelector('.sv-np-dur'), i.durationSec > 0 ? C.fmt(i.durationSec) : i.duration);
  }

  function build() {
    el = mk('div');
    el.id = 'sv-np';
    el.setAttribute('role', 'main');
    el.setAttribute('aria-label', '再生中');
    const body = mk('div', 'sv-np-body');
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
    // 背景: ジャケットを、曲が変わったときに 1 回だけ、小さな canvas（160×90）に「ぼかして・暗くして」描く（ぼかしは canvas の中で 1 回だけ。画面では、できあがった絵を引き伸ばすだけで、
    // 毎フレームのぼかし（CSS の filter: blur）は使わない。弱い GPU で重いため）。2 枚の canvas を交互に使い、前の絵から新しい絵へクロスフェードさせる（opacity だけ）
    const bgs = [mk('canvas', 'sv-np-bg'), mk('canvas', 'sv-np-bg')];
    bgs.forEach((c) => {
      c.width = 160;
      c.height = 90;
    });
    let bgNext = 0;
    function paintBg(c) {
      const g = c.getContext('2d');
      const iw = cover.naturalWidth || 1;
      const ih = cover.naturalHeight || 1;
      const k = Math.max(c.width / iw, c.height / ih) * 1.3; // 画面いっぱいに、まわりを少し余分に（端がぼけて暗くならないように）
      g.clearRect(0, 0, c.width, c.height);
      g.filter = 'blur(7px) brightness(0.4) saturate(1.25)';
      g.drawImage(cover, (c.width - iw * k) / 2, (c.height - ih * k) / 2, iw * k, ih * k);
      g.filter = 'none';
    }
    cover.addEventListener('load', () => {
      cover.style.opacity = '1'; // ジャケットは、読み込めてから、ふわっと出る
      try {
        const c = bgs[bgNext];
        bgNext ^= 1;
        paintBg(c);
        c.classList.add('on');
        bgs[bgNext].classList.remove('on');
      } catch (e) {
        /* 描けなければ、そのまま */
      }
    });
    cover.addEventListener('error', () => {
      cover.style.opacity = '1';
    });
    body.append(cover, info);
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
    // MV の映像の枠。Spotify 自身の映像の置き場を、アプリ自身の部品（react-main.js の video）が、ここに差し込む。映像がないときは、空で隠れている
    const vslot = mk('div');
    vslot.id = 'sv-np-video';
    el.append(bgs[0], bgs[1], vslot, body, status, toastEl, controls, mk('div', 'sv-np-hint'), mk('div', 'sv-np-ver', 'SofaView v' + (SV.VERSION || '')));
    doc.body.appendChild(el);
  }

  /** キー。この画面がそのまま受ける（Spotify のページには届かない）。 */
  function onKeyDown(e) {
    if (SV.keys.shouldIgnore(e)) return;
    const action = ctl.matcher.match(e);
    SV.consume(e);
    // ブラウザの自動再生の制限を解く: Spotify 自身が、最初のクリックで音を有効にする（activateElement）。ここでキーを横取りしているので、代わりに呼ぶ
    if (!e.repeat && Date.now() - lastActivateAt > 3000) {
      lastActivateAt = Date.now();
      reader.command('activate');
    }
    if (!action) return;
    if (action === 'HOME') {
      if (!e.repeat) SV.goHub();
      return;
    }
    if (action === 'BACK') {
      if (ctl.settings.holdBackToHome && ctl.hold.feed('BACK', e)) SV.goHub(); // 長押しでホーム
      else if (!e.repeat) hideBar();
      return;
    }
    if (!ctl.gate.allow(action, e)) return;
    const kind = viewKind();
    if (kind === 'loggedOut') {
      if (action === 'OK') reader.command('login'); // Spotify のログイン画面へ（アプリ自身のログインの処理）
      return;
    }
    if (kind !== 'track') return; // 曲がないときは、ほかの操作はない
    // 再生・次・前のキー（リモコンのメディアキー）は、ボタンを出さずにそのまま
    if (action === 'PLAY_PAUSE' || action === 'PLAY' || action === 'PAUSE') send('playPause');
    else if (action === 'NEXT') send('next');
    else if (action === 'PREV') send('prev');
    else if (action === 'SEEK_BACK') send('seek', -1);
    else if (action === 'SEEK_FWD') send('seek', 1);
    else if (action === 'UP' || action === 'DOWN') {
      // 音量は、ボタンの列が出ていなくても、すぐ動かす
      send('volume', action === 'UP' ? 1 : -1);
      setTimeout(() => {
        const v = state.st && state.st.info.volume;
        if (v != null) toast('音量 ' + Math.round(v * 100) + '%');
      }, 400);
    } else if (action === 'LEFT' || action === 'RIGHT' || action === 'OK') {
      // 最初の 1 回は、ボタンの列を出すだけ（うっかり押して止まらないように）
      if (!barVisible()) showBar();
      else {
        showBar();
        if (action === 'OK') activate(BUTTONS[fi].id);
        else focusButton(fi + (action === 'RIGHT' ? 1 : -1));
      }
    }
  }

  function start(opts) {
    reader = opts.reader;
    build();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', (e) => {
      if (SV.keys.shouldIgnore(e)) return;
      SV.consume(e);
      if (ctl.matcher.match(e) === 'BACK') ctl.hold.release('BACK');
    }, true);
    window.addEventListener('keypress', (e) => !SV.keys.shouldIgnore(e) && SV.consume(e), true);
    try {
      const po = new PerformanceObserver((l) => {
        for (const en of l.getEntries()) longTasks.push({ t: en.startTime, d: en.duration });
      });
      po.observe({ type: 'longtask' });
      perfObs = po;
    } catch (e) {
      /* 測れない環境では、何もしない */
    }
    let n = 0;
    setInterval(() => {
      if (doc.visibilityState !== 'visible') return; // 見えていないときは、描画を更新しない
      const t0 = performance.now();
      refresh();
      refreshMs = refreshMs * 0.8 + (performance.now() - t0) * 0.2;
      if (++n % 8 === 0) paintPerf();
    }, 250);
    refresh();
    acquireLock();
    window.addEventListener('pagehide', () => perfObs && perfObs.disconnect());
    return { refresh, root: () => el };
  }

  SV.spotifyUI = { start };
})(typeof self !== 'undefined' ? self : globalThis);
