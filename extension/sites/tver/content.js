/*
 * TVer コンテンツスクリプト（document_start）。
 *  1. ダークテーマ（TVer 標準）・画面倍率・設定クラスを早めに適用
 *  2. リモコンキーを処理（HOME/BACK/十字キー/OK、視聴画面）
 *  3. SPA の遷移を検知して、フォーカスの復元・初期フォーカスを行う
 */
(function () {
  'use strict';

  const SV = self.SV;
  if (!SV || !SV.tver || !SV.keys || !SV.nav || !SV.rows || !SV.watch || !SV.watchCore || !SV.osk || !SV.settings) return;
  const T = SV.tver;
  const html = document.documentElement;
  const DIR = { UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' };

  const ctl = {
    settings: SV.settings.defaults(),
    matcher: SV.keys.createMatcher(),
    gate: new SV.keys.RepeatGate({ maxPerSec: 12 }),
    hold: new SV.keys.HoldDetector({ holdMs: 800 }),
    nav: null,
    watch: null,
    osk: null,
    routeKey: '',
    hadFocus: false,
    userMoved: false, // この遷移の後に十字キーなどで操作したか（初期フォーカスで操作を奪わないため）
    initialDone: false,
    routeStartedAt: 0,
    bbClickedAt: 0,
    bbUserUntil: 0, // 手動でスライドを選んだ直後（この間は自動送りに追従せず、選んだスライドへ戻す）
    railChecked: false,
    railIntentUntil: 0, // レールで項目を選んだ直後（遷移後もフォーカスをレールに残す）
    freshRoute: false, // 遷移直後（レールから → で内容へ入るとき、最初の要素を選ぶ）
  };

  // ------------------------------------------------------------------ 1. 早めの適用

  try {
    localStorage.setItem('appearanceMode', 'dark'); // TVer 標準のダークテーマ
  } catch (e) {
    /* localStorage が使えない環境は無視 */
  }
  html.classList.add('sv-tv');

  function applySettings(s) {
    ctl.settings = s;
    ctl.matcher = SV.keys.createMatcher(s.bindings);
    ctl.hold = new SV.keys.HoldDetector({ holdMs: s.holdMs });
    html.classList.toggle('sv-hide-header', !!s.tver.hideHeader);
    html.classList.toggle('sv-hide-app-cta', !!s.tver.hideAppCta);
  }
  applySettings(ctl.settings);
  SV.settings.load().then(applySettings);
  SV.settings.onChange(applySettings);

  // 画面倍率は 1 ページ読み込みにつき 1 回、手順（SV.zoom.fit）を始める（DOMContentLoaded 後）。
  // fit は要求を順番に出し、倍率を変えたら落ち着いてからもう一度確認する。
  // 要求を同時に出したり、読み込み直後の標本だけを信じたりすると、ページ側とタブの倍率が食い違って二重に拡大されることがある。
  // data-sv-zoom: pending → done（確認まで完了）/ skipped（触らない設定・応答なし）。テストはこれを待つ。
  let zoomRequested = false;
  function requestZoom() {
    if (zoomRequested) return;
    zoomRequested = true;
    html.setAttribute('data-sv-zoom', 'pending');
    SV.zoom
      .fit({
        height: () => window.innerHeight,
        dpr: () => window.devicePixelRatio,
        request: (msg) => SV.sendMessage(msg),
      })
      .then((r) => html.setAttribute('data-sv-zoom', r && r.ok ? 'done' : 'skipped'))
      .catch(() => html.setAttribute('data-sv-zoom', 'skipped'));
  }

  // ------------------------------------------------------------------ 1b. 詳細ポップアップ（TVer 標準）

  // エピソード一覧のカードは、マウスを載せると TVer 自身が詳細（サムネイル・タイトル・配信終了・あらすじ・ボタン）を出す。
  // リモコンにはマウスがないので、フォーカスが入ったら host に mouseover、出たら mouseout を送って、同じ表示を出す。
  // 表示はサイトのもの（React が作る）。拡張は DOM を作らず、イベントを送るだけ。クラス名が変わっても、ポップアップが出ないだけで操作は変わらない。
  function sendHover(host, type) {
    host.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget: null }));
  }
  // 置きっぱなしの本物のマウス（カーソルは見えない）が、フォーカスのポップアップと食い違わないよう、本物のマウスイベントは host へ通さない。
  for (const type of ['mouseover', 'mouseout']) {
    window.addEventListener(
      type,
      (e) => {
        if (e.isTrusted && T.popupHostOf(e.target)) e.stopImmediatePropagation();
      },
      true,
    );
  }
  document.addEventListener(
    'focusin',
    (e) => {
      const host = T.popupHostOf(e.target);
      if (host) sendHover(host, 'mouseover');
    },
    true,
  );
  document.addEventListener(
    'focusout',
    (e) => {
      const host = T.popupHostOf(e.target);
      if (host && !host.contains(e.relatedTarget)) sendHover(host, 'mouseout');
    },
    true,
  );

  // ------------------------------------------------------------------ 2. キー処理

  function currentType() {
    return T.detectType(location.pathname, document);
  }

  function goBack() {
    if (location.pathname === '/' || history.length <= 1) SV.goHub();
    else history.back();
  }

  function onOk(e) {
    const a = document.activeElement;
    // リアルタイム配信のチャンネルのページ: プレイヤー（操作盤）で OK → 視聴画面（劇場表示・全画面）へ。ボタンの上の OK は、そのボタンを押す
    if (currentType() === 'live' && a && a.matches && (a.matches(T.SEL.watchHost) || a.matches(T.SEL.watchController)) && ctl.watch.begin()) {
      SV.consume(e);
      return;
    }
    if (!ctl.nav.current()) {
      SV.consume(e);
      ctl.nav.focusInitial(T.initialPrefer(currentType()));
      return;
    }
    if (a && a.closest && a.closest(T.SEL.rail)) markRailIntent(); // レールで選んだ（遷移後もレールに残る）
    // フォーカス中の通常の要素は、ブラウザ標準の Enter（クリック）に任せる
  }

  function onBack(e) {
    if (T.dialogOpen()) {
      // 開いているメニュー・ダイアログはサイトに閉じてもらう（Esc 以外のキーは Esc として渡す）
      if (e.key !== 'Escape') {
        SV.consume(e);
        const target = document.activeElement || document.body;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      }
      return;
    }
    SV.consume(e);
    clearRailIntent(); // 戻るは「レールで選んだ」遷移ではない（戻った先では最後にいた位置を復元する）
    if (!e.repeat) goBack();
  }

  // ---- 画面上のキーボード（common/osk.js）。検索ピルと、入力欄（アンケートなど）で使う

  function onOskKey(e, action) {
    if (action === 'HOME') {
      SV.consume(e);
      if (!e.repeat) {
        ctl.osk.close();
        SV.goHub();
      }
      return;
    }
    if (action && !ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    ctl.osk.handleKey(e, action);
  }

  /** React の入力欄に値を入れる（value を直接代入しても React の状態は変わらないので、input イベントで知らせる）。 */
  function setInputValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) setter.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** 入力欄にフォーカスがあるときのキー。OK でキーボードを開く。上下は欄から出る。左右は、キャレットが端にあるときだけ出る（それ以外は文字の中の移動）。 */
  function onEditableKey(e, action) {
    const el = e.target;
    if (!action) return;
    if (action === 'BACK') {
      if (e.key === 'Escape') onBack(e); // Backspace は文字を消すキーなので、触らない
      return;
    }
    if (!ctl.nav) return;
    if (action === 'OK') {
      const spec = SV.osk.inputSpec(el);
      if (!spec || e.repeat) return;
      SV.consume(e);
      ctl.osk.open({
        ...spec,
        value: el.value,
        doneLabel: '完了',
        onChange: (text) => setInputValue(el, text),
        onDone: () => el.dispatchEvent(new Event('change', { bubbles: true })),
      });
      return;
    }
    if (!SV.keys.isDirection(action) || el.tagName === 'SELECT') return;
    if (action === 'LEFT' || action === 'RIGHT') {
      const a = el.selectionStart;
      const b = el.selectionEnd;
      const len = String(el.value || '').length;
      const edge = a == null || b == null || (a === b && (action === 'LEFT' ? a === 0 : a === len));
      if (!edge) return;
    }
    if (el.tagName === 'TEXTAREA' && (action === 'UP' || action === 'DOWN')) return;
    if (!ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    SV.consume(e);
    ctl.userMoved = true;
    ctl.nav.move(DIR[action], { repeat: e.repeat });
  }

  function runSearch(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return;
    const path = T.searchPath(kw);
    const same = () => {
      try {
        return decodeURIComponent(location.pathname) === '/search/' + kw;
      } catch (err) {
        return false;
      }
    };
    const form = T.searchForm(document);
    if (!form) {
      location.assign(path);
      return;
    }
    // サイトの検索フォームに入力して送る（SPA の遷移・検索履歴もサイト任せ）。React が状態を更新するのを待ってから送る
    setInputValue(form.input, kw);
    setTimeout(() => {
      if (form.form && form.form.requestSubmit) form.form.requestSubmit();
      else if (form.form) form.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      setTimeout(() => {
        if (!same()) location.assign(path); // 送れなかったとき（サイトの作りが変わった）は、URL で直接開く
      }, 1500);
    }, 80);
  }

  function openSearchOsk() {
    ctl.osk.open({
      title: '検索',
      placeholder: '番組名・出演者で検索',
      doneLabel: '検索',
      searchIcon: true, // 入力欄の右端の検索アイコン（最上段のキーから ↑ で届く）
      onDone: runSearch,
    });
  }

  // ---- 横スクロールの行（棚）: /tv と同じ位置の規則（common/rows.js）
  //  - フォーカス中の行の見出しは、画面の上から 15% に固定する（上下で行を移るたびに、行のほうが動く）
  //  - 行の中では、先頭のカードは 1 枚目、2 枚目以降は 2 枚目の位置にフォーカスを保つ
  //  - 上下で別の行へ入るときは、その行で最後にいたカード（初めてなら先頭）へ。列は引き継がない

  const rowMemory = new WeakMap(); // 行の list → 最後にフォーカスしたカード

  function scrollRow(el, ctx) {
    const row = T.rowOf(el);
    const item = row && row.itemOf(el);
    if (!row || !item) return false;
    const dy = SV.rows.pinDelta(row.anchor.getBoundingClientRect().top, window.innerHeight);
    if (dy) window.scrollBy({ top: dy, behavior: 'auto' }); // /tv は行の移動も 1 フレーム（アニメーションなし）
    // 横は即時（アニメーション中に次の上下移動の列を測ると、ずれるため）
    const origin = row.list.getBoundingClientRect().left - row.list.scrollLeft;
    const lefts = row.items.map((li) => li.getBoundingClientRect().left - origin);
    const left = SV.rows.slotScrollLeft(row.items.indexOf(item), lefts);
    if (Math.abs(row.list.scrollLeft - left) >= 1) row.list.scrollTo({ left, behavior: 'auto' });
    return true;
  }

  function retargetRow(next, dir, from) {
    if (dir !== 'up' && dir !== 'down') return next;
    // リアルタイム配信のチャンネルのページ: プレイヤーは大きく、幾何だけではタブからも説明の下からも飛ばされるので、上のタブ ↓・下の説明 ↑ はプレイヤーへ
    if (currentType() === 'live') {
      const pl = document.querySelector(T.SEL.watchController);
      if (pl && pl !== from && !pl.contains(from)) {
        const pr = pl.getBoundingClientRect();
        const fr = from.getBoundingClientRect();
        if (dir === 'down' && fr.bottom <= pr.top + 1) return pl;
        if (dir === 'up' && fr.top >= pr.bottom - 1 && !from.closest(T.SEL.timeline)) return pl;
      }
    }
    // 検索ピル（固定の上部バー）へは、そこより上に別の候補がないときだけ。行が上へ流れて隠れたあとは、ピルが幾何的に一番近くなってしまい、
    // 前の行・ビルボードへ戻れなくなる。流れの中で上にある候補があれば、そちらを先に選ぶ。
    if (dir === 'up' && next.hasAttribute('data-sv-search')) {
      const top = from.getBoundingClientRect().top;
      const above = ctl.nav.collect().filter((c) => c.region === 'content' && !c.el.hasAttribute('data-sv-search') && c.rect.bottom <= top + 1);
      const here = ctl.nav.collect().find((c) => c.el === from);
      const best = here && above.length ? SV.nav.pickNext('up', here.rect, above) : null;
      if (best) next = best.el;
    }
    const to = T.rowOf(next);
    if (!to) return next;
    const cur = T.rowOf(from);
    if (cur && cur.list === to.list) return next;
    const remembered = rowMemory.get(to.list);
    if (remembered && remembered.isConnected) return remembered;
    const first = to.items[0];
    return (first && (first.querySelector(T.SEL.card) || first.querySelector('a[href], button'))) || next;
  }

  // ---- ビルボード（注目作品）: 自動で回るスライダー。座標ナビだけでは、見えないスライドへ飛び、リングも見えなくなる。
  //  - ← → はスライドを 1 枚ずつ（ループする: 最後 → 最初、最初 → 最後）
  //  - **目標は 1 つ**: フォーカスしているスライド（フォーカスはキーで同期的に動く）。スライダーは「そこへ最短で回る」だけ（go は冪等。
  //    回転中に何度呼んでもよく、最後の目標に必ず着く）。選択ボタンの click は前向きにしか回らず、回転中は捨てられるので使わない（橋が無いときの保険のみ）
  //  - どの経路でスライドにフォーカスが来ても、そのスライドを表示位置へ回す（onFocus → selectBillboard）
  //  - フォーカスがビルボードにある間は自動送りを止める（カーソルが勝手に動かない）。出たら再開する
  //    橋が無く止められないときは、自動送りで別のスライドになったらフォーカスも追う（見ているものに Enter が効く）

  const BB_PAUSE_WHILE_FOCUSED = true; // フォーカスがある間、自動送りを止める（false: 自動送りに追従する）
  const BB_USER_MS = 1500; // 最後のキー操作からこの間は「操作中」（自動送り・遅れて届いた表示の更新より、フォーカスを優先する）
  const BB_REPEAT_MS = 180; // 押しっぱなしのとき、ビルボードの送りはこの間隔まで（回転が 500ms かかるので、12回/秒で走らせない）
  const bbc = { lastKeyAt: 0, lastStepAt: 0, paused: false, following: false, obs: null, obsFor: null, retry: 0, reconcile: 0 };

  function selectBillboard(el) {
    if (!(el && el.closest && el.closest(T.SEL.billboardLink))) {
      resumeBillboard(); // ビルボードの外へ出た: 自動送りを再開
      return;
    }
    const bb = T.billboard();
    const i = bb ? bb.indexOf(el) : -1;
    if (i < 0) return;
    if (!bbc.following) bbc.lastKeyAt = Date.now(); // 自動送りへの追従は「操作」ではない
    if (bb.go(i) === 'click') armBbRetry(); // 冪等
    pauseBillboard(bb);
    armReconcile();
  }

  /** 橋が無いときの保険: 選択ボタンの click は回転中に捨てられるので、表示が追いつくまで 250ms ごとに押し直す（最大 4 秒）。 */
  function armBbRetry() {
    if (bbc.retry) return;
    const t0 = Date.now();
    bbc.retry = setInterval(() => {
      const bb = T.billboard();
      const i = bb ? bb.indexOf(document.activeElement) : -1;
      if (!bb || i < 0 || bb.activeIndex() === i || Date.now() - t0 > 4000) {
        clearInterval(bbc.retry);
        bbc.retry = 0;
        return;
      }
      bb.go(i);
    }, 250);
  }

  function stepBillboard(delta, e) {
    const bb = T.billboard();
    const i = bb ? bb.indexOf(document.activeElement) : -1;
    if (i < 0) return false;
    const n = bb.links.length;
    if (n < 2) return false;
    const now = Date.now();
    if (e && e.repeat && now - bbc.lastStepAt < BB_REPEAT_MS) return true; // 押しっぱなし: 間引く（キーは消費する）
    bbc.lastStepAt = now;
    ctl.nav.focusElement(bb.links[(i + delta + n) % n], {}); // → onFocus → selectBillboard → go
    return true;
  }

  function pauseBillboard(bb) {
    if (!BB_PAUSE_WHILE_FOCUSED) return;
    if (bb.pause(true)) bbc.paused = true; // 冪等（状態は橋の側にある）
  }

  function resumeBillboard() {
    if (!bbc.paused) return;
    bbc.paused = false;
    const bb = T.billboard();
    if (bb) bb.pause(false); // 停止から 600ms 以内なら、橋が待ってから再開する
  }

  /** go のあと、表示が追いつかなかった（橋が壊れた・外から動かされた）ときの安全網。操作中の窓が閉じたあとに 1 回だけ確認する。 */
  function armReconcile() {
    clearTimeout(bbc.reconcile);
    bbc.reconcile = setTimeout(followBillboard, BB_USER_MS + 100);
  }

  /** スライダーの表示（選択ボタンの active）が、フォーカスと食い違ったときの調停。表示が変わるたびに呼ぶ（ポーリングはしない）。 */
  function followBillboard() {
    if (T.isPlayerPage(currentType())) return; // 再生ページにはビルボードがない（無駄な検索をしない）
    const bb = T.billboard();
    if (!bb) return;
    const act = bb.activeIndex();
    const i = bb.indexOf(document.activeElement);
    if (act < 0 || i < 0 || i === act) return;
    if (Date.now() - bbc.lastKeyAt < BB_USER_MS) {
      if (bb.go(i) === 'click') armBbRetry(); // 操作中: 食い違いは表示のほうが古い（または自動送りが重なった）。フォーカスの勝ち
      return;
    }
    bbc.following = true;
    ctl.nav.focusElement(bb.links[act], {}); // 操作していない: 自動送り・マウスで別のスライドになった。フォーカスも追う
    bbc.following = false;
  }

  /** スライダーの選択ボタンの class（active）が変わるたびに followBillboard を呼ぶ。ボタンの親が差し替わったら付け直す。 */
  function watchBillboard() {
    const sel = document.querySelector(T.SEL.billboardSelector);
    const host = sel && sel.parentElement;
    if (host === bbc.obsFor) return;
    if (bbc.obs) bbc.obs.disconnect();
    bbc.obs = null;
    bbc.obsFor = host;
    if (!host) return;
    bbc.obs = new MutationObserver(followBillboard);
    bbc.obs.observe(host, { attributes: true, attributeFilter: ['class', 'data-active'], subtree: true });
  }

  function onKeyDown(e) {
    if (SV.keys.shouldIgnore(e)) return;
    const space = e.key === ' ';
    const action = ctl.matcher.match(e);
    if (ctl.osk && ctl.osk.isOpen()) return onOskKey(e, action); // 画面上のキーボードが開いている間は、すべてそちらが受ける
    const watching = !!(ctl.watch && ctl.watch.active());
    if (!action && !(space && watching)) return;

    if (action === 'HOME') {
      SV.consume(e);
      if (!e.repeat) SV.goHub();
      return;
    }
    if (SV.keys.isEditable(e.target)) {
      onEditableKey(e, action);
      return;
    }

    if (action === 'BACK' && ctl.settings.holdBackToHome && ctl.hold.feed('BACK', e)) {
      SV.consume(e);
      SV.goHub();
      return;
    }
    if (action && !ctl.gate.allow(action, e)) {
      SV.consume(e);
      return;
    }
    if (!ctl.nav || !ctl.watch) return; // まだ初期化前（DOM 構築中）

    // 視聴画面（TVer のプレイヤーが再生中）は、視聴画面が最優先。サイトのモーダルが開いているときなどは false が返り、通常の処理に進む
    if (watching && ctl.watch.handleKey(e, space ? 'PLAY_PAUSE' : action)) return;

    if (SV.keys.isDirection(action)) {
      SV.consume(e);
      ctl.hadFocus = true;
      ctl.userMoved = true;
      if ((action === 'LEFT' || action === 'RIGHT') && stepBillboard(action === 'LEFT' ? -1 : 1, e)) return;
      ctl.nav.move(DIR[action], { repeat: e.repeat });
      return;
    }
    if (action === 'OK') return onOk(e);
    if (action === 'BACK') return onBack(e);
    if (action === 'PLAY_PAUSE' || action === 'PLAY') {
      // 再生前のページでは、再生ボタン（TVer 自身のポスターのボタン）を押す
      const poster = T.isPlayerPage(currentType()) ? document.querySelector(T.SEL.posterPlay) : null;
      if (poster) {
        SV.consume(e);
        poster.click();
      }
    }
  }

  function onKeyUp(e) {
    const action = ctl.matcher.match(e);
    if (ctl.osk && ctl.osk.isOpen() && (action === 'OK' || e.key === ' ')) {
      SV.consume(e); // 押したキーのボタンが、離した時に二重に押されない
      return;
    }
    if (action === 'BACK') ctl.hold.release('BACK');
    // 視聴画面では OK / Space の keydown を横取りしている。keyup だけがボタンに届いて、押した扱いにならないようにする
    if (ctl.watch && ctl.watch.active() && (action === 'OK' || e.key === ' ') && !SV.keys.shouldIgnore(e) && !SV.keys.isEditable(e.target)) SV.consume(e);
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  // ------------------------------------------------------------------ 3. 遷移・初期化

  function whenSettled(cb, quietMs, maxMs) {
    let called = false;
    let timer = null;
    const done = () => {
      if (called) return;
      called = true;
      obs.disconnect();
      clearTimeout(timer);
      clearTimeout(cap);
      cb();
    };
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quietMs);
    });
    obs.observe(document.body || html, { childList: true, subtree: true });
    timer = setTimeout(done, quietMs);
    const cap = setTimeout(done, maxMs);
  }

  function debounce(fn, ms) {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  /**
   * 左レール: サイトの「展開」状態のまま使い（項目が横並び）、折りたたみ表示・展開表示は tver.css（:focus-within）で切り替える。
   * サイトのハンバーガーを何度も click() すると再描画でカクつくので、折りたたまれていたときに一度だけ展開する。
   */
  function ensureRailExpanded() {
    if (ctl.railChecked) return;
    const nav = document.querySelector(T.SEL.rail);
    if (!nav) return;
    ctl.railChecked = true;
    if (!nav.matches(T.SEL.navExpanded)) {
      const btn = document.querySelector(T.SEL.hamburger);
      if (btn) btn.click();
    }
  }

  /** いまのページに対応するレールの項目（なければ先頭）にフォーカスする。 */
  function focusRailCurrent() {
    const nav = document.querySelector(T.SEL.rail);
    if (!nav) return false;
    const links = Array.from(nav.querySelectorAll('a[href]')).filter((a) => !T.isExcluded(a) && a.getBoundingClientRect().width > 0);
    const hit = links.find((a) => (a.getAttribute('href') || '').replace(/\/+$/, '') === railHref()) || links[0];
    if (!hit) return false;
    ctl.nav.focusElement(hit, {});
    return true;
  }

  /** レールで項目を選んで遷移したあとは、フォーカスをレールに残す（内容へは → で入る）。 */
  function railIntentActive() {
    if (ctl.railIntentUntil && Date.now() < ctl.railIntentUntil) return true;
    try {
      const t = Number(sessionStorage.getItem('sv.railNav') || 0);
      if (t && Date.now() - t < 15000) return true;
    } catch (e) {
      /* 無視 */
    }
    return false;
  }

  function markRailIntent() {
    ctl.railIntentUntil = Date.now() + 15000;
    try {
      sessionStorage.setItem('sv.railNav', String(Date.now()));
    } catch (e) {
      /* 無視 */
    }
  }

  function clearRailIntent() {
    ctl.railIntentUntil = 0;
    try {
      sessionStorage.removeItem('sv.railNav');
    } catch (e) {
      /* 無視 */
    }
  }

  /** レールから → で内容へ入るとき、遷移直後は「そのページの最初の要素」（初期フォーカスと同じ）を選ぶ。 */
  function contentEntry(pool) {
    if (!ctl.freshRoute) return null;
    const vp = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    for (const sel of T.initialPrefer(currentType())) {
      const hits = pool.filter((c) => c.el.matches(sel));
      if (hits.length) return SV.nav.pickInitial(hits, vp) || hits[0];
    }
    return SV.nav.pickInitial(pool, vp);
  }

  // 上部バーの「検索」ピル（/tv の左上と同じ位置）。TVer の検索は文字入力が要るので、リモコンで使える「さがす」ページ（目的・ジャンルから探す）を開く。
  // 開くときはサイトの「さがす」リンクを押す（ページ全体を読み込み直さず、SPA の遷移で開く）。
  function ensureTopBar() {
    const mainEl = document.querySelector('main');
    const host = (mainEl && mainEl.parentElement) || document.getElementById('__next') || document.body; // アプリ全体は #__next の中で重なり順が閉じている（isolation）。ロゴ（ヘッダー）より下、ビルボードより上に置くには同じ中に入れる
    if (!host || document.getElementById('sv-topbar')) return;
    const bar = document.createElement('div');
    bar.id = 'sv-topbar';
    const a = document.createElement('a');
    a.className = 'sv-search';
    a.href = '/search';
    a.textContent = '検索';
    a.setAttribute('data-sv-search', '1');
    a.addEventListener('click', (e) => {
      e.preventDefault();
      openSearchOsk(); // 文字入力は画面上のキーボードで（「さがす」ページは左のレールから）
    });
    bar.appendChild(a);
    if (mainEl && mainEl.parentElement === host) mainEl.after(bar); // nav の兄弟にして、レールの押し出しを :has() なしの兄弟セレクタで書く
    else host.appendChild(bar);
  }

  function setupPage() {
    html.setAttribute('data-sv-page', currentType()); // 描画後に URL だけでは分からなかった種別が分かることがある
    ensureTopBar();
    ensureRailExpanded();
    watchBillboard();
  }

  /**
   * 遷移後の初期フォーカス。描画が遅れて候補がまだないときは false を返し、DOM の変化のたびに再試行する。
   * - 戻る・再訪で記憶があれば、その要素の復元を待つ（4 秒まで）
   * - 操作を始めた後は奪わない
   * - コンテンツ領域（main の内側）の候補が現れるまでレールにはフォーカスしない
   */
  function tryInitial() {
    if (ctl.initialDone) return true;
    const age = Date.now() - ctl.routeStartedAt;
    if (ctl.watch.active() || ctl.userMoved || age > 10000) {
      ctl.initialDone = true;
      return true;
    }
    if (railIntentActive()) {
      // レールで選んで来た: フォーカスはレールに残す（なければレールへ戻す）。内容へは → で入る
      const a = document.activeElement;
      if (!(a && a.closest && a.closest(T.SEL.rail)) && !focusRailCurrent()) return false;
      ctl.initialDone = true;
      return true;
    }
    if (ctl.nav.restore(ctl.routeKey)) {
      ctl.initialDone = true;
      return true;
    }
    if (ctl.nav.hasMemory(ctl.routeKey) && age < 4000) return false;
    // 4 秒までは main の内側の候補を待つ。それを過ぎたら main の外でもよい（main のないページ・構造が変わったときの保険）
    if (ctl.nav.focusInitial(T.initialPrefer(currentType()), { requireRegion: 'content', within: age < 4000 ? T.SEL.main : null })) {
      ctl.initialDone = true;
      return true;
    }
    return false;
  }

  function onRoute() {
    const next = location.pathname + location.search;
    if (next === ctl.routeKey) return;
    ctl.routeKey = next;
    if (ctl.watch) ctl.watch.reset();
    ctl.hadFocus = false;
    ctl.userMoved = false;
    ctl.initialDone = false;
    ctl.freshRoute = true;
    bbc.paused = false; // 遷移: ビルボードのインスタンスは作り直される（橋の側の停止状態も破棄される）
    ctl.routeStartedAt = Date.now();
    html.setAttribute('data-sv-page', currentType());
    whenSettled(() => {
      setupPage();
      tryInitial();
      ctl.hadFocus = true;
    }, 250, 4000);
  }

  function railHref() {
    return location.pathname.replace(/\/+$/, '') || '/';
  }

  function init() {
    // ダークテーマの保険（サイトの初期化スクリプトが light にした場合）
    if (!html.classList.contains('dark')) {
      html.classList.remove('light');
      html.classList.add('dark');
    }

    ctl.nav = SV.nav.createNavigator({
      // 検索ピルは、main に操作できるものが描画されてから候補にする（描画前は、ピルが唯一のコンテンツ候補になって初期フォーカスを奪う）
      exclude: (el) => SV.nav.defaultExclude(el) || T.isExcluded(el) || (el.hasAttribute('data-sv-search') && !document.querySelector('main a[href], main button')),
      regionOf: T.regionOf,
      crossRegion: { content: { left: 'rail' }, rail: { right: 'content' } },
      prefer: {
        rail: (pool) => pool.find((c) => (c.el.getAttribute('href') || '') === railHref()) || null,
        content: contentEntry,
      },
      scroll: scrollRow,
      retarget: retargetRow,
      onFocus: (el) => {
        ctl.hadFocus = true;
        selectBillboard(el);
        const row = T.rowOf(el);
        if (row) rowMemory.set(row.list, el);
        if (T.regionOf(el) !== 'rail') {
          ctl.freshRoute = false;
          clearRailIntent();
        }
        if (ctl.routeKey) ctl.nav.remember(ctl.routeKey);
      },
    });

    // 視聴画面: TVer 自身のプレイヤー（操作盤・全画面）を /tv の見た目と操作にする（sites/tver/watch.js）
    ctl.osk = SV.osk.create({ document });
    ctl.watch = SV.watch.create({
      isPlayerPage: () => T.isPlayerPage(currentType()),
      browseFirst: () => currentType() === 'live',
      nativeFullscreen: () => ctl.settings.tver.nativeFullscreen,
      goBack,
    });
    setInterval(() => ctl.watch.sync(), 250); // 再生の開始・終了、広告、ポップアップの開閉は DOM の変化でも拾うが、取りこぼしても追いつくように

    // 遷移の検知（Navigation API があれば使い、なければ polling で補う）
    if (window.navigation && window.navigation.addEventListener) {
      window.navigation.addEventListener('navigatesuccess', () => setTimeout(onRoute, 0));
    }
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    setInterval(onRoute, 500);
    setInterval(followBillboard, 1000); // 保険（通常は選択ボタンの class の変化を MutationObserver で見る）

    // DOM が差し替わったとき: 視聴画面の開始・終了の検知、フォーカス喪失からの復帰
    const syncWatch = debounce(() => ctl.watch.sync(), 60);
    const onMutate = debounce(() => {
      setupPage();
      if (!ctl.initialDone) {
        tryInitial();
        return;
      }
      if (ctl.watch.active() || !ctl.hadFocus || T.dialogOpen()) return;
      const a = document.activeElement;
      if (!a || a === document.body || a === html) {
        if (railIntentActive() && focusRailCurrent()) return;
        if (!ctl.nav.restore(ctl.routeKey)) ctl.nav.focusInitial(T.initialPrefer(currentType()));
      }
    }, 250);
    new MutationObserver(() => {
      syncWatch();
      onMutate();
    }).observe(document.body, { childList: true, subtree: true });

    html.setAttribute('data-sv-ready', '1');
    requestZoom();
    onRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
