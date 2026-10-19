// TVer の構造を簡易再現した HTML（2026-10-18 の実 DOM を縮小したもの）。
// クラス名は実サイトと同じ（CSS Modules のハッシュ付き）にして、拡張のセレクタが実物と同じ条件で一致するか検証する。
// ネットワーク不要（Playwright の route で https://tver.jp/** として返す）。
// 再生ページのプレイヤー（DOM・CSS・挙動）は tver-player.mjs（実サイトの構造と挙動の再現）。
import { playerMarkup, playerCss, playerScript } from './tver-player.mjs';

const THEME_INIT = `
(function(){try{var t=localStorage.getItem('appearanceMode');var e;
if(t!==null)e=t!=='system'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');else e='light';
var c=document.documentElement.classList;c.remove('light','dark');c.add(e)}catch(x){}})();`;

const CSS = `
:root { --color-state-focused: #0D99E5; --borderWidth-2: 2px; }
${playerCss}
html.light { background: #fff; color: #111; }
html.dark { background: #0d0d0d; color: #fafafa; }
body { margin: 0; font: 14px/1.4 sans-serif; }
a { color: inherit; text-decoration: none; }
a:focus, button:focus, input:focus { outline-width: 0; }
.ContentCard_root__tVcTy:focus-visible { outline: none; }
.ContentCard_root__tVcTy:focus-visible:after { content: ""; position: absolute; inset: 2px; box-shadow: 0 0 0 var(--borderWidth-2) var(--color-state-focused); pointer-events: none; }
.Navigation_item__0cTKs > a:focus-visible { outline: var(--borderWidth-2) solid var(--color-state-focused); outline-offset: 2px; }

#__next { isolation: isolate; }
.AppLayout_app__oNjub { --side-column-width: 88px; --logo-block-height: 72px; display: grid; grid-template-areas: "sidebar main main" "sidebar breadcrumb breadcrumb" "sidebar footer footer"; grid-template-rows: minmax(500px, 1fr) auto auto; grid-template-columns: var(--side-column-width) 1fr 1fr; min-height: 100vh; }
.AppLayout_expand__LAmfi { --side-column-width: 180px; }
header.AppLayout_header__fXKN3 { position: fixed; inset: 0; z-index: 40; pointer-events: none; }
header .AppLayout_icon___xDtb { position: absolute; left: 32px; top: 20px; width: 40px; height: 40px; pointer-events: auto; }
header .AppLayout_title__G63QD { display: flex; align-items: center; width: var(--side-column-width); height: var(--logo-block-height); margin: 0; padding: 16px 0 8px 72px; box-sizing: border-box; pointer-events: auto; }
header .AppLayout_homeLink__Pu8fx { display: block; width: 74px; height: 54px; }
header .AppLayout_actions__lWoja { position: absolute; right: 20px; top: 20px; pointer-events: auto; display: flex; gap: 8px; }
header .SearchForm_keyword__ydWLP { width: 230px; height: 40px; }

nav.AppLayout_navigation___P_8g { position: sticky; top: var(--logo-block-height); grid-area: sidebar; z-index: 35; height: calc(100dvh - var(--logo-block-height)); margin-top: var(--logo-block-height); overflow: auto; }
nav ul { list-style: none; margin: 0; padding: 0 0 0 20px; }
nav a { display: block; height: 48px; line-height: 48px; padding-left: 12px; }
nav .Navigation_category__RJdGJ a { height: 34px; line-height: 34px; }

main.AppLayout_main__zLLx6 { grid-area: main; position: relative; padding: 72px 16px 40px 16px; }
.AppBanner_link__ZN3u4 { display: block; height: 66px; background: #444; margin-bottom: 12px; }
.BillboardList_billboard__bZDGl { display: flex; gap: 10px; overflow-x: auto; height: 300px; margin-bottom: 12px; }
.BillboardList_link__UFTzm { position: relative; flex: none; width: 520px; height: 280px; background: #555; }
section.Carousel_carousel__oFth7 { position: relative; margin: 0 0 18px; }
.ComponentCaption_caption__o3_Xc { display: flex; justify-content: space-between; margin: 0 0 8px; }
.ComponentCaption_title__jSll1 { margin: 0; font-size: 16px; }
ul.Carousel_list__8Pj28 { display: flex; gap: 12px; list-style: none; margin: 0; padding: 0; overflow-x: auto; }
li.Carousel_item__PVkWB { flex: none; width: 300px; }
a.ContentCard_root__tVcTy { position: relative; display: block; height: 200px; background: #2a2a2a; }
.ContentCard_head__E6UVH { height: 140px; background: #3a3a3a; }
.Carousel_control__ZABWk { position: absolute; right: 0; top: 40px; width: 40px; height: 40px; }
footer.Footer_footer__1S72C { grid-area: footer; padding: 20px 16px 60px; }
.AppLayout_breadcrumb__RqtoX { grid-area: breadcrumb; padding: 12px 16px; }
.Breadcrumb_list__6FiUn { display: flex; gap: 8px; list-style: none; margin: 0; padding: 0; }

.Episode_container__5PBil { display: flex; gap: 20px; }
.Episode_main__wm1U7 { flex: 1; min-width: 0; }
.EpisodeDescription_root__SdcHi { padding: 12px 0; }
.Episode_side__fx { width: 300px; }

.SeasonEpisodeList_episodes__gJ9N8 { display: flex; flex-direction: column; gap: 16px; width: 640px; margin: 40px 0 0 60px; }
.SeasonEpisodeListItem_popupContainer__w5POT { position: relative; }
.SeasonEpisodeListItem_popup__Qhwtq { position: absolute; top: -37px; left: -28px; z-index: 2; width: calc(100% + 56px); opacity: 0; animation: 0.1s ease-in-out 0.2s 1 normal forwards running fx-fadein; }
@keyframes fx-fadein { from { opacity: 0; } to { opacity: 1; } }
.EpisodeListItemPopup_popupContainer__5iiQt { display: grid; grid-template: "thumbnail info" "thumbnail description" "thumbnail action" / 260px 1fr; column-gap: 16px; border-radius: 12px; background: #1f2229; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
.EpisodeListItemPopup_thumbnail__mUhLs { grid-area: thumbnail; display: block; width: 260px; height: 146px; background: #3a3a3a; }
.EpisodeListItemPopup_textContainer__HiI3Q { grid-area: info; display: flex; flex-direction: column; }
.EpisodeListItemPopup_description__oZZff { grid-area: description; display: block; }
.EpisodeListItemPopup_actionButton__BEhXl { grid-area: action; display: flex; gap: 16px; }
`;

