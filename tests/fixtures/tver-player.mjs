// TVer の再生ページ（プレイヤー部分）の再現。実サイト（2026-10-19 の実 DOM・実測）の「構造と挙動」を縮小して書き直したもの。
// クラス名は実サイトと同じ（CSS Modules のハッシュ付き）。実サイトの CSS・JS をそのまま写してはいない（値と挙動を測って書いた）。
//
// 拡張と干渉しうる、実サイトの性質を再現する:
//  - PlayerLayout_jail の mask-image + overflow: hidden（position: fixed の子孫まで切り取る。全画面（:fullscreen）のときだけ外れる）
//  - VodController: opacity 0 / VodController_active で 1（0.3 秒のトランジション）、表示は 2.5 秒・フォーカス中は 30 秒の React 風タイマー
//  - document の keydown（バブリング）: Space/Enter 再生・停止、←→ ±10 秒、↑↓ 音量、f 全画面、m ミュート、操作盤内の Esc で隠す
//  - 全画面 = [js-fullscreen-target].requestFullscreen()（ボタン・f・VodController の data-fullscreen と全画面アイコンの切り替え）
//  - 再生速度・画質のポップアップ（Radix 風。操作盤の中にそのまま出る。再生速度は 2 列のグリッドで、矢印は DOM 順にフォーカスだけ動かす。選ぶのはクリック。Enter は何もしない）
//  - ミニプレイヤー: IntersectionObserver（スクロールで画面外に出て、再生中ならミニプレイヤーに切り替わる）
//  - 再生が終わると操作盤は消え、「次のエピソードまで N 秒...」の案内（閉じる・再生ボタン）。カウントダウンのあと遷移する。
//    「閉じる」はカウントダウンを止め、プレイヤーを初期状態（ポスター）へ戻す（実サイトの実測: 全画面も終わる。cancelKeepsPanel で、案内が残る場合も再現できる）
//  - 初回のアンケート（任意）: 回答するまで再生が始まらない
//  - リアルタイム配信（live: true）: ポスターなしで自動再生。操作盤は LiveController（LIVE の表示・停止・音量・画質・全画面。追っかけ視聴 = DVR なし。
//    進行バーも時間もない。Enter・Space・← → は何もしない。停止を押すとプレイヤーを破棄する）
// 再現していないもの: 広告（クラスを付けて確かめる）・ライブの操作盤・DRM・実際のストリーミング。
// テストからは window.__fx（log / navigations / state()）で、TVer 側で起きたことを観測できる。

