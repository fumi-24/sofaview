'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zoom = require('../../extension/common/zoom.js');

test('1080p はビューポート高さ 720 になる 1.5 倍', () => {
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1 }), 1.5);
});

test('2160p（DPR 1）は 3 倍', () => {
  assert.equal(zoom.compute({ innerHeight: 2160, currentZoom: 1 }), 3);
});

test('すでに 720 前後なら 1 倍（触らない）', () => {
  assert.equal(zoom.compute({ innerHeight: 720, currentZoom: 1 }), 1);
  assert.equal(zoom.compute({ innerHeight: 700, currentZoom: 1 }), 1);
});

test('小さい画面では縮小しない（最小 1 倍）', () => {
  assert.equal(zoom.compute({ innerHeight: 540, currentZoom: 1 }), 1);
});

test('最大 4 倍に制限', () => {
  assert.equal(zoom.compute({ innerHeight: 8000, currentZoom: 1 }), 4);
});

test('適用済みの倍率でも同じ結果になる（冪等）', () => {
  // 1080p を 1.5 倍にした後は innerHeight が 720 になる
  assert.equal(zoom.compute({ innerHeight: 720, currentZoom: 1.5 }), 1.5);
  assert.equal(zoom.compute({ innerHeight: 1440 / 2, currentZoom: 3 }), 3);
});

test('OS 側のスケール（DPR）で CSS 高さが 1080 の 4K でも 1.5 倍', () => {
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1 }), 1.5);
});

test('mode=off は null、mode=fixed は指定倍率', () => {
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1, mode: 'off' }), null);
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1, mode: 'fixed', factor: 1.25 }), 1.25);
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1, mode: 'fixed', factor: 99 }), 5);
});

test('targetHeight を変えられる', () => {
  assert.equal(zoom.compute({ innerHeight: 1080, currentZoom: 1, targetHeight: 540 }), 2);
});

test('innerHeight が 0 のときは null', () => {
  assert.equal(zoom.compute({ innerHeight: 0, currentZoom: 1 }), null);
});

test('shouldApply は小さな差を無視する', () => {
  assert.equal(zoom.shouldApply(1.5, 1.5), false);
  assert.equal(zoom.shouldApply(1.5, 1.52), false);
  assert.equal(zoom.shouldApply(1, 1.5), true);
  assert.equal(zoom.shouldApply(1, null), false);
});

// ---- 読み込み直後の標本の食い違い（実際に起きた不具合）と、確認手順 fit ----

test('isConsistent: DPR ÷ タブの倍率（OS の表示倍率）が 1 未満に大きくずれる標本は矛盾', () => {
  assert.equal(zoom.isConsistent(1, 1.5), false); // ページ側が 1 倍のまま、タブは 1.5 倍
  assert.equal(zoom.isConsistent(1.5, 1.5), true);
  assert.equal(zoom.isConsistent(2, 1.5), true); // OS の表示倍率 2 の画面では見分けられない（fit の確認で直す）
  assert.equal(zoom.isConsistent(1, 1), true);
  assert.equal(zoom.isConsistent(0, 1.5), true); // DPR が分からなければ判定しない
});

/**
 * 時間（仮想）とページ・タブの倍率を模した世界。
 * 倍率を変えると、ページ側（innerHeight）は lag ミリ秒遅れて追いつく。
 * staleMs > 0 なら、読み込み直後はページ側が 1 倍のまま、その時間が過ぎてからタブの倍率に追いつく。
 */