const card = (id, title, kind = 'Episode') => `
<li class="Carousel_item__PVkWB"><a class="ContentCard_root__tVcTy ${kind}Card_root__AeVlo" data-direction="vertical" href="/${kind === 'Series' ? 'series' : 'episodes'}/${id}" data-id="${id}">
  <div class="ContentCard_head__E6UVH"></div><div class="ContentCard_body__fYzjT"><span class="Title_root__4Nr7I">${title}</span></div></a></li>`;

const row = (title, seeAllHref, cards) => `
<div class="home-page-main_component__pPv3b">
<div class="HorizontalList_caption__NIydK ComponentCaption_caption__o3_Xc"><h3 class="ComponentCaption_title__jSll1">${title}</h3><a class="ComponentCaption_more__lYS0f" href="${seeAllHref}" data-id="more-${seeAllHref.split('/').pop()}">すべてみる</a></div>
<section class="Carousel_carousel__oFth7 Carousel_hover__BtQYG">
  <ul class="Carousel_list__8Pj28">${cards}</ul>
  <button class="Carousel_control__ZABWk" type="button" aria-label="次へ">›</button>
</section>
</div>`;

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

function layout(title, main, bodyExtra = '') {
  return `<!doctype html>
<html lang="ja" class="light"><head><meta charset="utf-8"><title>${title}</title>
<script>${THEME_INIT}</script><style>${CSS}</style></head>
<body><div id="__next"><div class="AppLayout_app__oNjub AppLayout_expand__LAmfi">
<header class="AppLayout_header__fXKN3">
  <button class="AppLayout_icon___xDtb" type="button" aria-label="メニューを閉じる" data-id="hamburger">≡</button>
  <h1 class="AppLayout_title__G63QD"><a class="AppLayout_homeLink__Pu8fx" href="/" data-id="logo">TVer</a></h1>
  <div class="AppLayout_actions__lWoja"><form class="SearchForm_form__ubeoG" method="get"><input class="SearchForm_keyword__ydWLP" name="keyword" placeholder="番組名・出演者で検索"></form><script>(function(){var f=document.currentScript.previousElementSibling,i=f.querySelector("input"),state="";i.addEventListener("input",function(){setTimeout(function(){state=i.value},30)});f.addEventListener("submit",function(e){e.preventDefault();if(!state)return;(window.__searches=window.__searches||[]).push(state);history.pushState(null,"","/search/"+encodeURIComponent(state))})})();</script><button class="Visitor_icon__npLCK" type="button" aria-label="メニューを開く・閉じる" data-id="settings">⚙</button></div>
</header>
<nav class="AppLayout_navigation___P_8g Navigation_nav__izc5G Navigation_navExpand__JHNX8">
  <ul class="Navigation_list__6wPZB Navigation_expand__3GBum">
    <li class="Navigation_item__0cTKs Navigation_main__FYQjc"><a href="/" data-id="rail-home"><span>ホーム</span></a></li>
    <li class="Navigation_item__0cTKs Navigation_main__FYQjc"><a href="/search" data-id="rail-search"><span>さがす</span></a></li>
    <li class="Navigation_item__0cTKs Navigation_main__FYQjc"><a href="/live" data-id="rail-live"><span>リアルタイム</span></a></li>
  </ul>
  <ul class="Navigation_list__6wPZB Navigation_expand__3GBum">
    <li class="Navigation_item__0cTKs Navigation_category__RJdGJ"><a href="/categories/drama" data-id="rail-drama"><span>ドラマ</span></a></li>
    <li class="Navigation_item__0cTKs Navigation_category__RJdGJ"><a href="/categories/variety" data-id="rail-variety"><span>バラエティ</span></a></li>
  </ul>
</nav>
<main class="AppLayout_main__zLLx6">${main}</main>
<div class="AppLayout_breadcrumb__RqtoX"><ul class="Breadcrumb_list__6FiUn"><li class="Breadcrumb_item__sH18p"><a href="/" data-id="crumb-home">ホーム</a></li><li class="Breadcrumb_item__sH18p"><a href="/categories/drama" data-id="crumb-drama">ドラマ</a></li></ul></div>
<footer class="Footer_footer__1S72C"><a class="Footer_link__HYzs_" href="/tos" data-id="tos">利用規約</a>
  <a class="Footer_snsLink__e3z9E" href="https://x.com/TVer_official" data-id="x">X</a></footer>
</div></div><script>document.querySelector('[data-id="hamburger"]').addEventListener('click', function () { document.querySelector('nav').classList.toggle('Navigation_navExpand__JHNX8'); });</script>${bodyExtra}</body></html>`;
}

