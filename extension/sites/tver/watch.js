/*
 * TVer の視聴画面（プレイヤー）を youtube.com/tv の視聴画面と同じ見た目・操作にする（docs/SPEC.md 7.5・9.5、docs/NOTES.md 3.10）。
 *
 * 方針: 自前のプレイヤー（HUD）は作らず、**TVer 自身の操作盤（VodController）と全画面（PlayerLayout_host）をそのまま使う**。
 *  - 見た目は CSS（watch.css）で /tv に寄せる: 劇場表示・操作盤の配置・フォーカスの形・再生速度／画質のポップアップ
 *  - 操作盤の出し入れは、拡張が持つ 1 つの状態（H 非表示 / C 操作画面 / S スクラブ。common/watch-core.js）で決める。
 *    TVer 自身の表示タイマー（2.5 秒／フォーカス中 30 秒）は CSS で上書きして使わない（html[data-sv-ui] で opacity を決める）
 *  - タイトル・進行バー・時間・スクラブの時刻は、操作盤の隣（host の中）に置く読み取り専用の覆い（#sv-watch-ui）に描く。クリックもフォーカスも受けない
 *  - 再生／一時停止・再生速度・画質は TVer 自身のボタンを押す（TVer の状態と食い違わない）。全画面も TVer 自身のボタン（[js-fullscreen-target] に requestFullscreen）
 *  - 動作に使うのは TVer が明示している属性と ARIA ラベルだけ（selectors.js の watchParts）。見つからなければ何もしない（TVer 自身のキー操作がそのまま使える）
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  const VIDEO_EVENTS = ['timeupdate', 'seeking', 'seeked', 'progress', 'durationchange', 'loadedmetadata', 'play', 'playing', 'pause', 'waiting', 'canplay', 'ended', 'emptied'];
  const LOADING_MS = 800; // /tv は読み込み中の表示を、800ms 待ってから出す（速いシークでは出ない）

  function create(options) {
    const o = options || {};
    const T = SV.tver;
    const C = SV.watchCore;
    const doc = document;
    const html = doc.documentElement;

    const st = {
      on: false,
      core: C.initialState(),
      scrub: null, // { base, target, n, last } スクラブ中
      idle: 0, // 操作画面を自動で隠すタイマー
      pendingFs: false, // 全画面にしたい（ユーザー操作の窓の中で TVer の全画面ボタンを押す）
      leaving: false,
      optIn: false, // 「先にページを見る」ページ（リアルタイム配信のチャンネル）で、視聴画面（劇場表示）に入ると決めた
      ui: null, // 覆い（#sv-watch-ui）の部品
      video: null, // イベントを付けている video
      loadTimer: 0,
      metaKey: '',
      nextCancelled: false, // 次のエピソードの自動再生を止めた（戻るをもう一度押すと画面を離れる）
      flags: { ad: false, noSeek: false, live: false },
    };

    const parts = () => T.watchParts(doc);
    const setText = (el, text) => {
      if (el && el.textContent !== text) el.textContent = text;
    };

    // ------------------------------------------------------------ 入口と出口

    /** 視聴画面にするか: 再生ページで、TVer の操作盤（または再生が終わった案内）が出ていて、ミニプレイヤーではない。 */
    function wanted(p) {
      if (!p || !(o.isPlayerPage ? o.isPlayerPage() : true)) return false;
      if (p.host.getAttribute('data-mini-player') === 'true') return false;
      // チャンネルのページ（リアルタイム配信）は、開いただけで再生が始まり、タブ（局）と番組表も使う。OK・全画面で入ったときだけ視聴画面にする
      if (browseFirst() && !st.optIn && doc.fullscreenElement !== p.host) return false;
      return !!(p.ctl || (p.video && p.video.ended));
    }

    const browseFirst = () => !!(o.browseFirst && o.browseFirst());

    function enter() {
      st.on = true;
      st.core = C.initialState();
      st.scrub = null;
      html.classList.add('sv-watch');
      render();
      st.pendingFs = wantNativeFs();
    }

    function exit() {
      st.on = false;
      clearTimeout(st.idle);
      st.idle = 0;
      clearTimeout(st.loadTimer);
      st.loadTimer = 0;
      if (st.scrub) scrubEnd(false, !st.leaving); // 離れる途中（STOP など）なら、再生は再開しない
      html.classList.remove('sv-watch', 'sv-ended', 'sv-ad', 'sv-live', 'sv-loading');
      html.removeAttribute('data-sv-ui');
      html.removeAttribute('data-sv-focus');
      detachUi();
      unbindVideo();
      st.pendingFs = false;
    }

    /** 状態の同期（DOM の変化・一定間隔で呼ぶ）。 */
    function sync() {
      const p = parts();
      const want = wanted(p);
      if (want && !st.on) enter();
      else if (!want && st.on) exit();
      if (!st.on) return;
      attachUi(p);
      bindVideo(p.video);
      refreshFlags(p);
      applyFocus(p);
      paintMeta();
      paint();
      if (st.pendingFs) tryFullscreen(p);
    }

    function refreshFlags(p) {
      const f = T.playerFlags(p.player, p.video, p.ctl);
      st.flags = f;
      const pb = p.button('play');
      const pl = pb && pb.querySelector('svg') && pb.querySelector('svg').getAttribute('aria-label');
      st.core.noPause = pl === '停止'; // ライブの停止ボタン（押すと配信が終わる）は、進行バーの OK・メディアキーでは押さない
      const ended = !!(p.video && p.video.ended && !p.ctl);
      st.core.noSeek = f.ad || f.noSeek || f.live;
      st.core.ended = ended;
      if (!ended) st.nextCancelled = false;
      st.core.popup = !!p.popup();
      html.classList.toggle('sv-ad', f.ad);
      html.classList.toggle('sv-live', f.live);
      html.classList.toggle('sv-ended', ended);
    }

    /** 拡張が見る状態を html の属性に写す（CSS と、テスト・診断が読む）。 */
    function render() {
      html.setAttribute('data-sv-ui', st.core.ui);
      html.setAttribute('data-sv-focus', st.core.focus);
    }

    // ------------------------------------------------------------ 覆い（タイトル・進行バー・時間・スクラブの時刻）

    function buildUi() {
      const el = doc.createElement('div');
      el.id = 'sv-watch-ui';
      el.setAttribute('aria-hidden', 'true');
      // 静的な文字列だけ（外部の文字列は textContent で入れる）
      el.innerHTML =
        '<div class="sv-w-stage">' +
        '<div class="sv-w-meta"><div class="sv-w-title"><b class="sv-w-livebadge">LIVE</b><span></span></div><div class="sv-w-sub"><span></span></div></div>' +
        '<div class="sv-w-progress">' +
        '<div class="sv-w-times"><span class="sv-w-cur"></span><span class="sv-w-dur"></span></div>' +
        '<div class="sv-w-track"><div class="sv-w-buf"></div><div class="sv-w-played"></div></div>' +
        '<div class="sv-w-knob"></div>' +
        '<div class="sv-w-preview"><div class="sv-w-ptime"></div></div>' +
        '</div>' +
        '<div class="sv-w-loading">読み込み中...</div>' +
        '</div>';
      return el;
    }

    /**
     * 覆いは、操作盤（VodController）と同じ親の中（操作盤の直前）に置く。操作盤の再生速度・画質のポップアップが、覆い（時間の表示など）の上に出るように、
     * 重なり順を同じ層（PlayerLayout_jail の isolation の中）にそろえる。host の中なので、全画面（top layer）でも見える。
     */
    function attachUi(p) {
      if (!p.ctl || !p.ctl.parentElement) return detachUi();
      if (st.ui && st.ui.root.isConnected && st.ui.root.parentElement === p.ctl.parentElement) return;
      detachUi();
      const el = buildUi();
      p.ctl.parentElement.insertBefore(el, p.ctl);
      const q = (sel) => el.querySelector(sel);
      st.ui = {
        root: el,
        title: q('.sv-w-title span'),
        sub: q('.sv-w-sub span'),
        cur: q('.sv-w-cur'),
        dur: q('.sv-w-dur'),
        ptime: q('.sv-w-ptime'),
      };
      st.metaKey = '';
    }

    function detachUi() {
      if (st.ui && st.ui.root.parentElement) st.ui.root.remove();
      st.ui = null;
    }

    function paintMeta() {
      if (!st.ui) return;
      const m = T.meta(doc);
      const key = m.title + '\n' + m.subtitle;
      if (key === st.metaKey) return;
      st.metaKey = key;
      setText(st.ui.title, m.title);
      setText(st.ui.sub, m.subtitle);
    }

    /** 進行バー・時間・スクラブの時刻。表示していないときは何もしない（動画の再生中は timeupdate のたびに呼ばれる）。 */
    function paint() {
      const u = st.ui;
      const v = st.video;
      if (!u || !v || st.core.ui === 'H') return;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      const cur = st.scrub ? st.scrub.target : v.currentTime;
      const frac = dur ? Math.min(1, Math.max(0, cur / dur)) : 0;
      let buf = 0;
      if (dur) {
        for (let i = 0; i < v.buffered.length; i++) {
          if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) buf = v.buffered.end(i) / dur;
        }
      }
      const s = u.root.style;
      s.setProperty('--sv-p', String(frac));
      s.setProperty('--sv-b', String(Math.min(1, Math.max(frac, buf))));
      setText(u.cur, C.fmtTime(cur));
      setText(u.dur, C.fmtTime(dur));
      setText(u.ptime, C.fmtTime(cur));
    }

    // ------------------------------------------------------------ video のイベント（進行バーの更新・読み込み中の表示）

    function bindVideo(v) {
      if (v === st.video) return;
      unbindVideo();
      st.video = v;
      if (v) for (const t of VIDEO_EVENTS) v.addEventListener(t, onVideo);
    }

    function unbindVideo() {
      const v = st.video;
      st.video = null;
      if (v) for (const t of VIDEO_EVENTS) v.removeEventListener(t, onVideo);
    }

    function onVideo(e) {
      if (!st.on) return;
      switch (e.type) {
        case 'waiting':
          if (!st.loadTimer) st.loadTimer = setTimeout(() => (html.classList.add('sv-loading'), (st.loadTimer = 0)), LOADING_MS);
          break;
        case 'playing':
        case 'canplay':
        case 'seeked':
        case 'pause':
        case 'emptied':
        case 'ended':
          clearTimeout(st.loadTimer);
          st.loadTimer = 0;
          html.classList.remove('sv-loading');
          if (e.type === 'ended') sync();
          break;
        case 'play':
          armIdle(); // 一時停止から再開したら、操作画面が出ていれば隠すタイマーを動かし直す
          break;
        default:
      }
      if (e.type === 'timeupdate' || e.type === 'seeking' || e.type === 'seeked' || e.type === 'durationchange' || e.type === 'loadedmetadata' || e.type === 'progress') paint();
    }

    // ------------------------------------------------------------ フォーカス

    /** サイトのモーダル（アンケート・同意など。host の外）が開いているか。再生速度・画質のポップアップは host の中なので含めない。 */
    function modalOpen(p) {
      for (const el of doc.querySelectorAll(T.SEL.dialog)) {
        if (p.host.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      }
      return false;
    }

    /** 実フォーカスを状態に合わせる: ボタン列（C + row）はボタン、それ以外（H・S・進行バー）は操作盤のコンテナ。 */
    function applyFocus(p) {
      if (!p.ctl || st.core.popup || st.core.ended || modalOpen(p)) return;
      const a = doc.activeElement;
      if (st.core.ui === 'C' && st.core.focus === 'row') {
        const items = p.rowItems();
        if (a && items.includes(a)) return;
        const el = p.button('play') || items[0];
        if (el) el.focus({ preventScroll: true });
      } else if (a !== p.ctl) {
        p.ctl.focus({ preventScroll: true });
      }
    }

    function rowMove(dir) {
      const p = parts();
      if (!p || !p.ctl) return;
      const items = p.rowItems();
      if (!items.length) return;
      let i = items.indexOf(doc.activeElement);
      if (i < 0) i = Math.max(0, items.indexOf(p.button('play')));
      const j = Math.max(0, Math.min(items.length - 1, i + dir));
      items[j].focus({ preventScroll: true });
    }

    function activate() {
      const p = parts();
      if (!p || !p.ctl) return;
      const a = doc.activeElement;
      const target = a && p.rowItems().includes(a) ? a : p.button('play');
      if (target) target.click();
    }

    // ------------------------------------------------------------ 再生・一時停止・スクラブ

    function togglePause() {
      const p = parts();
      const b = p && p.button('play');
      if (b) b.click();
      else if (st.video) {
        const v = st.video;
        if (v.paused) v.play().catch(() => {});
        else v.pause();
      }
    }

    function resume() {
      const v = st.video;
      if (v && v.paused && !v.ended) v.play().catch(() => {});
    }

    function scrubStart() {
      const v = st.video;
      if (!v) return;
      st.scrub = { base: v.currentTime, target: v.currentTime, n: 0, last: 0 };
      v.pause(); // 探している間は映像を止める（確定・取り消しで再開）
      paint();
    }

    function scrubStep(dir) {
      const s = st.scrub;
      const v = st.video;
      if (!s || !v) return;
      const now = performance.now();
      s.n = C.nextCount(s.n, now - s.last);
      s.last = now;
      s.target = C.clampTarget(s.target + dir * C.scrubStep(s.n, v.duration), v.duration);
      paint();
    }

    function scrubEnd(commit, resumePlay = true) {
      const s = st.scrub;
      st.scrub = null;
      const v = st.video;
      if (!v || !s) return;
      if (commit) {
        try {
          v.currentTime = s.target;
        } catch (e) {
          /* シークできない（読み込み前など）は無視 */
        }
      }
      if (resumePlay) resume(); // /tv は、確定でも取り消しでも再生を再開する（一時停止していたときも）
    }

    // ------------------------------------------------------------ 操作画面を自動で隠す（最後のキーから 5 秒。一時停止中は隠さない）

    function armIdle() {
      clearTimeout(st.idle);
      st.idle = 0;
      if (!st.on || st.core.ui !== 'C') return;
      st.idle = setTimeout(onIdle, C.IDLE_MS);
    }

    function onIdle() {
      st.idle = 0;
      const p = parts();
      const v = st.video;
      if (!st.on || !p) return;
      if (p.popup()) {
        armIdle(); // ポップアップを開いている間は隠さない（閉じたあと 5 秒で隠れるよう、タイマーは続ける）
        return;
      }
      if (v && v.paused && !v.ended && !st.flags.ad) return; // 一時停止中は隠さない（再開すると play のイベントで動き出す。広告中は、本編が止まっていても隠す）
      apply(C.reduce(st.core, 'IDLE'), null);
    }

    // ------------------------------------------------------------ 全画面（TVer 自身のボタン）

    function wantNativeFs() {
      return !o.nativeFullscreen || o.nativeFullscreen() !== false;
    }

    /**
     * 全画面は TVer 自身の全画面ボタンを押して行う（[js-fullscreen-target] に requestFullscreen。TVer の状態・:fullscreen の CSS がそのまま働く）。
     * ユーザー操作の直後（約 5 秒以内）でないと拒否されるので、できなければ次のキー操作で再度試す。
     */
    function tryFullscreen(p) {
      if (!wantNativeFs() || doc.fullscreenElement) {
        st.pendingFs = false;
        return true;
      }
      if (!(navigator.userActivation && navigator.userActivation.isActive)) return false;
      const b = p.button('fullscreen');
      if (!b) return false;
      st.pendingFs = false;
      b.click();
      return true;
    }

    function exitFullscreen() {
      if (!doc.fullscreenElement) return;
      try {
        const r = doc.exitFullscreen();
        if (r && r.catch) r.catch(() => {});
      } catch (e) {
        /* 無視 */
      }
    }

    /**
     * 全画面の間は Esc を拡張で受ける（戻るキー）。ブラウザは全画面中の Esc を横取りして全画面を終えてしまうので、Keyboard Lock で止める
     * （この間、全画面は Esc の長押しで終わる）。対応していない・拒否されたときは、最初の Esc が全画面を終えるだけで、操作は続けられる。
     */
    function onFullscreenChange() {
      const kb = navigator.keyboard;
      try {
        if (doc.fullscreenElement && st.on && kb && kb.lock) {
          const r = kb.lock(['Escape']);
          if (r && r.catch) r.catch(() => {});
        } else if (!doc.fullscreenElement && kb && kb.unlock) kb.unlock();
      } catch (e) {
        /* 無視 */
      }
      if (st.on) setTimeout(sync, 0);
    }
    doc.addEventListener('fullscreenchange', onFullscreenChange);

    // ------------------------------------------------------------ 離れる

    /** 視聴画面から離れる: 全画面を終え、前のページへ戻る。戻った先で TVer が出すミニプレイヤーはすぐ閉じる（音が鳴り続けないように）。 */
    function leave() {
      if (browseFirst() && st.optIn) {
        // チャンネルのページ: 視聴画面（劇場表示・全画面）をやめて、ページに戻る（配信は続く。局の切り替え・番組表へ）
        st.optIn = false;
        exitFullscreen();
        const p = parts();
        sync();
        if (p && p.ctl && p.ctl.focus) p.ctl.focus({ preventScroll: true });
        return;
      }
      if (st.leaving) return;
      st.leaving = true;
      html.classList.add('sv-leaving');
      if (st.video) st.video.pause(); // 戻った先でミニプレイヤーが開くまでの間も、音を出さない
      exitFullscreen();
      if (o.goBack) o.goBack();
      const t0 = Date.now();
      const done = (iv) => {
        clearInterval(iv);
        setTimeout(() => {
          st.leaving = false;
          html.classList.remove('sv-leaving');
        }, 400);
      };
      const iv = setInterval(() => {
        const close = doc.querySelector(T.SEL.miniClose);
        if (close) {
          close.click();
          done(iv);
        } else if (Date.now() - t0 > 4000) done(iv);
      }, 100);
    }

    // ------------------------------------------------------------ キー

    function synthEscape(target) {
      (target || doc.activeElement || doc.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    }

    /** 状態遷移の結果を反映する（e: キーのイベント。タイマー由来は null）。 */
    function apply(r, e) {
      st.core = r.state;
      render();
      const p = parts();
      for (const f of r.effects) {
        switch (f.do) {
          case 'show':
          case 'touch':
            armIdle();
            break;
          case 'hide':
            clearTimeout(st.idle);
            st.idle = 0;
            break;
          case 'focus':
            if (p) applyFocus(p);
            break;
          case 'togglePause':
            togglePause();
            break;
          case 'pause':
            if (st.video && !st.video.paused) togglePause();
            break;
          case 'play':
            if (st.video && st.video.paused) togglePause();
            break;
          case 'rowMove':
            rowMove(f.dir);
            break;
          case 'activate':
            activate();
            break;
          case 'scrubStart':
            scrubStart();
            break;
          case 'scrubStep':
            scrubStep(f.dir);
            break;
          case 'scrubCommit':
            scrubEnd(true);
            break;
          case 'scrubCancel':
            scrubEnd(false);
            break;
          case 'leave':
            leave();
            break;
          case 'playNext': {
            const b = (p && p.nextPlay()) || doc.querySelector(T.SEL.posterPlay);
            if (b) b.click();
            break;
          }
          case 'cancelNext': {
            // 1 回目: TVer の「閉じる」を押す（自動再生が止まる。実サイトでは、TVer が全画面を終えてプレイヤーを初期状態（ポスター）へ戻す）。
            // 案内が残るとき（まだ戻っていない・戻らなかった）の 2 回目は、画面を離れる（同じ案内に戻り続けて離れられなくならないように）
            const b = p && p.nextClose();
            if (b && !st.nextCancelled) {
              st.nextCancelled = true;
              b.click();
            } else leave();
            break;
          }
          case 'escapePopup':
            // 本物の Esc は Radix がそのまま受ける。Esc 以外の戻るキーは Esc として渡す
            if (e && e.key !== 'Escape') {
              SV.consume(e);
              synthEscape(doc.activeElement);
            }
            armIdle(); // 閉じたあと、操作画面は 5 秒で隠れる
            break;
          case 'popupSelect': {
            const a = doc.activeElement;
            if (a && a.matches && a.matches('[role="radio"]')) a.click();
            synthEscape(a);
            armIdle();
            break;
          }
          default:
        }
      }
      paint();
    }

    /**
     * キー 1 回の処理。戻り値 true = 視聴画面が受け持った（呼び出し側は後続の処理をしない）。false = 視聴画面は関与しない。
     * 受け持ったキーのうち、サイトに任せるもの（ポップアップの矢印など）は consume せずに true を返す。
     * @param {KeyboardEvent} e
     * @param {string} action  SV.keys のアクション名
     */
    function handleKey(e, action) {
      if (!st.on) return false;
      const p = parts();
      if (!p || !wanted(p) || modalOpen(p)) return false;
      refreshFlags(p);
      // 自動で全画面にできなかったとき（再生の開始がユーザー操作から離れていた）は、最初のキー操作の窓で TVer の全画面を使う（Esc は窓にならない）
      if (st.pendingFs && e.isTrusted && e.key !== 'Escape') tryFullscreen(p);

      const popup = st.core.popup;
      const seekKey = action === 'LEFT' || action === 'RIGHT' || action === 'SEEK_BACK' || action === 'SEEK_FWD';
      if (!popup && e.repeat && !seekKey) {
        SV.consume(e); // 押しっぱなしでメニューが出入りしない
        return true;
      }
      const r = C.reduce(st.core, action);
      apply(r, e);
      if (r.consume) SV.consume(e);
      else if (!popup && SV.keys.isDirection(action)) SV.consume(e); // サイトのスクロールなどを起こさない
      return true;
    }

    return {
      sync,
      handleKey,
      /** 視聴画面に入る（リアルタイム配信のチャンネルのページで、プレイヤーを OK で選んだとき）。 */
      begin() {
        if (st.on || !browseFirst()) return false;
        st.optIn = true;
        sync();
        return st.on;
      },
      /** ページが変わった（次のページでは、また「先にページを見る」から）。 */
      reset() {
        st.optIn = false;
      },
      active: () => st.on,
      leave,
      state: () => ({ on: st.on, ...st.core, scrub: st.scrub ? { ...st.scrub } : null, pendingFs: st.pendingFs, flags: { ...st.flags } }),
    };
  }

  SV.watch = { create };
  if (typeof module === 'object' && module.exports) module.exports = SV.watch;
})(typeof self !== 'undefined' ? self : globalThis);
