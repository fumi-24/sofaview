// Spotify の再生中の画面: 状態の判定（純粋なロジック）。
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/common/sv.js');
const core = require('../../extension/sites/spotify/core.js');
const np = { ...core };

const base = { loggedOut: false, hasTrack: false, ready: true, drm: true };

test('状態: 曲があれば track。曲がなければ、読み込み中・再生できない・待機中の順に、理由を分ける', () => {
  assert.equal(np.statusOf({ ...base, hasTrack: true }), 'track');
  assert.equal(np.statusOf({ ...base, ready: false }), 'loading');
  assert.equal(np.statusOf({ ...base, drm: false }), 'noDrm');
  assert.equal(np.statusOf({ ...base, drm: true }), 'idle');
});

test('状態: 保護機能の確認中（null）は、待機中として扱う（確認が終わるまで、再生できないと決めつけない）', () => {
  assert.equal(np.statusOf({ ...base, drm: null }), 'idle');
});

test('状態: ログインしていなければ、曲があっても読み込み中でも loggedOut（ログインが先）', () => {
  assert.equal(np.statusOf({ ...base, loggedOut: true }), 'loggedOut');
  assert.equal(np.statusOf({ ...base, loggedOut: true, hasTrack: true, ready: false }), 'loggedOut');
});

test('状態の画面の文言: loggedOut は OK の案内つき。idle は 3 つの手順つき。noDrm は Widevine を伝える', () => {
  assert.match(np.STATUS_TEXT.loggedOut.hint, /OK/);
  assert.equal(np.STATUS_TEXT.idle.lines.length, 3);
  assert.match(np.STATUS_TEXT.noDrm.lines.join(' '), /Widevine/);
  for (const k of ['loading', 'loggedOut', 'noDrm', 'idle', 'noEngine']) assert.ok(np.STATUS_TEXT[k].head.length > 0, k);
});

test('秒の表示は m:ss（サイトの表示と同じ形）', () => {
  assert.equal(np.fmt(0), '0:00');
  assert.equal(np.fmt(9.9), '0:09');
  assert.equal(np.fmt(175.797), '2:55');
  assert.equal(np.fmt(3600), '60:00');
  assert.equal(np.fmt(-3), '0:00');
});

test('歌詞のいまの行: 開始時刻（ミリ秒）と再生位置から決まる。最初の行の前は -1。時刻のない歌詞は出さない', () => {
  const L = [0, 20000, 40000, 60000].map((start, i) => ({ text: '行' + i, start }));
  assert.equal(np.lyricsAt(L, 0, 200, -1).cur, 0);
  assert.equal(np.lyricsAt(L, 19.9, 200, -1).cur, 0);
  assert.equal(np.lyricsAt(L, 20, 200, 0).cur, 1);
  assert.equal(np.lyricsAt(L, 50, 200, -1).cur, 2);
  assert.equal(np.lyricsAt(L, 500, 200, 1).cur, 3, '最後の行のまま');
  assert.equal(np.lyricsAt(L, 10, 200, 3).cur, 0, '前へ戻したとき（シーク）も追える');
  assert.equal(np.lyricsAt([{ text: 'a', start: 5000 }, { text: 'b', start: 9000 }], 2, 200, -1).cur, -1, '最初の行の前');
  assert.deepEqual(np.lyricsAt(L, 50, 200, -1).lines, ['行0', '行1', '行2', '行3']);
  assert.equal(np.lyricsAt([{ text: 'a', start: 0 }, { text: 'b', start: 0 }], 5, 200, -1), null, '時刻のない歌詞');
  assert.deepEqual(np.lyricsAt([{ text: 'a', start: 9000 }, { text: 'b', start: 3000 }], 12, 200, -1), { lines: ['a', 'b'], cur: 1 }, '順に増えなくても捨てない（逆転は、それまでの最大に合わせる）');
  assert.equal(np.lyricsAt([], 5, 200, -1), null);
  // 値が秒の場合（曲の長さ以下の値ばかり）
  const S = [0, 20, 40, 60].map((start, i) => ({ text: '行' + i, start }));
  assert.equal(np.lyricsAt(S, 50, 200, -1).cur, 2, '秒とみなす');
});

test('歌詞のいまの行: 時刻のない行・少しの逆転があっても、歌詞全体は捨てない。半分以上に時刻がなければ出さない', () => {
  const L = [{ text: '前奏', start: undefined }, { text: 'a', start: 5000 }, { text: '', start: null }, { text: 'b', start: 4000 }, { text: 'c', start: 20000 }];
  const r = np.lyricsAt(L, 6, 200, -1);
  assert.deepEqual(r.lines, ['前奏', 'a', '', 'b', 'c']);
  assert.equal(r.cur, 3, '逆転した行（b: 4000）は、それまでの最大（5000）に合わせる。6 秒の時点では、b の行');
  assert.equal(np.lyricsAt(L, 25, 200, -1).cur, 4);
  assert.equal(np.lyricsAt([{ text: 'a' }, { text: 'b' }, { text: 'c', start: 100 }], 5, 200, -1), null, '時刻のある行が半分に満たない');
});

test('再生位置: 届いた位置から、再生中は経過時間で進め、一時停止中は進めない。曲の長さを超えない', () => {
  const st = (playing) => ({ at: 1000, info: { positionSec: 50, durationSec: 100, playing } });
  assert.equal(np.positionNow(st(true), 1000), 50);
  assert.equal(np.positionNow(st(true), 4500), 53.5);
  assert.equal(np.positionNow(st(false), 9000), 50);
  assert.equal(np.positionNow(st(true), 500000), 100, '長さまで');
  assert.equal(np.positionNow({ at: 0, info: { positionSec: null } }, 5), null);
  assert.equal(np.positionNow(null, 5), null);
});

test('歌詞の位置の補正: 差のサンプルが安定しているときだけ、その中央値を打ち消す。±5 秒まで。ばらつくときは決めない', () => {
  assert.equal(np.lyricShift([-3.1, -3.0, -3.05]), 3.1, "中央値 3.05 を 0.1 秒に丸める");
  assert.equal(np.lyricShift([0.2, 0.25, 0.22]), -0.2, 'アプリの位置が少し進んでいれば、歌詞を少し戻す');
  assert.equal(np.lyricShift([-9, -9.1, -9.05]), 5, '±5 秒まで');
  assert.equal(np.lyricShift([0, 0, 0]), 0);
  assert.equal(np.lyricShift([-3, -2, -4]), null, 'ばらつくとき');
  assert.equal(np.lyricShift([-3, -3]), null, '3 個未満');
  assert.equal(np.lyricShift([]), null);
});