export function homeMain() {
  const billboard = `
<div class="BillboardList_billboard__bZDGl">
  <a class="BillboardList_link__UFTzm" href="/episodes/epclone" data-id="clone" style="order:10">clone</a>
  <a class="BillboardList_link__UFTzm" href="/episodes/epb1" data-id="b1">B1</a>
  <a class="BillboardList_link__UFTzm" href="/episodes/epb2" data-id="b2">B2</a>
  <a class="BillboardList_link__UFTzm" href="/episodes/epb3" data-id="b3">B3</a>
</div>`;
  const main = `
<a class="AppBanner_link__ZN3u4 home-page-main_appBanner__HIt2Z" href="https://5kun.adj.st/tver.jp?x=1" data-id="app-banner">アプリで！</a>
${billboard}
${row('ドラマランキング', '/rankings/episode/drama', range(8).map((i) => card('epd' + i, 'D' + i)).join(''))}
${row('バラエティランキング', '/rankings/episode/variety', range(8).map((i) => card('epv' + i, 'V' + i)).join(''))}
${row('おすすめの番組', '/specials/reco', range(6).map((i) => card('srs' + i, 'S' + i, 'Series')).join(''))}`;
  return main;
}

export function homeHtml() {
  return layout('TVer fixture – home', homeMain());
}

