/*
 * 視聴画面（TVer のプレイヤー）の操作ルール。youtube.com/tv の視聴画面の実測（docs/NOTES.md 3.10）をそのまま写した、DOM に触らない純粋なロジック。
 * 実際の DOM の操作は sites/tver/watch.js。ここは「どのキーで何が起きるか」だけを決める（単体テストの対象）。
 *
 * 状態（ui）:
 *   H  非表示。映像だけ。
 *   C  操作画面（タイトル・進行バー・時間・ボタン列）。focus = 'bar'（進行バー）| 'row'（ボタン列）
 *   S  スクラブ（進行バーを動かして探している間。映像は止まる。確定は OK、取り消しは 戻る/↑/↓）
 *
 * 入力は論理アクション（SV.keys のアクション名。ほかに内部の 'IDLE' = 操作画面の自動で隠すタイマー）。
 * 出力は「次の状態」と「してほしいこと」（effects）と、キーを横取りするか（consume）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  /** /tv は操作画面を最後のキーから 5.0 秒で隠す（一時停止中は隠さない）。 */
  const IDLE_MS = 5000;
  /** スクラブの 1 回の既定の幅（秒）。 */
  const STEP = 10;
  /** 押しっぱなしの加速は、キーのリピートの間隔がこれ以下のときだけ（/tv は約 100ms 以下。150〜300ms の間隔では加速しない）。 */
  const ACCEL_GAP_MS = 150;

  function initialState() {
    return { ui: 'H', focus: 'row', noSeek: false, ended: false, popup: false };
  }

  /** m:ss（1 時間以上は h:mm:ss）。/tv の表示と同じで、分は 0 埋めしない（0:19, 47:55, 1:06:01）。 */
  function fmtTime(sec) {
    let s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
    const h = Math.floor(s / 3600);
    s -= h * 3600;
    const m = Math.floor(s / 60);
    s -= m * 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  /*
   * 押しっぱなしの加速。/tv で実測（キーのリピートの間隔が約 100ms 以下のとき）:
   *   最初の 14 回は 10 秒ずつ。その後は上限（長さの約 0.55 乗に比例。18.5 分の動画で約 41 秒、66 分で約 81 秒）へなだらかに近づく。
   * 進み方（上限に対する割合）は、2 つの動画でほぼ同じ曲線だった（18.5 分: 12, 15, 17, 19, 21, 23, 24, 26, 27, 29, 30, 31, 32, 33, 34, 35, 36, 37…）。
   */
  const ACCEL_AFTER = 14;
  const CURVE = [0, 0.07, 0.155, 0.225, 0.296, 0.352, 0.408, 0.465, 0.52, 0.563, 0.606, 0.648, 0.69, 0.718, 0.746, 0.789, 0.817, 0.831, 0.859, 0.887, 0.901, 0.93, 0.944, 0.958, 0.972, 0.986, 1];

  function stepCap(duration) {
    const d = Number.isFinite(duration) && duration > 0 ? duration : 1110;
    return Math.max(2 * STEP, 41 * Math.pow(d / 1110, 0.55));
  }

  /** 連続して押した回数（1 始まり）。前のキーからの間隔が長ければ 1 に戻る。 */
  function nextCount(n, gapMs) {
    return n > 0 && gapMs <= ACCEL_GAP_MS ? n + 1 : 1;
  }

  /** n 回目（1 始まり）の連続したスクラブ幅（秒）。 */
  function scrubStep(n, duration) {
    if (!(n > ACCEL_AFTER)) return STEP;
    const k = Math.min(CURVE.length - 1, n - ACCEL_AFTER);
    return Math.max(STEP, Math.round(STEP + (stepCap(duration) - STEP) * CURVE[k]));
  }

  /** スクラブの目標を 0〜長さの範囲に収める。 */
  function clampTarget(t, duration) {
    const max = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    return Math.min(max, Math.max(0, t));
  }

  const SEEK_KEYS = { LEFT: -1, RIGHT: 1, SEEK_BACK: -1, SEEK_FWD: 1 };

  /**
   * キー 1 回の処理。
   * @param {{ui:string, focus:string, noSeek:boolean, ended:boolean, popup:boolean}} s
   *   noSeek: シークできない（広告・ライブ・シーク不可の区間）。popup: 再生速度・画質のポップアップ（Radix）が開いている。ended: 再生が終わった。
   * @param {string} action  論理アクション
   * @returns {{state:object, effects:Array<object>, consume:boolean}}
   *   effects: show / hide / focus('bar'|'row') / togglePause / pause / play / rowMove(dir) / activate / scrubStart / scrubStep(dir) / scrubCommit /
   *            scrubCancel / leave / playNext / cancelNext / escapePopup / popupSelect / touch（操作画面の自動で隠すまでの時間を延ばす）
   *   consume: true = 拡張が処理した（サイトには渡さない）。false = サイト（TVer・Radix）に任せる
   */
  function reduce(s, action) {
    const state = { ...s };
    const fx = [];
    const out = (consume = true) => ({ state, effects: fx, consume });
    const show = (focus) => {
      state.ui = 'C';
      state.focus = focus;
      fx.push({ do: 'show' }, { do: 'focus', to: focus });
    };

    // 再生速度・画質のポップアップ（Radix）が開いている: 矢印はサイト（Radix の RadioGroup）に任せる。
    // OK は選んで閉じる（Radix は Enter では何もしない）。Esc 以外の「戻る」は Esc として渡す
    if (s.popup) {
      if (action === 'BACK') return { state, effects: [{ do: 'escapePopup' }], consume: false };
      if (action === 'OK') return { state, effects: [{ do: 'popupSelect' }], consume: true };
      return { state, effects: [], consume: false };
    }

    // 再生が終わった（次のエピソードの案内）
    if (s.ended) {
      if (action === 'OK') fx.push({ do: 'playNext' });
      else if (action === 'BACK' || action === 'STOP') fx.push({ do: 'cancelNext' });
      else return out(false);
      return out();
    }

    // 操作画面を自動で隠す（一時停止中は呼ばない。呼び出し側が判断する）
    if (action === 'IDLE') {
      if (s.ui === 'C') {
        state.ui = 'H';
        fx.push({ do: 'hide' });
      }
      return out();
    }

    if (action === 'STOP') {
      fx.push({ do: 'leave' });
      return out();
    }

    // ---- スクラブ中
    if (s.ui === 'S') {
      if (action in SEEK_KEYS) {
        fx.push({ do: 'scrubStep', dir: SEEK_KEYS[action] });
      } else if (action === 'OK') {
        state.ui = 'H';
        fx.push({ do: 'scrubCommit' }, { do: 'hide' });
      } else if (action === 'BACK' || action === 'UP' || action === 'DOWN') {
        state.ui = 'C';
        state.focus = 'bar';
        fx.push({ do: 'scrubCancel' }, { do: 'show' }, { do: 'focus', to: 'bar' });
      }
      return out(); // スクラブ中の他のキーは何もしない（サイトにも渡さない）
    }

    // ---- 非表示
    if (s.ui === 'H') {
      switch (action) {
        case 'LEFT':
        case 'RIGHT':
          show('bar'); // 出すだけ。シークはしない
          break;
        case 'PLAY_PAUSE':
          show('row');
          fx.push({ do: 'togglePause' });
          break;
        case 'PAUSE':
          show('row');
          fx.push({ do: 'pause' });
          break;
        case 'PLAY':
          show('row');
          fx.push({ do: 'play' });
          break;
        case 'SEEK_BACK':
        case 'SEEK_FWD':
          if (s.noSeek) {
            show('row');
            break;
          }
          state.ui = 'S';
          fx.push({ do: 'show' }, { do: 'scrubStart' });
          break;
        case 'BACK':
          fx.push({ do: 'leave' });
          break;
        default:
          show('row'); // OK・↑・↓・メニュー・ページ送りなど、そのほかのキー
      }
      return out();
    }

    // ---- 操作画面
    switch (action) {
      case 'BACK':
        state.ui = 'H';
        fx.push({ do: 'hide' });
        break;
      case 'UP':
        if (s.focus === 'row') {
          state.focus = 'bar';
          fx.push({ do: 'focus', to: 'bar' }, { do: 'touch' });
        } else {
          state.ui = 'H'; // 進行バーから ↑ で隠れる
          fx.push({ do: 'hide' });
        }
        break;
      case 'DOWN':
        if (s.focus === 'bar') {
          state.focus = 'row';
          fx.push({ do: 'focus', to: 'row' });
        }
        fx.push({ do: 'touch' });
        break;
      case 'LEFT':
      case 'RIGHT':
        if (s.focus === 'bar') {
          if (s.noSeek) {
            fx.push({ do: 'touch' }); // 広告中などは動かせない（TVer も同じ）
            break;
          }
          state.ui = 'S';
          fx.push({ do: 'scrubStart' }, { do: 'scrubStep', dir: SEEK_KEYS[action] });
        } else {
          fx.push({ do: 'rowMove', dir: SEEK_KEYS[action] }, { do: 'touch' });
        }
        break;
      case 'SEEK_BACK':
      case 'SEEK_FWD':
        if (s.noSeek) {
          fx.push({ do: 'touch' });
          break;
        }
        state.ui = 'S';
        fx.push({ do: 'scrubStart' });
        break;
      case 'OK':
        fx.push(s.focus === 'bar' ? { do: 'togglePause' } : { do: 'activate' }, { do: 'touch' });
        break;
      case 'PLAY_PAUSE':
        fx.push({ do: 'togglePause' }, { do: 'touch' });
        break;
      case 'PAUSE':
        fx.push({ do: 'pause' }, { do: 'touch' });
        break;
      case 'PLAY':
        fx.push({ do: 'play' }, { do: 'touch' });
        break;
      default:
        fx.push({ do: 'touch' });
    }
    return out();
  }

  const api = { IDLE_MS, STEP, ACCEL_GAP_MS, initialState, fmtTime, nextCount, scrubStep, stepCap, clampTarget, reduce };
  SV.watchCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