const PLAYER_CSS = `
:root { --color-surface-accent-secondary: #0D99E5; --color-state-hovered: rgba(255,255,255,.1); --borderWidth-2: 2px; --ZIndex_Modal: 50; }
.Episode_player__8Rz_P { position: relative; }
.PlayerLayout_host__3wobb { position: relative; }
.PlayerLayout_host__3wobb[data-mini-player="false"] { z-index: 1; }
.PlayerLayout_host__3wobb:fullscreen { display: flex; justify-content: center; align-items: center; width: 100%; min-width: auto; max-width: none; height: 100%; background: #000; }
.PlayerLayout_aspectRatioWrapper__eT_En { position: relative; width: 100%; }
.PlayerLayout_aspectRatioWrapper__eT_En[data-episode-page="true"] { padding-top: 56.25%; }
.PlayerLayout_host__3wobb:fullscreen .PlayerLayout_aspectRatioWrapper__eT_En { width: min(100vw, 177.78vh); padding-top: min(56.25vw, 100vh); }
.PlayerLayout_container__MroYC, .PlayerLayout_jail__SWGaf { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
.PlayerLayout_jail__SWGaf[data-mini-player="false"] { isolation: isolate; overflow: hidden; mask-image: linear-gradient(#000 0, #000 0); border-radius: 8px; }
.PlayerLayout_host__3wobb:fullscreen .PlayerLayout_jail__SWGaf { overflow: visible; mask-image: none; border-radius: 0; }
.MiniPlayerLayout_container__gXbCK { position: relative; width: 100%; height: 100%; }
.MiniPlayerLayout_draggable__d5Ue2, .MiniPlayerLayout_player__ssGjo, .MiniPlayerLayout_video__bbH4S, .EpisodePlayer_container__3kdIa, .EpisodePlayer_videoContainer__r4F40 { position: relative; width: 100%; height: 100%; }
.MiniPlayerLayout_draggable__d5Ue2[data-open="true"] { position: fixed; z-index: 45; right: 16px; bottom: 16px; width: min(375px, 100vw - 32px); height: auto; min-width: 320px; }
.MiniPlayerLayout_video__bbH4S[data-open="true"] { aspect-ratio: 16 / 9; height: auto; }
.MiniPlayerLayout_placeholder__LKL5h { position: absolute; inset: 0; z-index: -1; background: #000; }
.video-js { position: relative; width: 100%; height: 100%; background: #000; }
.video-js video { display: block; width: 100%; height: 100%; }
.vjs-spinner, .vjs-error-display { display: none; }
.PlayerThumbnail_wrapper__LoArZ { position: absolute; inset: 0; background: #333; }
.PlayerThumbnail_playButton__7SrdI { position: absolute; top: 50%; left: 50%; width: 80px; height: 80px; border: 0; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; transform: translate(-50%, -50%); }
.PlayerThumbnail_playButton__7SrdI:focus-visible { outline: 2px solid #0D99E5; outline-offset: 2px; }

.VodController_container__jQU9B { position: absolute; bottom: 0; left: 0; isolation: isolate; display: flex; flex-direction: column; justify-content: flex-end; width: 100%; height: 100%; outline: none; opacity: 0; transition: opacity .3s; }
.VodController_container__jQU9B[data-fullscreen="true"] { position: fixed; }
.VodController_container__jQU9B::before { content: ""; position: absolute; bottom: 0; left: 0; z-index: -1; display: block; width: 100%; height: 92px; background: linear-gradient(rgba(0,0,0,0), #000); pointer-events: none; }
.VodController_active__Sjkyk { opacity: 1; }
.VodController_hideCursor__z__N4, .VodController_hideCursor__z__N4 * { cursor: none !important; }
.VodController_buttons__iPB1l { display: flex; align-items: center; height: 44px; margin: 0 20px 6px; }
.VodController_buttons__iPB1l > * { flex: 0 0 auto; }
.VodController_timeLabel__HGEOq { flex-shrink: 1; margin-left: 12px; }
.VodController_spacer__Ywg1N { flex: 1 1 auto; }
.VodController_fullscreen__GfVsi { margin-right: -6px; }
.VodController_skipBack__x5bgs { margin-left: -6px; }
.VodController_menuMargin__vPx31 { margin-right: 12px; }
.SeekBar_container__mcvNv { position: relative; height: 16px; margin: 0 24px; cursor: pointer; }
.SeekBar_bar__hOgEi { position: absolute; top: 50%; width: 100%; height: 4px; border-radius: 999px; transform: translateY(-50%); }
.SeekBar_backgroundBar__x7oUF { background: rgba(255,255,255,.3); }
.SeekBar_activeBar__FFaZC { width: 100%; background: var(--seek-bar-color); }
.SeekBar_handleWrapper__uSORm { position: relative; height: 4px; }
.SeekBar_handle__hC5k9 { position: absolute; top: 50%; right: -8px; width: 16px; height: 16px; border-radius: 100%; background: var(--seek-bar-color); transform: translateY(-50%); }
.TimeLabel_label__yi1HV { font-weight: 700; font-size: 12px; line-height: 16px; color: #fff; }
.Tooltip_wrapper__J3h_u { position: relative; display: inline-block; }
.Tooltip_wrapper__J3h_u:hover .Tooltip_tooltip__COUes { display: block; }
.Tooltip_tooltip__COUes { position: absolute; top: -20px; display: none; margin-top: -16px; padding: 0 8px; border-radius: 999px; background: #000; color: #fff; font-size: 13px; white-space: nowrap; }
.Tooltip_tooltip__COUes[hidden] { display: none !important; }
.Tooltip_left__Pv9dH { left: 0; } .Tooltip_center__vB__G { left: 50%; transform: translate(-50%); } .Tooltip_right__SiyGN { right: 0; }
.Button_button__ZKEys { position: relative; display: inline-flex; gap: 4px; justify-content: center; align-items: center; padding: 0; border: 0; border-radius: 8px; font-weight: 700; text-align: center; cursor: pointer; background: none; color: #fff; }
.Button_button__ZKEys::before { content: ""; position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: inherit; }
.Button_button__ZKEys:focus-visible { outline: var(--borderWidth-2) solid var(--color-state-focused, #0D99E5); outline-offset: 2px; }
.Button_icon__gIg2t { display: inline-flex; align-items: center; font-size: 24px; }
.Button_content__lH1Fs { overflow: hidden; }
.Skip_icon__Y1xdS, .Play_icon__SzljS, .Volume_icon__mqV_W, .Fullscreen_icon__VxBit, .Speed_label__w7nuG, .Quality_label__HYXyF { width: 44px; height: 44px; border-radius: 999px; color: #fff; }
.Speed_label__w7nuG, .Quality_label__HYXyF { font-size: 12px; line-height: 16px; }
.Skip_icon__Y1xdS svg, .Play_icon__SzljS svg, .Volume_icon__mqV_W svg, .Fullscreen_icon__VxBit svg { width: 24px; height: 24px; }
.Volume_slider__wdsGf { display: none; }
.KeyAction_action__IGLD_ { position: absolute; top: 50%; left: 50%; display: flex; justify-content: center; align-items: center; width: 80px; height: 80px; border-radius: 999px; background: rgba(0,0,0,.6); pointer-events: none; transform: translateY(-50%) translateX(-50%); }
.Popover_content__FsSP6 { z-index: 60; }
.Speed_menu__CdDzI, .Quality_menu__gycyK { display: flex; flex-direction: column; min-width: 160px; padding: 4px; border: 1px solid rgba(255,255,255,.1); border-radius: 12px; background: rgba(0,0,0,.8); color: #fff; font-size: 12px; font-weight: 700; line-height: 1.25; }
.Speed_title__cnYpJ, .Quality_title___lDc1 { padding: 8px 12px; color: rgba(255,255,255,.7); font-size: 11px; }
.Radio_group__Zlddp { display: flex; width: 100%; height: 100%; }
.Speed_radio__tictv { grid-template-columns: 1fr 1fr; gap: 0 4px; display: grid !important; }
.Radio_radio__reZsZ { display: inline-flex; align-items: center; cursor: pointer; }
.Speed_item__Yq7XB, .Quality_item__GPXbZ { flex-direction: row-reverse; justify-content: space-between; min-width: 120px; height: 40px; padding: 0 12px 0 8px; border-radius: 8px; color: #fff; }
.Radio_item__twh37 { position: relative; display: inline-flex; flex-shrink: 0; width: 18px; height: 18px; border: 1px solid #888; border-radius: 50%; background: transparent; padding: 0; }
.Radio_item__twh37:focus-visible { outline: 2px solid var(--color-state-focused, #0D99E5); outline-offset: 2px; }
.Radio_label__FLvcr { display: block; flex-grow: 1; padding: 0 4px; }

.NextEpisodeThumbnail_nextEpisodeThumbnail__8kq7F { position: absolute; inset: 0; width: 100%; height: 100%; background: #1d2433; color: #fff; }
.NextEpisodeThumbnail_cancelContainer__4weSO { position: absolute; top: 0; z-index: 10; width: 100%; padding: 12px 12px 0 0; text-align: right; }
.NextEpisodeThumbnail_container__vRqcz { position: absolute; left: 20%; bottom: 20%; display: flex; gap: 24px; align-items: center; }
.NextEpisodeThumbnail_info__kTybh { margin-bottom: 8px; font-weight: 700; }
.AutoPlayThumbnail_wrapper__3J0fi { position: relative; width: 240px; height: 135px; border: 1px solid #567; background: #2b3a55; color: #fff; cursor: pointer; }
.AutoPlayThumbnail_wrapper__3J0fi:focus-visible { outline: 2px solid #0D99E5; outline-offset: 2px; }
.IconButton_button__Wx8Wn { border: 0; background: rgba(0,0,0,.4); color: #fff; border-radius: 50%; width: 32px; height: 32px; }

.MiniPlayerController_panel__KiZ_E { position: absolute; inset: 0; }
.Modal_overlay__zBMug { position: fixed; inset: 0; z-index: 50; background: rgba(0,0,0,.6); }
.Modal_content__iSFyO { position: fixed; z-index: 51; top: 50%; left: 50%; width: 420px; padding: 24px; border-radius: 12px; background: #222; color: #fff; transform: translate(-50%, -50%); }
`;

