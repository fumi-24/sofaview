// Spotify の再生中の画面: 状態の判定（純粋なロジック）。
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../extension/common/sv.js');
const np = require('../../extension/sites/spotify/nowplaying.js');

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
  for (const k of ['loading', 'loggedOut', 'noDrm', 'idle']) assert.ok(np.STATUS_TEXT[k].head.length > 0, k);
});

test('表示名での探し方（目印がなくなったときの代わり）: 再生/一時停止・前へ・次へ・歌詞・ログインだけに当たり、カードの「〜を再生」には当たらない', () => {
  const { LABEL } = np;
  for (const n of ['再生', '一時停止', 'Play', 'pause']) assert.ok(LABEL.playPause.test(n), n);
  for (const n of ['曲Aを再生', 'Play 曲A', '再生中ビュー', '再生リスト']) assert.ok(!LABEL.playPause.test(n), n);
  for (const n of ['前へ', '前の曲', 'Previous']) assert.ok(LABEL.prev.test(n), n);
  for (const n of ['次へ', '次の曲', 'Next']) assert.ok(LABEL.next.test(n), n);
  assert.ok(LABEL.lyricsButton.test('歌詞') && LABEL.lyricsButton.test('Lyrics'));
  assert.ok(LABEL.login.test('ログイン') && LABEL.login.test('Log in') && !LABEL.login.test('ログインしてください'));
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
  assert.equal(np.lyricsAt([{ text: 'a', start: 9 }, { text: 'b', start: 3 }], 5, 200, -1), null, '順に増えない');
  assert.equal(np.lyricsAt([], 5, 200, -1), null);
  // 値が秒の場合（曲の長さ以下の値ばかり）
  const S = [0, 20, 40, 60].map((start, i) => ({ text: '行' + i, start }));
  assert.equal(np.lyricsAt(S, 50, 200, -1).cur, 2, '秒とみなす');
});