/**
 * 実サイトのビルボード（注目作品）を再現したホーム。keen-slider のループ型スライダー:
 * overflow: clip の ul、スライドは transform で動く（スクロールでは動かせない）、画像は a の中で絶対配置（a の outline を隠す）、
 * ページ送りのボタンは画面に出ない（click() で切り替わる）。autoplayMs > 0 なら自動で次のスライドへ回る。
 * ビルボードの下に、除外されるリンク（別サブドメイン・新しいタブ）のバナー行を置く。
 * @param {{autoplayMs?:number, slides?:number}} [o]
 */
export function homeKeenHtml(o = {}) {
  const n = o.slides || 5;
  const W = 560;
  const GAP = 10;
  const slides = range(n)
    .map(
      (i) => `<li class="Slider_item__b1MHJ keen-slider__slide${i === 1 ? ' Slider_active__mZLzq' : ''}"><div class="kn-box"><a class="BillboardList_link__UFTzm" href="/episodes/epbb${i}" data-id="s${i - 1}"><img class="Thumbnail_img__DBLSJ" alt="" src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="></a></div><div class="Slider_overlay__r4EFt"></div></li>`,
    )
    .join('');
  const selectors = range(n)
    .map((i) => `<button class="BillboardList_selectorItem__9CaKW${i === 1 ? ' BillboardList_selectorItemActive__AzWZq' : ''}" type="button" aria-label="slide ${i - 1}"></button>`)
    .join('');
  const main = `<style>
.kn-wrap { margin-bottom: 12px; }
ul.keen-slider { display: flex; position: relative; overflow: clip; height: 280px; margin: 0; padding: 0; list-style: none; }
li.keen-slider__slide { position: relative; overflow: hidden; flex: none; width: ${W}px; height: 280px; margin-right: ${GAP}px; transition: transform 200ms; border-radius: 12px; }
.kn-box { position: relative; width: 100%; height: 100%; overflow: hidden; }
.kn-box a { display: block; width: 100%; height: 100%; }
.kn-box img.Thumbnail_img__DBLSJ { position: absolute; left: 0; top: 0; width: 100%; height: 100%; background: #666; }
.Slider_overlay__r4EFt { position: absolute; inset: 0; pointer-events: none; }
button.BillboardList_selectorItem__9CaKW { display: none; }
.BannerList_list__x { display: flex; gap: 12px; margin-bottom: 12px; }
.BannerList_link__7Xa6a { display: block; width: 260px; height: 100px; background: #444; }
</style>
<div class="BillboardList_billboard__bZDGl kn-wrap">
  <ul class="keen-slider">${slides}</ul>
  ${selectors}
</div>
<div class="BannerList_list__x">
  <a class="BannerList_link__7Xa6a" href="https://schedule-drama.tver.jp/meisaku" data-id="sub-banner">別サイトのバナー</a>
  <a class="BannerList_link__7Xa6a" href="/_l/promo/" target="_blank" rel="noopener" data-id="blank-link">新しいタブのバナー</a>
</div>
${row('ドラマランキング', '/rankings/episode/drama', range(8).map((i) => card('epd' + i, 'D' + i)).join(''))}
${row('バラエティランキング', '/rankings/episode/variety', range(8).map((i) => card('epv' + i, 'V' + i)).join(''))}
<script>
(function () {
  var N = ${n}, W = ${W} + ${GAP}, active = 0;
  var slides = document.querySelectorAll('li.keen-slider__slide');
  var sel = document.querySelectorAll('[class*="BillboardList_selectorItem__"]');
  function render() {
    slides.forEach(function (li, i) {
      var shown = ((i - active + N) % N) * W;
      li.style.transform = 'translateX(' + (shown - i * W) + 'px)';
      li.classList.toggle('Slider_active__mZLzq', i === active);
    });
    sel.forEach(function (b, i) { b.classList.toggle('BillboardList_selectorItemActive__AzWZq', i === active); });
  }
  sel.forEach(function (b, i) { b.addEventListener('click', function () { active = i; render(); }); });
  render();
  // 橋の再現: 実サイトは React fiber のフックに keen-slider のインスタンスが入っている。選択ボタンは前向きにしか回らない（実サイトと同じ）
  var BRIDGE = ${o.bridge ? "true" : "false"};
  window.__bbMoves = []; window.__bbClicks = []; window.__bbPause = [];
  sel.forEach(function (b, i) { b.addEventListener('click', function () { window.__bbClicks.push(i); }); });
  if (BRIDGE) {
    var ul = document.querySelector('ul.keen-slider');
    var inst = {
      container: ul,
      track: { details: { slides: new Array(N), slidesLength: N, get rel() { return active; } }, absToRel: function (a) { return ((a % N) + N) % N; } },
      animator: { active: false, targetIdx: null },
      moveToIdx: function (i) { window.__bbMoves.push(i); active = i; render(); },
      emit: function (name) { window.__bbPause.push(name); },
    };
    ul['__reactFiber$fake'] = { memoizedState: null, return: { type: function () {}, memoizedState: { memoizedState: { current: inst }, next: null }, return: null } };
  }
  var ms = ${Number(o.autoplayMs) || 0};
  if (ms > 0) setInterval(function () { active = (active + 1) % N; render(); }, ms);
})();
</script>`;
  return layout('TVer fixture – home (keen billboard)', main);
}