// LiveController（リアルタイム配信）は VodController と同じ作り（クラス名だけ違う）。規則を同じ内容で複製する
const LIVE_MAP = { container: 'container__4iOjO', active: 'active__pwr3w', hideCursor: 'hideCursor__mUNb8', buttons: 'buttons__BeJEz', spacer: 'spacer__VoiIa', fullscreen: 'fullscreen__OrAG0', timeLabel: 'timeLabel__YgQs_', menuMargin: 'menuMargin__qakXa' };
const LIVE_CSS = PLAYER_CSS.split('\n')
  .filter((l) => l.includes('VodController_'))
  .map((l) => l.replace(/VodController_(\w+?)__\w+/g, (m, k) => (LIVE_MAP[k] ? 'LiveController_' + LIVE_MAP[k].replace(/__.*/, '') + '__' + LIVE_MAP[k].split('__')[1] : m)))
  .join('\n');

const SVG = {
  play: '<path d="M7 3l14 9-14 9z" fill="currentColor"/>',
  pause: '<path d="M5 3h5v18H5zM14 3h5v18h-5z" fill="currentColor"/>',
  back: '<path d="M12 2a10 10 0 1 0 10 10h-2a8 8 0 1 1-8-8z" fill="currentColor"/>',
  fwd: '<path d="M12 2a10 10 0 1 1-10 10h2a8 8 0 1 0 8-8z" fill="currentColor"/>',
  volume: '<path d="M3 9h4l5-5v16l-5-5H3z" fill="currentColor"/>',
  fullscreen: '<path d="M3 3h6v2H5v4H3zM15 3h6v6h-2V5h-4zM3 15h2v4h4v2H3zM19 15h2v6h-6v-2h4z" fill="currentColor"/>',
  exit: '<path d="M9 3v6H3V7h4V3zM15 3h2v4h4v2h-6zM3 15h6v6H7v-4H3zM15 15h6v2h-4v4h-2z" fill="currentColor"/>',
};

/** 実サイトと同じ構造のプレイヤー（ポスター表示の状態）。 */
export function playerMarkup(o = {}) {
  const src = o.videoSrc || '/__fx__/test.webm';
  return `
<div class="Episode_player__8Rz_P">
  <div class="PlayerLayout_host__3wobb" data-mini-player="false" js-fullscreen-target>
    <div data-episode-page="true" class="PlayerLayout_aspectRatioWrapper__eT_En">
      <div class="PlayerLayout_container__MroYC">
        <div data-mini-player="false" class="PlayerLayout_jail__SWGaf">
          <div class="MiniPlayerLayout_container__gXbCK">
            <div data-open="false" class="MiniPlayerLayout_draggable__d5Ue2">
              <div data-open="false" class="MiniPlayerLayout_player__ssGjo">
                <div data-open="false" class="MiniPlayerLayout_video__bbH4S">
                  <div class="EpisodePlayer_container__3kdIa">
                    <div class="EpisodePlayer_videoContainer__r4F40">
                      <div id="vjs_video_3" class="EpisodePlayer_video__zJyi9 vjs-hide-info-bar strp-noads vjs-controls-disabled vjs-v8 strp-v2 streaks-player video-js strp-initialized strp-ready vjs-paused vjs-unstarted-mode" tabindex="-1" role="region" aria-label="Video Player">
                        <video id="vjs_video_3_html5_api" class="vjs-tech" playsinline src="${src}" data-id="video"></video>
                        <div class="strp-ads strp-ad-module"></div>
                        <div class="vjs-spinner"></div>
                        <div class="vjs-error-display vjs-modal-dialog vjs-hidden" role="dialog" aria-hidden="true"></div>
                      </div>
                      ${o.live ? '' : '<div class="PlayerThumbnail_wrapper__LoArZ"><button id="episode-play" type="button" class="PlayerThumbnail_playButton__7SrdI" aria-label="再生" autofocus>▶</button></div>'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="MiniPlayerLayout_placeholder__LKL5h"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>`;
}

