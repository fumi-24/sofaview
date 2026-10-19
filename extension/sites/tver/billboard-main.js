/*
 * TVer ビルボード（注目作品）の橋（MAIN world・document_start）。
 *
 * ビルボードは keen-slider（loop・renderMode: custom）で、サイト自身が「次へ」「前へ」「指定位置へ」の関数を持つ。
 * ただし画面に出ている入口（選択ボタンの click）は「指定位置へ」だけで、これは**必ず前向き**に回る
 * （前のスライドへ移るには、手前の 8 枚を通って一周する）うえに、**回っている間は click が捨てられる**。
 * そこで、サイトが使っているのと同じ keen-slider のインスタンスを React の fiber から取り出し、
 * その公開 API（moveToIdx: 最短経路・回転中でも向きを変えられる）で動かす。
 *
 * 拡張側（isolated world）とは DOM イベントで話す（プリミティブ値だけ）:
 *   sv-bb-go    detail = スライド番号   → そこへ最短で回す（同じ目標へ向かい中・到着済みなら何もしない）
 *   sv-bb-pause detail = 1 | 0         → 自動送りの停止／再開（サイトの 'stop' / 'restart' イベント。冪等）
 * 結果は documentElement の data-sv-bb-ack に同期で書く（ok / none / range）。橋が使えない（none）ときは、
 * 拡張側が選択ボタンの click に戻る。
 */
(() => {
  'use strict';
  if (window.__svBbBridge) return;
  window.__svBbBridge = true;

  const html = document.documentElement;
  let cached = null;

  /** React の fiber のフックから keen-slider のインスタンス（useRef の current）を探す。 */
  function findInstance() {
    const ul = document.querySelector('ul.keen-slider');
    const start = ul || document.querySelector('[class*="BillboardList_billboard__"]');
    if (!start) return null;
    const key = Object.keys(start).find((k) => k.startsWith('__reactFiber$'));
    if (!key) return null;
    for (let fiber = start[key], depth = 0; fiber && depth < 40; fiber = fiber.return, depth++) {
      let hook = fiber.memoizedState;
      for (let i = 0; hook && typeof hook === 'object' && i < 300; hook = hook.next, i++) {
        const s = hook.memoizedState;
        const inst = s && typeof s === 'object' ? s.current : null;
        if (inst && inst.track && inst.animator && typeof inst.moveToIdx === 'function' && inst.track.details) return inst;
      }
    }
    return null;
  }

  function instance() {
    if (cached && cached.container && cached.container.isConnected && cached.track && cached.track.details) return cached;
    cached = findInstance();
    return cached;
  }

  function ack(v) {
    html.setAttribute('data-sv-bb-ack', v);
  }

  document.addEventListener('sv-bb-go', (e) => {
    const idx = Number(e.detail);
    const inst = instance();
    if (!inst) return ack('none');
    const d = inst.track.details;
    if (!Number.isInteger(idx) || idx < 0 || idx >= d.slides.length) return ack('range');
    // すでにそこへ向かっている（回転中）／そこにいる（止まっている）なら、アニメーションを作り直さない
    const a = inst.animator;
    const heading = a.active && a.targetIdx != null ? inst.track.absToRel(a.targetIdx) : d.rel;
    if (heading !== idx) inst.moveToIdx(idx);
    ack('ok');
  });

  // 自動送りの停止/再開。状態はインスタンスごとに MAIN 側で持つ（再描画でインスタンスが替わっても、拡張側が状態を取り違えない）。
  //  - サイトの 'stop' は 500ms 後にタイマーを消すので、その前に 'restart' を送ると再開が消える → 停止から 600ms 以上あけて再開する
  //  - サイト自身も 'restart'（PR 枠から別のスライドへ移るたび）や 'reset'（PR の読み込み失敗）を送って自動送りを再開する → 検知して止め直す
  const paused = new WeakMap(); // instance -> 最後に止めた時刻
  const timers = new WeakMap();
  const guarded = new WeakSet();

  function guard(inst) {
    if (guarded.has(inst)) return;
    guarded.add(inst);
    const emit = inst.emit;
    inst.emit = function (name) {
      const r = emit.apply(this, arguments);
      if ((name === 'restart' || name === 'reset') && paused.has(inst)) {
        // サイトが再開した（こちらの再開は paused から外してから送るので、ここには来ない）。タイマーが張られたあと（reset は 500ms 後）に止め直す
        clearTimeout(timers.get(inst));
        timers.set(inst, setTimeout(() => { if (paused.has(inst)) { paused.set(inst, Date.now()); emit.call(inst, 'stop'); } }, 600));
      }
      return r;
    };
  }

  document.addEventListener('sv-bb-pause', (e) => {
    const inst = instance();
    if (!inst) return ack('none');
    if (Number(e.detail)) {
      clearTimeout(timers.get(inst));
      guard(inst);
      const now = Date.now();
      if (!paused.has(inst) || now - paused.get(inst) > 1000) {
        paused.set(inst, now);
        inst.emit('stop'); // 冪等（サイトの側で l = true にするだけ）。1 秒に 1 回まで
      }
    } else if (paused.has(inst)) {
      clearTimeout(timers.get(inst));
      const wait = Math.max(0, paused.get(inst) + 600 - Date.now());
      paused.delete(inst); // 先に外す: 次の 'restart' はサイトの再開としてではなく、こちらの再開として通す
      timers.set(inst, setTimeout(() => inst.emit('restart'), wait));
    }
    ack('ok');
  });
})();