export function searchMain() {
  const chips = ['新着', '終了間近', 'ランキング', '番組表']
    .map((t, i) => `<a class="Button_button__ZKEys Button_secondary__llBju PurposeSearchSection_button__0LSHY" href="/${['newer', 'ender', 'rankings', 'program'][i]}" data-id="purpose-${i}">${t}</a>`)
    .join(' ');
  const main = `<h1>さがす</h1><h2>目的から探す</h2><div>${chips}</div>
<h2>ジャンルから探す</h2><div><a class="GenreSearchSection_card__RcgRS" href="/categories/drama" data-id="genre-drama">ドラマ</a> <a class="GenreSearchSection_card__RcgRS" href="/categories/anime" data-id="genre-anime">アニメ</a></div>`;
  return main;
}

export function searchHtml() {
  return layout('TVer fixture – search', searchMain());
}

/**
 * Next.js のような SPA（クライアント遷移）を再現するページ。
 * 内部リンクのクリックは pushState で遷移し、main の中身は delay ミリ秒後に描画される（データ取得の遅れ）。
 */
export function spaHtml(delay = 800, o = {}) {
  const routes = { '/': homeMain(), '/search': searchMain() };
  const script = `<script>
const ROUTES = ${JSON.stringify(routes)};
const DELAY = ${Number(delay)};
const app = document.querySelector('main');
function render() {
  const html = ROUTES[location.pathname] || '<p>not found</p>';
  app.innerHTML = '';
  setTimeout(() => { app.innerHTML = html; }, DELAY);
}
addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"]');
  if (!a) return;
  e.preventDefault();
  history.pushState(null, '', a.getAttribute('href'));
  render();
});
addEventListener('popstate', render);
render();
</script>`;
  // outsideMain: main の外（パンくず・フッター以外）に、除外されないリンクがある構成
  const aside = o.outsideMain ? '<aside class="Promo_box__Qz1xA"><a href="/specials/promo" data-id="aside-link">特集</a></aside>' : '';
  return layout('TVer fixture – SPA', '', aside + script);
}

/**
 * エピソード（再生）ページ。プレイヤーは実サイトと同じ構造（tver-player.mjs）。
 * @param {{videoSrc?:string, autoplay?:boolean, autoplayDelay?:number, questionnaire?:boolean, nextWait?:number, nextEpisode?:boolean, cancelKeepsPanel?:boolean, timers?:{normal:number,sticky:number}}} [o]
 */
