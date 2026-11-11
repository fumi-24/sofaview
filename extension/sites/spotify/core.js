/*
 * Spotify: 自前の画面（ui.js）と、読み取り・操作（engine.js）で共有する、純粋な部分（DOM に触らない）。
 *   fmt: 秒 → m:ss    statusOf / STATUS_TEXT: 状態の画面の種類と文言    lyricsAt: 歌詞の行と再生位置から、いまの行を決める
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  /** 秒 → m:ss（サイトの表示と同じ形）。 */
  function fmt(sec) {
    const t = Math.max(0, Math.floor(sec));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  /**
   * いまの状態（画面の種類）。純粋な判定（DOM に触らない）。
   *   loggedOut: ログインしていない（曲があっても、再生できない）／loading: 読み込み中／track: 曲がある／noDrm: 再生に必要な保護機能がない／idle: スマホから再生するのを待っている
   * drm: true / false / null（まだ確認中）。
   */
  function statusOf(i) {
    if (i.loggedOut) return 'loggedOut';
    if (i.hasTrack) return 'track';
    if (!i.ready) return 'loading';
    if (i.drm === false) return 'noDrm';
    return 'idle';
  }

  /** 状態の画面に出す文言。 */
  const STATUS_TEXT = Object.freeze({
    loading: { icon: '…', head: 'Spotify を読み込んでいます', lines: [], hint: '' },
    loggedOut: {
      icon: '🔒',
      head: 'Spotify にログインしていません',
      lines: ['ログインすると、スマホの Spotify から、このテレビで再生できます', 'ログイン画面は文字入力が必要です。キーボードをつなぐか、パソコンから操作してください'],
      hint: 'OK でログイン画面を開く',
    },
    noDrm: {
      icon: '🔇',
      head: 'このブラウザでは、音楽を再生できません',
      lines: ['再生に必要な保護機能（Widevine）が、このブラウザにありません', 'Google Chrome など、Widevine のあるブラウザで開いてください'],
      hint: '',
    },
    noEngine: {
      icon: '🔌',
      head: 'Spotify のタブにつながっていません',
      lines: ['Spotify を裏のタブで開いています。少しお待ちください', 'いつまでも変わらないときは、拡張機能を再読み込みしてください'],
      hint: '',
    },
    idle: {
      icon: '📱',
      head: 'スマホの Spotify から、再生してください',
      lines: ['① スマホで Spotify を開いて、曲を再生する', '② 再生画面の下の「デバイスに接続」を押す', '③ 一覧から、「Web Player」と書かれたこのブラウザを選ぶ'],
      hint: '戻る　Spotify の画面で、曲を探す',
    },
  });

  /**
   * 歌詞。Spotify の React の部品の木から、行の文字と開始時刻を読む（react-main.js。画面の要素・色には頼らない）。
   * いまの行は、再生位置（メディアセッション）と開始時刻を比べて決める。
   *   lines: [{ text, start }]（start は ミリ秒。曲の長さより小さい値ばかりなら、秒とみなす）  positionSec / durationSec: 秒
   * 返す: { lines: [文字], cur: いまの行の位置（まだ最初の行の前なら -1） }。時刻が付いていない（順に増えない）歌詞は null（そのときは歌詞を出さない）。
   */
  function lyricsAt(lines, positionSec, durationSec, hint) {
    if (!lines || !lines.length) return null;
    // 時刻のない行（空行・合間の記号など）は、直前の行の時刻とみなす。少しの逆転（訳の行など）は、それまでの最大に合わせる（1 行のために歌詞全体を捨てない）
    const starts = [];
    let run = 0;
    let finite = 0;
    for (const l of lines) {
      if (Number.isFinite(l.start)) {
        finite++;
        run = Math.max(run, l.start);
      }
      starts.push(run);
    }
    if (finite < Math.ceil(lines.length / 2) || run <= 0) return null; // 時刻のない歌詞（行の半分以上に時刻がない・すべて 0）
    const max = run;
    const unit = durationSec > 0 && max <= durationSec + 5 ? 1 : 1000; // 秒か、ミリ秒か
    const t = positionSec == null ? 0 : positionSec * unit;
    // いまの行 = 開始時刻が t 以下の、最後の行。前回の位置から探す（ほとんど同じか次の行）
    let cur = Math.max(-1, Math.min(starts.length - 1, hint == null ? -1 : hint));
    while (cur >= 0 && starts[cur] > t) cur--;
    while (cur + 1 < starts.length && starts[cur + 1] <= t) cur++;
    return { lines: lines.map((l) => l.text), cur };
  }

  /** 再生位置（秒）を、いまの時刻まで進める。state は Spotify のタブが送ってきた状態（info.positionSec・info.playing・at）。 */
  function positionNow(state, now) {
    const i = state && state.info;
    if (!i || i.positionSec == null) return null;
    const t = i.positionSec + (i.playing ? ((now - state.at) / 1000) : 0);
    return Math.min(i.durationSec > 0 ? i.durationSec : Infinity, Math.max(0, t));
  }

  SV.spotifyCore = { fmt, statusOf, STATUS_TEXT, lyricsAt, positionNow };
  if (typeof module === 'object' && module.exports) module.exports = SV.spotifyCore;
})(typeof self !== 'undefined' ? self : globalThis);