function world({ browserZoom, screenH = 1080, osScale = 1, lag = 40, staleMs = 0, mode = 'auto' }) {
  let t = 0;
  const events = [];
  const w = { browserZoom, rendererZoom: staleMs > 0 ? 1 : browserZoom, requests: [], appliedZooms: [] };
  const follow = (ms) => events.push({ at: t + ms, fn: () => { w.rendererZoom = w.browserZoom; } });
  if (staleMs > 0) follow(staleMs);
  w.env = {
    now: () => t,
    async sleep(ms) {
      t += ms;
      for (const e of events.filter((x) => x.at <= t).sort((a, b) => a.at - b.at)) {
        events.splice(events.indexOf(e), 1);
        e.fn();
      }
    },
    height: () => Math.round(screenH / osScale / w.rendererZoom),
    dpr: () => osScale * w.rendererZoom,
    async request(msg) {
      w.requests.push(msg);
      if (mode !== 'auto') return { ok: true, mode, applied: false };
      const current = w.browserZoom;
      if (!msg.settled && !zoom.isConsistent(msg.dpr, current)) return { ok: true, mode, current, target: null, applied: false, stale: true };
      const target = zoom.compute({ innerHeight: msg.innerHeight, currentZoom: current });
      if (!zoom.shouldApply(current, target)) return { ok: true, mode, current, target, applied: false };
      w.browserZoom = target;
      w.appliedZooms.push(target);
      follow(lag);
      return { ok: true, mode, current, target, applied: true };
    },
  };
  return w;
}

test('fit: 初回（1 倍）は 1.5 倍にして、落ち着いてから確認する（要求は 2 回）', async () => {
  const w = world({ browserZoom: 1 });
  await zoom.fit(w.env);
  assert.equal(w.browserZoom, 1.5);
  assert.equal(w.rendererZoom, 1.5);
  assert.deepEqual(w.appliedZooms, [1.5]);
  assert.deepEqual(w.requests.map((r) => r.settled), [false, true]);
});

test('fit: すでに 1.5 倍のページは触らない', async () => {
  const w = world({ browserZoom: 1.5 });
  await zoom.fit(w.env);
  assert.deepEqual(w.appliedZooms, []);
  assert.equal(w.browserZoom, 1.5);
});

test('fit: 読み込み直後にページ側が遅れていても（矛盾を検出できる画面）2.25 倍にしない', async () => {
  // 実際に起きた不具合: タブは 1.5 倍なのに、ページの innerHeight は 1080（1 倍）のまま要求が出た → 2.25 倍になっていた
  const w = world({ browserZoom: 1.5, staleMs: 120 });
  await zoom.fit(w.env);
  assert.deepEqual(w.appliedZooms, [], '一度も倍率を変えない');
  assert.equal(w.browserZoom, 1.5);
  assert.equal(w.requests[0].innerHeight, 1080, '最初の標本は確かに古かった');
});

test('fit: 矛盾を検出できない標本（OS の表示倍率 2）で誤って拡大しても、確認で 1.5 倍に直る', async () => {
  const w = world({ browserZoom: 1.5, osScale: 2, screenH: 2160, staleMs: 600 }); // 4K・OS の表示倍率 200%（CSS では高さ 1080）
  await zoom.fit(w.env);
  assert.deepEqual(w.appliedZooms, [2.25, 1.5], '誤って 2.25 倍にした後、確認で 1.5 倍へ戻す');
  assert.equal(w.browserZoom, 1.5);
  assert.equal(w.rendererZoom, 1.5);
  assert.ok(w.requests.length <= 3);
});

test('fit: 触らない設定（auto 以外）や応答なしでは、1 回で終わる', async () => {
  const fixed = world({ browserZoom: 1, mode: 'fixed' });
  await zoom.fit(fixed.env);
  assert.equal(fixed.requests.length, 1);

  const w = world({ browserZoom: 1 });
  w.env.request = async () => undefined;
  assert.equal(await zoom.fit(w.env), undefined);
});

test('fit: 画面の高さが落ち着かなくても打ち切る（要求は最大 3 回）', async () => {
  const w = world({ browserZoom: 1 });
  let flip = 0;
  w.env.height = () => 700 + (flip++ % 2) * 100; // 呼ばれるたびに変わり続ける
  const t0 = Date.now();
  await zoom.fit(w.env);
  assert.ok(w.requests.length <= 3);
  assert.ok(Date.now() - t0 < 2000, '仮想時間で進むので実時間はかからない');
});