export function episodeHtml(o = {}) {
  const player = playerMarkup(o);
  const info = `
<div class="Episode_info__kcc0w"><div class="EpisodeDescription_root__SdcHi">
  <h2 class="EpisodeDescription_seriesTitle__Z2k3j">テスト番組</h2>
  <h1 class="EpisodeDescription_title__ZuCXz">第1話 サンプルのタイトル</h1>
  <span class="EpisodeDescription_producer__CVH_D">テスト放送局</span>
  <div class="EpisodeDescription_broadcastDateLabel__rMYc9"><span>10月10日(土)放送分</span></div>
  <a href="https://5kun.adj.st/tver.jp/episodes/eptest?x=1" id="episode-app-link" class="Button_button__ZKEys WatchOnApp_button__Nv5te">アプリで視聴する</a>
  <a href="/series/srtest" class="Button_button__ZKEys EpisodeDescription_seriesLink__h5orN" data-id="series-link">番組TOPへ</a>
</div></div>
<ul class="Carousel_list__8Pj28" style="flex-direction:column">${range(4).map((i) => card('epl' + i, 'L' + i)).join('')}</ul>`;
  const main = `<div data-episode-page="true" class="Episode_container__5PBil"><div class="Episode_main__wm1U7">${player}${info}</div>
<div class="Episode_side__fx"><a class="RecommendListItem_card__uPG86" href="/episodes/eprec1" data-id="rec1">おすすめ1</a></div></div>`;
  return layout('TVer fixture – episode', main, playerScript(o));
}

/**
 * 番組（シリーズ）ページ。エピソード一覧のカードは、TVer 標準の詳細ポップアップを持つ。
 * 実サイトと同じく、host（SeasonEpisodeListItem_popupContainer）に mouseover が来たら React がポップアップを作り、mouseout で消す。
 */
export function seriesHtml(o = {}) {
  const n = o.count || 5;
  const items = range(n)
    .map(
      (i) => `<div class="SeasonEpisodeListItem_popupContainer__w5POT" data-host="${i}">
  <a class="ContentCard_root__tVcTy EpisodeCard_root__AeVlo" href="/episodes/eps${i}" data-id="eps${i}">
    <div class="ContentCard_head__E6UVH"></div><div class="ContentCard_body__fYzjT"><span class="Title_root__4Nr7I">第${i}話</span></div></a>
</div>`,
    )
    .join('');
  const main = `<div class="Series_container__x1"><h1>テスト番組</h1><div class="SeasonEpisodeList_episodes__gJ9N8">${items}</div></div>`;
  const script = `<script>
(function () {
  var hosts = document.querySelectorAll('[class*="SeasonEpisodeListItem_popupContainer__"]');
  window.__popupLog = [];
  hosts.forEach(function (h) {
    var id = h.getAttribute('data-host');
    h.addEventListener('mouseover', function () {
      if (h.querySelector('[class*="SeasonEpisodeListItem_popup__"]')) return;
      window.__popupLog.push('over ' + id);
      var d = document.createElement('div');
      d.className = 'SeasonEpisodeListItem_popup__Qhwtq';
      d.innerHTML = '<div class="EpisodeListItemPopup_popupContainer__5iiQt EpisodeListItemPopup_sizeL__UrF3s">'
        + '<a class="EpisodeListItemPopup_thumbnail__mUhLs" href="/episodes/eps' + id + '" data-id="pop-thumb"></a>'
        + '<a class="EpisodeListItemPopup_textContainer__HiI3Q" href="/episodes/eps' + id + '" data-id="pop-text"><div>第' + id + '話 タイトル</div><div>10月25日(日)20:59 終了予定</div></a>'
        + '<a class="EpisodeListItemPopup_description__oZZff" href="/episodes/eps' + id + '" data-id="pop-desc">あらすじ</a>'
        + '<div class="EpisodeListItemPopup_actionButton__BEhXl"><button type="button" aria-label="いいね登録" data-id="pop-like">いいね</button><button type="button" aria-label="あとでみる" data-id="pop-later">あとでみる</button></div></div>';
      h.appendChild(d);
    });
    h.addEventListener('mouseout', function (e) {
      if (e.relatedTarget && h.contains(e.relatedTarget)) return;
      window.__popupLog.push('out ' + id);
      var p = h.querySelector('[class*="SeasonEpisodeListItem_popup__"]');
      if (p) p.remove();
    });
  });
})();
</script>`;
  return layout('TVer fixture – series', main, script);
}