export const playerCss = PLAYER_CSS + LIVE_CSS;

/** 再現ページの挙動（ブラウザの中で動く。引数は JSON で渡す）。 */
function runtime(O) {
  'use strict';
  const doc = document;
  const $ = (s, r) => (r || doc).querySelector(s);
  const host = $('[js-fullscreen-target]');
  const jail = $('[class*="PlayerLayout_jail__"]');
  const draggable = $('[class*="MiniPlayerLayout_draggable__"]');
  const box = $('[class*="EpisodePlayer_videoContainer__"]');
  const vjs = $('.video-js');
  const video = $('video', vjs);
  const NORMAL = (O.timers && O.timers.normal) || 2500;
  const STICKY = (O.timers && O.timers.sticky) || 30000;
  const fx = (window.__fx = { log: [], navigations: [], state: null });
  const log = (ev, extra) => fx.log.push(Object.assign({ t: Math.round(performance.now()), ev }, extra));
  const svg = (label, body) => '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" role="img" aria-label="' + label + '">' + body + '</svg>';
  const SV_ = JSON.parse(O.svg);
  const INTERACTIVE = 'button, a, select, textarea, input, [role="button"], [role="radio"], [role="slider"], [role="menuitem"]';

  const ACTIVE = O.live ? 'LiveController_active__pwr3w' : 'VodController_active__Sjkyk';
  const HIDE = O.live ? 'LiveController_hideCursor__mUNb8' : 'VodController_hideCursor__z__N4';
  let vod = null;
  let timer = 0;
  let isPlaying = false;
  let mini = false;
  let next = null;
  let popover = null; // { kind, trigger, wrap }
  let speed = 1;
  let quality = '';

  // ---- 操作盤の表示（実サイトの React 状態に相当）
  function activate(ms) {
    if (!vod) return;
    clearTimeout(timer);
    vod.classList.add(ACTIVE);
    vod.classList.remove(HIDE);
    timer = setTimeout(deactivate, ms || NORMAL);
    log('ctl-active', { ms: ms || NORMAL });
  }
  function deactivate() {
    clearTimeout(timer);
    if (!vod) return;
    vod.classList.remove(ACTIVE);
    vod.classList.add(HIDE);
    log('ctl-idle');
  }

  function fmt(s) {
    s = Math.floor(s || 0);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function wrapper(extra, inner, tip, pos) {
    return '<div class="Tooltip_wrapper__J3h_u' + (extra ? ' ' + extra : '') + '">' + inner + '<div class="Tooltip_tooltip__COUes Tooltip_' + (pos || 'center') + '__x">' + tip + '</div></div>';
  }
  const iconBtn = (cls, label, body) => '<button type="button" class="Button_button__ZKEys Button_plain__kX08y Button_md__xiSS7 ' + cls + '"><span class="Button_icon__gIg2t">' + svg(label, body) + '</span></button>';
  const labelBtn = (cls, aria, text) => '<button type="button" class="Button_button__ZKEys Button_plain__kX08y Button_md__xiSS7 ' + cls + '" aria-label="' + aria + '" aria-haspopup="dialog" aria-expanded="false" data-state="closed"><div class="Button_content__lH1Fs">' + text + '</div></button>';

  function mountVod() {
    if (vod) return;
    vod = doc.createElement('div');
    vod.className = O.live ? 'LiveController_container__4iOjO' : 'VodController_container__jQU9B';
    vod.setAttribute('data-fullscreen', String(!!doc.fullscreenElement));
    vod.tabIndex = 0;
    vod.setAttribute('style', '--seek-bar-color: var(--color-surface-accent-secondary);');
    vod.innerHTML = O.live
      ? '<div class="LiveController_buttons__BeJEz">' +
        '<span class="LiveController_liveLabel__r1tMd" data-type="live"><span aria-hidden="true">●</span>LIVE</span>' +
        wrapper('', iconBtn('Play_icon__SzljS', '停止', SV_.pause), '停止') +
        wrapper('Volume_wrapper__272D_', iconBtn('Volume_icon__mqV_W', '音量 大', SV_.volume) + '<div class="Volume_slider__wdsGf"><input min="0" max="1" step="0.01" class="Volume_range__h1JkI" type="range" value="1"></div>', '音量', 'left') +
        '<span class="LiveController_spacer__VoiIa"></span>' +
        wrapper('', labelBtn('Quality_label__HYXyF', '画質を選択', quality || '画質'), '画質') +
        wrapper('LiveController_fullscreen__OrAG0', iconBtn('Fullscreen_icon__VxBit', doc.fullscreenElement ? '全画面を終了' : '全画面', doc.fullscreenElement ? SV_.exit : SV_.fullscreen), '全画面', 'right') +
        '</div>'
      :
      '<div data-mini-player="false" class="SeekBar_container__mcvNv" aria-valuenow="0"><div class="SeekBar_bar__hOgEi SeekBar_backgroundBar__x7oUF"></div><div class="SeekBar_bar__hOgEi SeekBar_activeBar__FFaZC" style="width:0%"><div class="SeekBar_handleWrapper__uSORm"><div class="SeekBar_handle__hC5k9"></div></div></div></div>' +
      '<div class="VodController_buttons__iPB1l">' +
      wrapper('VodController_skipBack__x5bgs', iconBtn('Skip_icon__Y1xdS', '10秒戻る', SV_.back), '10秒戻る', 'left') +
      wrapper('', iconBtn('Play_icon__SzljS', video.paused ? '再生' : '一時停止', video.paused ? SV_.play : SV_.pause), '再生') +
      wrapper('', iconBtn('Skip_icon__Y1xdS', '10秒進む', SV_.fwd), '10秒進む') +
      wrapper('Volume_wrapper__272D_', iconBtn('Volume_icon__mqV_W', '音量 大', SV_.volume) + '<div class="Volume_slider__wdsGf"><input min="0" max="1" step="0.01" class="Volume_range__h1JkI" type="range" value="1"></div>', '音量', 'left') +
      '<span class="TimeLabel_label__yi1HV VodController_timeLabel__HGEOq">0:00 / 0:00</span><span class="VodController_spacer__Ywg1N"></span>' +
      wrapper('', labelBtn('Speed_label__w7nuG', '再生速度の選択', 'x1.0'), '再生速度') +
      wrapper('', labelBtn('Quality_label__HYXyF', '画質を選択', quality || '画質'), '画質') +
      wrapper('VodController_fullscreen__GfVsi', iconBtn('Fullscreen_icon__VxBit', doc.fullscreenElement ? '全画面を終了' : '全画面', doc.fullscreenElement ? SV_.exit : SV_.fullscreen), '全画面', 'right') +
      '</div>';
    box.appendChild(vod);
    vod.addEventListener('focusin', (e) => {
      if (e.target === vod || e.target.closest(INTERACTIVE)) activate(STICKY);
    });
    vod.addEventListener('focusout', (e) => {
      if (e.target !== vod && e.target.closest(INTERACTIVE)) activate(NORMAL);
    });
    vod.addEventListener('click', onVodClick);
    updateVod();
    log('vod-mount');
    if (scrollY === 0) {
      vod.focus();
      activate(STICKY);
    }
  }
  function unmountVod() {
    if (!vod) return;
    clearTimeout(timer);
    vod.remove();
    vod = null;
    popover = null;
    log('vod-unmount');
  }

  function updateVod() {
    if (!vod) return;
    if (O.live) {
      const lf = $('[class*="Fullscreen_icon__"]', vod);
      const ll = doc.fullscreenElement ? '全画面を終了' : '全画面';
      if (lf.querySelector('svg').getAttribute('aria-label') !== ll) lf.querySelector('.Button_icon__gIg2t').innerHTML = svg(ll, doc.fullscreenElement ? SV_.exit : SV_.fullscreen);
      vod.setAttribute('data-fullscreen', String(!!doc.fullscreenElement));
      return;
    }
    const d = video.duration || 0;
    const frac = d ? video.currentTime / d : 0;
    const bar = $('[class*="SeekBar_activeBar__"]', vod);
    bar.style.width = frac * 100 + '%';
    $('[class*="SeekBar_container__"]', vod).setAttribute('aria-valuenow', String(frac));
    $('[class*="TimeLabel_label__"]', vod).textContent = fmt(video.currentTime) + ' / ' + fmt(d);
    const play = $('[class*="Play_icon__"]', vod);
    const lab = video.paused ? '再生' : '一時停止';
    if (play.querySelector('svg').getAttribute('aria-label') !== lab) play.querySelector('.Button_icon__gIg2t').innerHTML = svg(lab, video.paused ? SV_.play : SV_.pause);
    const fs = $('[class*="Fullscreen_icon__"]', vod);
    const fl = doc.fullscreenElement ? '全画面を終了' : '全画面';
    if (fs.querySelector('svg').getAttribute('aria-label') !== fl) fs.querySelector('.Button_icon__gIg2t').innerHTML = svg(fl, doc.fullscreenElement ? SV_.exit : SV_.fullscreen);
    vod.setAttribute('data-fullscreen', String(!!doc.fullscreenElement));
  }

  // ---- 操作
  function skip(sec) {
    const d = video.duration || 0;
    video.currentTime = Math.min(d, Math.max(0, video.currentTime + sec));
    log('skip', { sec });
  }
  // ライブの停止: TVer はプレイヤーを破棄する（配信が終わる）
  function disposeLive() {
    log('dispose');
    video.pause();
    isPlaying = false;
    unmountVod();
  }
  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
  function toggleFullscreen() {
    const target = $('[js-fullscreen-target]');
    log('fullscreen-toggle', { activation: navigator.userActivation.isActive });
    if (doc.fullscreenElement) doc.exitFullscreen();
    else target.requestFullscreen(); // 実サイトと同じく catch しない
  }
  function onVodClick(e) {
    const b = e.target.closest('button');
    if (!b || !vod.contains(b)) return;
    if (b.matches('[class*="Skip_icon__"]')) skip(b.closest('[class*="VodController_skipBack__"]') ? -10 : 10);
    else if (b.matches('[class*="Play_icon__"]')) { if (O.live) disposeLive(); else togglePlay(); }
    else if (b.matches('[class*="Fullscreen_icon__"]')) toggleFullscreen();
    else if (b.matches('[class*="Volume_icon__"]')) video.muted = !video.muted;
    else if (b.matches('[class*="Speed_label__"]')) togglePopover('speed', b);
    else if (b.matches('[class*="Quality_label__"]')) togglePopover('quality', b);
  }

  // ---- 再生速度・画質のポップアップ（Radix 風）
  const SPEEDS = [2, 1.75, 1.5, 1.25, 1, 0.75, 0.5];
  const QUALITIES = [['auto', '自動'], ['high', '高'], ['middle', '中'], ['low', '低']];
  function closePopover(returnFocus) {
    if (!popover) return;
    const { trigger, wrap } = popover;
    popover = null;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('data-state', 'closed');
    wrap.remove();
    if (returnFocus) trigger.focus();
    log('popover-close');
  }
  function togglePopover(kind, trigger) {
    if (popover) return closePopover(true);
    const sp = (s) => (Number.isInteger(s) ? s.toFixed(1) : s.toFixed(2)); // 実サイトの表記: 2.0 / 1.75 / 1.50 / 1.25 / 1.0 / 0.75 / 0.50
    const items = kind === 'speed' ? SPEEDS.map((s) => ({ v: String(s), id: 'speed-' + sp(s).replace('.', '_'), label: 'x ' + sp(s), aria: sp(s), checked: s === speed })) : QUALITIES.map(([k, t]) => ({ v: k, id: 'quality-' + k, label: t, aria: t, checked: (quality || '自動') === t }));
    const wrap = doc.createElement('div');
    wrap.setAttribute('data-radix-popper-content-wrapper', '');
    const r = trigger.getBoundingClientRect();
    wrap.style.cssText = 'position:fixed;left:0;top:0;min-width:max-content;transform:translate(' + Math.max(8, r.left - 40) + 'px,' + Math.max(8, r.top - 330) + 'px);';
    wrap.innerHTML =
      '<div data-side="top" data-state="open" role="dialog" class="Popover_content__FsSP6 ' + (kind === 'speed' ? 'Speed_menu__CdDzI' : 'Quality_menu__gycyK') + ' VodController_menuMargin__vPx31" tabindex="-1">' +
      '<div class="' + (kind === 'speed' ? 'Speed_title__cnYpJ' : 'Quality_title___lDc1') + '">' + (kind === 'speed' ? '再生速度' : '画質') + '</div><hr>' +
      '<div role="radiogroup" class="Radio_group__Zlddp ' + (kind === 'speed' ? 'Speed_radio__tictv' : 'Quality_radio__x') + '" tabindex="0" style="outline:none;flex-direction:row;">' +
      items.map((it) => '<label class="Radio_radio__reZsZ ' + (kind === 'speed' ? 'Speed_item__Yq7XB' : 'Quality_item__GPXbZ') + '" for="' + it.id + '"><button type="button" role="radio" aria-checked="' + it.checked + '" data-state="' + (it.checked ? 'checked' : 'unchecked') + '" value="' + it.v + '" id="' + it.id + '" aria-label="' + (kind === 'speed' ? '再生速度 ' : '画質 ') + it.aria + '" class="Radio_item__twh37" tabindex="' + (it.checked ? 0 : -1) + '"></button><span class="Radio_label__FLvcr">' + it.label + '</span></label>').join('') +
      '</div></div>';
    trigger.parentElement.appendChild(wrap); // 実サイトは portal を使わず、操作盤の中にそのまま出す
    popover = { kind, trigger, wrap };
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('data-state', 'open');
    const radios = Array.from(wrap.querySelectorAll('[role="radio"]'));
    const select = (b) => {
      radios.forEach((x) => { x.setAttribute('aria-checked', String(x === b)); x.setAttribute('data-state', x === b ? 'checked' : 'unchecked'); x.tabIndex = x === b ? 0 : -1; });
      if (kind === 'speed') { speed = Number(b.value); video.playbackRate = speed; trigger.querySelector('.Button_content__lH1Fs').textContent = 'x' + speed.toFixed(2).replace(/00$/, '0'); }
      else { quality = b.getAttribute('aria-label').replace('画質 ', ''); trigger.querySelector('.Button_content__lH1Fs').textContent = quality; }
      log('select', { kind, value: b.value });
    };
    wrap.addEventListener('keydown', (e) => {
      const i = radios.indexOf(doc.activeElement);
      if (i < 0) return;
      // 実サイトでは、矢印キーはフォーカスが動くだけで、選択はされない（クリックで選ぶ）。Enter は何もしない
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { radios[Math.min(radios.length - 1, i + 1)].focus(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { radios[Math.max(0, i - 1)].focus(); e.preventDefault(); }
      else if (e.key === 'Enter') e.preventDefault();
    });
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[role="radio"]'); if (b) select(b); });
    (radios.find((x) => x.getAttribute('data-state') === 'checked') || radios[0]).focus();
    log('popover-open', { kind });
  }
  // Radix の DismissableLayer: document の capture で Esc
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape' && popover) closePopover(true); }, true);

  // ---- キー（実サイトと同じ document・バブリング）
  doc.addEventListener('keydown', (e) => {
    if (!vod) return;
    const t = e.target;
    if (t.matches && t.matches('input, textarea')) return;
    const code = e.code || e.key;
    if (code === 'Escape' && vod.contains(t)) { vod.focus(); deactivate(); log('key', { code, act: 'esc-hide' }); return; }
    const interactive = !!(t.closest && t.closest(INTERACTIVE));
    let act = '';
    if (O.live && (code === 'Space' || code === 'Enter' || code === 'ArrowRight' || code === 'ArrowLeft')) { log('key', { code, act: 'live-noop' }); activate(NORMAL); return; }
    if (code === 'Space' || code === 'Enter') {
      if (interactive) return;
      if (!e.repeat) { togglePlay(); act = 'toggle'; }
    } else if (code === 'ArrowRight' || code === 'ArrowLeft') {
      if (interactive) return;
      skip(code === 'ArrowRight' ? 10 : -10); act = 'skip';
    } else if (code === 'ArrowUp' || code === 'ArrowDown') {
      if (interactive) return;
      video.volume = Math.min(1, Math.max(0, video.volume + (code === 'ArrowUp' ? 0.05 : -0.05))); e.preventDefault(); act = 'volume';
      log('volume', { v: video.volume });
    } else if (code === 'KeyF' || e.key === 'f') { toggleFullscreen(); act = 'fullscreen'; }
    else if (code === 'KeyM' || e.key === 'm') { video.muted = !video.muted; act = 'mute'; }
    log('key', { code, act });
    activate(NORMAL);
  });

  // ---- ミニプレイヤー（スクロールで画面外に出て、再生中なら）
  const io = new IntersectionObserver(
    (es) => {
      const en = es[es.length - 1];
      if (!en) return;
      const out = en.intersectionRatio <= 0.25 && !en.isIntersecting;
      if (out && isPlaying && !mini) setMini(true);
      else if (en.isIntersecting && en.intersectionRatio > 0.25 && mini) setMini(false);
    },
    { threshold: 0.25, rootMargin: innerWidth >= 1000 ? '-70px 0px 0px 0px' : '50px 0px 0px 0px' },
  );
  io.observe($('[class*="MiniPlayerLayout_placeholder__"]'));
  function setMini(on) {
    mini = on;
    host.setAttribute('data-mini-player', String(on));
    jail.setAttribute('data-mini-player', String(on));
    draggable.setAttribute('data-open', String(on));
    $('[class*="MiniPlayerLayout_player__"]').setAttribute('data-open', String(on));
    $('[class*="MiniPlayerLayout_video__"]').setAttribute('data-open', String(on));
    if (on) unmountVod();
    else if (!next && isPlaying) mountVod();
    log('mini', { on });
  }

  // ---- 再生の開始・終了
  function startPlayback() {
    video.play().catch(() => {});
    const poster = $('[class*="PlayerThumbnail_wrapper__"]');
    if (poster) poster.remove();
    vjs.classList.remove('vjs-unstarted-mode');
    mountVod();
  }
  function begin() {
    if (O.questionnaire && !localStorage.getItem('fx-questionnaire')) {
      const m = doc.createElement('div');
      // 実サイトのアンケート: 誕生年（4 桁・例 2000）・誕生月（2 桁・例 4）・性別（ラジオ 3 つ）・郵便番号（7 桁・例 1050004）。inputmode はない
      m.innerHTML = '<div class="Modal_overlay__zBMug"></div><div role="dialog" data-state="open" class="Modal_content__iSFyO" tabindex="-1"><form id="questionnaire-_r_l_">' +
        '<label for="q-y">誕生年（必須）</label><input id="q-y" name="birthYear" maxlength="4" placeholder="2000">' +
        '<label for="q-m">誕生月（必須）</label><input id="q-m" name="birthMonth" maxlength="2" placeholder="4">' +
        '<div role="radiogroup" aria-label="性別"><button type="button" role="radio" aria-checked="false" value="1">男性</button><button type="button" role="radio" aria-checked="false" value="2">女性</button><button type="button" role="radio" aria-checked="false" value="9">その他</button></div>' +
        '<label for="q-p">郵便番号（必須）</label><input id="q-p" name="postCode" maxlength="7" placeholder="1050004">' +
        '</form><button type="button" aria-label="閉じる">閉じる</button><button type="submit" form="questionnaire-_r_l_">回答する</button></div>'; // 実サイトは、ボタンがフォームの外（モーダルの下の段）
      doc.body.appendChild(m);
      $('input', m).focus();
      m.addEventListener('click', (e) => {
        const r = e.target.closest('[role="radio"]');
        if (!r) return;
        m.querySelectorAll('[role="radio"]').forEach((x) => x.setAttribute('aria-checked', String(x === r)));
      });
      $('form', m).addEventListener('submit', (e) => {
        e.preventDefault();
        const g = m.querySelector('[role="radio"][aria-checked="true"]');
        log('questionnaire-submit', { values: { birthYear: $('[name=birthYear]', m).value, birthMonth: $('[name=birthMonth]', m).value, gender: g ? g.value : '', postCode: $('[name=postCode]', m).value } });
        localStorage.setItem('fx-questionnaire', '1'); m.remove(); startPlayback();
      });
      log('questionnaire');
      return;
    }
    startPlayback();
  }
  const bindPoster = () => {
    $('#episode-play').addEventListener('click', begin);
    $('#episode-play').focus(); // React の autoFocus
  };
  if ($('#episode-play')) bindPoster();
  if (O.autoplay) addEventListener('load', () => setTimeout(() => { video.muted = true; startPlayback(); }, O.autoplayDelay || 0));

  video.addEventListener('play', () => { isPlaying = true; vjs.classList.remove('vjs-paused'); vjs.classList.add('vjs-playing', 'vjs-has-started'); updateVod(); });
  video.addEventListener('pause', () => { vjs.classList.add('vjs-paused'); vjs.classList.remove('vjs-playing'); updateVod(); });
  video.addEventListener('timeupdate', updateVod);
  video.addEventListener('ended', () => {
    isPlaying = false;
    unmountVod();
    if (doc.activeElement && doc.activeElement !== doc.body) doc.activeElement.blur();
    showNext();
  });
  doc.addEventListener('fullscreenchange', () => { log('fullscreenchange', { on: !!doc.fullscreenElement }); updateVod(); });

  // ---- プレイヤーを初期状態へ戻す（実サイト: 終了後の案内で「閉じる」を押すと、TVer が全画面を終え、プレイヤーを作り直してポスターを出す）
  function resetPlayer() {
    log('reset');
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
    if (next) { next.el.remove(); next = null; }
    isPlaying = false;
    video.pause();
    video.currentTime = 0;
    vjs.classList.add('vjs-unstarted-mode', 'vjs-paused');
    vjs.classList.remove('vjs-playing', 'vjs-has-started');
    if (!$('#episode-play')) {
      const w = doc.createElement('div');
      w.className = 'PlayerThumbnail_wrapper__LoArZ';
      w.innerHTML = '<button id="episode-play" type="button" class="PlayerThumbnail_playButton__7SrdI" aria-label="再生" autofocus>▶</button>';
      box.appendChild(w);
      bindPoster();
    }
  }

  // ---- 次のエピソード
  function showNext() {
    if (O.nextEpisode === false) return;
    const wait = O.nextWait == null ? 5 : O.nextWait;
    const el = doc.createElement('div');
    el.className = 'NextEpisodeThumbnail_nextEpisodeThumbnail__8kq7F';
    el.innerHTML =
      '<div class="NextEpisodeThumbnail_cancelContainer__4weSO"><button type="button" class="IconButton_button__Wx8Wn" aria-label="閉じる">×</button></div>' +
      '<div class="NextEpisodeThumbnail_container__vRqcz"><div><div class="NextEpisodeThumbnail_info__kTybh"><span>次のエピソードまで <b class="fx-count">' + wait + '</b> 秒...</span></div>' +
      '<button type="button" class="AutoPlayThumbnail_wrapper__3J0fi" aria-label="第5回 次のタイトル を再生" autofocus>▶</button></div></div>';
    $('[class*="EpisodePlayer_container__"]').appendChild(el);
    next = { el, left: wait };
    $('[class*="AutoPlayThumbnail_wrapper__"]', el).focus();
    const go = () => { log('navigate'); fx.navigations.push('/episodes/epnext?play=next'); history.pushState(null, '', '/episodes/epnext?play=next'); el.remove(); next = null; };
    const tick = setInterval(() => {
      if (!next) return clearInterval(tick);
      next.left -= 1;
      const c = $('.fx-count', el);
      if (c) c.textContent = String(next.left);
      if (next.left <= 0) { clearInterval(tick); go(); }
    }, 1000);
    $('[class*="AutoPlayThumbnail_wrapper__"]', el).addEventListener('click', () => { clearInterval(tick); go(); });
    $('[aria-label="閉じる"]', el).addEventListener('click', () => {
      clearInterval(tick);
      log('next-cancel');
      if (O.cancelKeepsPanel) $('.NextEpisodeThumbnail_info__kTybh span', el).textContent = 'こちらはいかがですか？';
      else resetPlayer();
    });
    log('next-shown', { wait });
  }

  fx.state = () => ({
    view: vod ? 'vod' : mini ? 'mini' : next ? 'next' : $('#episode-play') ? 'poster' : 'none',
    ctlActive: !!vod && vod.classList.contains(ACTIVE),
    fullscreen: !!doc.fullscreenElement,
    fullscreenIsHost: doc.fullscreenElement === host,
    mini,
    paused: video.paused,
    t: video.currentTime,
    speed,
    popup: !!popover,
    next: !!next,
    active: doc.activeElement ? (doc.activeElement.getAttribute('aria-label') || doc.activeElement.className || doc.activeElement.tagName) : null,
  });
  log('start');
}

/** ページに差し込むスクリプト。 */
export function playerScript(o = {}) {
  const opts = { live: !!o.live, questionnaire: !!o.questionnaire, autoplay: !!o.autoplay || !!o.live, autoplayDelay: o.autoplayDelay || 0, nextEpisode: o.nextEpisode !== false, nextWait: o.nextWait == null ? 5 : o.nextWait, cancelKeepsPanel: !!o.cancelKeepsPanel, timers: o.timers || null, svg: JSON.stringify(SVG) };
  return `<script>(${runtime.toString()})(${JSON.stringify(opts)});</script>`;
}
