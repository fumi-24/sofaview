/*
 * TVer 固有のセレクタとページ判定。**サイトの DOM 依存はここに集約する**（SPEC D5）。
 *
 * 安定度（SPEC 9.6）: URL・属性・ARIA・id を優先し、CSS Modules のクラスは
 * ハッシュ部分を前提にしない（[class*="Name_part__"]）。
 * 調査日: 2026-10-18（docs/NOTES.md）。
 */
(function (root) {
  'use strict';

  const SV = (root.SV = root.SV || {});

  const SEL = Object.freeze({
    rail: 'nav',
    main: 'main',
    header: 'header',
    footer: 'footer',
    breadcrumb: '[class*="Breadcrumb_"], [class*="AppLayout_breadcrumb"], [aria-label="breadcrumb"]',
    card: '[class*="ContentCard_root__"]',
    billboardLink: '[class*="BillboardList_link__"]',
    billboardSelector: '[class*="BillboardList_selectorItem__"]', // スライダーのページ送りボタン（画面には出ないが、click() で切り替えられる）
    billboardSelectorActive: '[class*="BillboardList_selectorItemActive__"]',
    carouselControl: '[class*="Carousel_control"]',
    carouselList: '[class*="Carousel_list__"]', // 横スクロールの行（棚）のカード列
    carouselSection: '[class*="Carousel_carousel__"]',
    caption: '[class*="ComponentCaption_caption__"]', // 行の見出し（section の直前の兄弟）
    appBanner: '[class*="AppBanner_"]',
    searchForm: '[class*="SearchForm_"]',
    hamburger: '[class*="AppLayout_icon__"], header button[aria-label="メニューを閉じる"], header button[aria-label="メニューを開く"]',
    appCta: '#episode-app-link, [class*="WatchOnApp_"]',
    episodePage: '[data-episode-page="true"]',
    // ---- 視聴画面（プレイヤー）。動作に使うのは、TVer 自身が明示している属性と ARIA ラベルだけ（クラス名のハッシュ部分は見た目の CSS だけ）
    questionnaire: 'form[id^="questionnaire-"]', // 初めて再生するときの必須アンケート（誕生年・誕生月・性別・郵便番号）
    searchInput: 'form input[name="keyword"], input[class*="SearchForm_keyword"]', // ヘッダーのキーワード検索（拡張のスキンでは隠れているが、DOM にはある）
    posterPlay: '#episode-play', // 再生前のサムネイルの再生ボタン（TVer が autoFocus する）
    watchHost: '[js-fullscreen-target]', // 全画面の対象（PlayerLayout_host）。TVer 自身の全画面ボタンがこれに requestFullscreen する
    watchController: '[data-fullscreen]', // 操作盤（VodController）。host の中。ミニプレイヤーの操作盤には付かない
    playerRoot: '.video-js, .streaks-player',
    watchPopup: '[role="dialog"][data-state="open"]', // 再生速度・画質のポップアップ（Radix。host の中にそのまま出る）
    nextPlay: 'button[aria-label$="を再生"], [class*="AutoPlayThumbnail_"] button, button[class*="AutoPlayThumbnail_"]', // 次のエピソードの案内（再生が終わったあと）
    nextClose: '[class*="NextEpisodeThumbnail_"] button[aria-label="閉じる"], button[aria-label="閉じる"]',
    miniClose: '[js-fullscreen-target][data-mini-player="true"] button[aria-label="閉じる"]', // ミニプレイヤーの「閉じる」（再生を止めて破棄する）
    dialog: '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]',
    episodeTitle: '[class*="EpisodeDescription_title__"]',
    timeline: '[class*="LiveTimeline_container__"]', // リアルタイム配信の番組表（右）
    liveTitle: '[class*="LiveDescription_titleContent__"]', // リアルタイム配信のページ（/live/局）
    liveDetail: '[class*="LiveDescription_detail__"]', // 局・放送時間
    seriesTitle: '[class*="EpisodeDescription_seriesTitle__"]',
    producer: '[class*="EpisodeDescription_producer__"]',
    broadcastDate: '[class*="EpisodeDescription_broadcastDateLabel__"]',
    navExpanded: '[class*="Navigation_navExpand__"]',
    tab: '[role="tab"]',
    purposeButton: '[class*="PurposeSearchSection_button__"]',
    // 詳細ポップアップ（TVer 標準。エピソード一覧のカードにマウスを載せると、横に大きく出る）。host はカードとポップアップを囲む要素
    popupHost: '[class*="SeasonEpisodeListItem_popupContainer__"]',
    popup: '[class*="SeasonEpisodeListItem_popup__"]',
  });

  const LIST_PATH = /^\/(categories|rankings|specials|talents|channels|tags|program|newer|ender|lp|olympic)(\/|$)/;

  /** パスからページ種別を判定する。 */
  function pageType(pathname) {
    const p = String(pathname || '/').replace(/\/+$/, '') || '/';
    if (p === '/') return 'home';
    if (p === '/search') return 'search';
    if (/^\/episodes\/[^/]+$/.test(p)) return 'episode';
    if (/^\/series\/[^/]+$/.test(p)) return 'series';
    if (p === '/live' || /^\/live\/.+/.test(p)) return 'live';
    if (LIST_PATH.test(p)) return 'list';
    return 'other';
  }

  /**
   * ページ種別を判定する。URL で分からない（未知の URL）ときだけ、ページの中身を見る:
   * エピソードページには data-episode-page="true" が付く。URL の体系が変わっても再生 HUD が使えるようにするための保険。
   */
  function detectType(pathname, doc) {
    const t = pageType(pathname);
    if (t !== 'other') return t;
    const d = doc || root.document;
    return d && d.querySelector && d.querySelector(SEL.episodePage) ? 'episode' : t;
  }

  function isPlayerPage(type) {
    return type === 'episode' || type === 'live';
  }

  /** 拡張が動く TVer のホスト（tver.jp だけ。help.tver.jp などのサブドメインは拡張が動かず、入ると戻れなくなる）か。 */
  function isInternalHost(host) {
    return String(host || '').toLowerCase() === 'tver.jp';
  }

  /** 外部サイト・新しいタブで開くリンクか（リモコンだけでは戻れなくなるのでフォーカス対象から外す）。 */
  function isExternalLink(el) {
    if (!el || el.tagName !== 'A') return false;
    if (el.getAttribute('target') === '_blank') return true; // 新しいタブ（番組ページのバナーなど）
    const href = el.getAttribute('href') || '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return false; // 相対リンクは内部
    if (/^(javascript|mailto|tel):/i.test(href)) return true;
    try {
      return !isInternalHost(new URL(href, 'https://tver.jp/').host);
    } catch (e) {
      return true;
    }
  }

  /** フォーカス候補から外す要素。 */
  function isExcluded(el) {
    if (el.closest(SEL.header)) return true; // ヘッダー（ロゴ・検索・設定）は対象外
    if (el.closest(SEL.footer)) return true; // 規約・SNS などのリンク
    if (el.closest(SEL.breadcrumb)) return true; // パンくず（ページ下部。main の外で、描画前は唯一の候補になって初期フォーカスを奪う。戻るは Esc）
    if (el.closest(SEL.appBanner)) return true;
    if (el.closest(SEL.popup)) return true; // 詳細ポップアップの中（カードと同じ遷移先のリンクと、ログインが要るボタン。表示するだけで、フォーカスは常にカード）
    if (el.closest(SEL.carouselControl)) return true;
    if (el.closest(SEL.appCta)) return true;
    if (el.closest('iframe')) return true;
    if (isExternalLink(el)) return true;
    return false;
  }

  /** 要素の領域名: modal（ダイアログ等）/ rail（左ナビ）/ content。 */
  function regionOf(el) {
    if (el.closest(SEL.dialog)) return 'modal';
    if (el.closest(SEL.rail)) return 'rail';
    return 'content';
  }

  /** ページ種別ごとの初期フォーカス候補（先に一致したものを優先）。 */
  function initialPrefer(type) {
    switch (type) {
      case 'home':
        return [SEL.billboardLink, SEL.card];
      case 'search':
        return [SEL.purposeButton, 'main button', 'main a[href]'];
      case 'episode':
      case 'live':
        return [SEL.posterPlay, SEL.tab, SEL.card];
      case 'list':
        return [SEL.billboardLink, SEL.card, 'main a[href]']; // カテゴリ等はホームと同じくビルボードがある
      case 'series':
        return [SEL.card, 'main a[href]'];
      default:
        return [];
    }
  }

  /**
   * ビルボード（注目作品。自動で回るスライダー）。スライドは transform で動き、overflow: clip なのでスクロールでは動かせない。
   * スライドとページ送りのボタン（画面には出ない）は同じ順序で、同じ数。見つからない・数が合わないときは null（普通の座標ナビに任せる）。
   *  - go(i): i 番目のスライドへ**最短で**回す。MAIN world の橋（sites/tver/billboard-main.js）が keen-slider の moveToIdx を呼ぶ。
   *    橋が使えないときは select(i)（ボタンの click。前向きにしか回らず、回っている間は捨てられる）に戻る
   *  - pause(on): 自動送りの停止／再開（橋があるときだけ）
   */
  function billboard(doc) {
    const d = doc || root.document;
    const links = Array.from(d.querySelectorAll(SEL.billboardLink));
    const selectors = Array.from(d.querySelectorAll(SEL.billboardSelector));
    if (!links.length || links.length !== selectors.length) return null;
    const de = d.documentElement;
    const call = (type, detail) => {
      de.removeAttribute('data-sv-bb-ack');
      d.dispatchEvent(new root.CustomEvent(type, { detail }));
      return de.getAttribute('data-sv-bb-ack') === 'ok';
    };
    return {
      links,
      indexOf(el) {
        const a = el && el.closest ? el.closest(SEL.billboardLink) : null;
        return a ? links.indexOf(a) : -1;
      },
      activeIndex() {
        return selectors.findIndex((b) => b.matches(SEL.billboardSelectorActive));
      },
      select(i) {
        if (!selectors[i]) return false;
        selectors[i].click();
        return true;
      },
      /** 'bridge'（橋で最短に回した）/ 'click'（選択ボタンの click。前向きのみ・回転中は捨てられる）/ false */
      go(i) {
        if (!links[i]) return false;
        if (call('sv-bb-go', i)) return 'bridge';
        return this.select(i) ? 'click' : false;
      },
      pause(on) {
        return call('sv-bb-pause', on ? 1 : 0);
      },
    };
  }

  /**
   * 要素が属する横スクロールの行（棚）。カード以外・行の外なら null。
   * 見出し（caption）は section の直前の兄弟。なければ section の上端を基準にする。
   */
  function rowOf(el) {
    const list = el && el.closest ? el.closest(SEL.carouselList) : null;
    if (!list) return null;
    const section = list.closest(SEL.carouselSection) || list;
    const prev = section.previousElementSibling;
    const caption = prev && prev.matches && prev.matches(SEL.caption) ? prev : null;
    const items = Array.from(list.children);
    return {
      list,
      anchor: caption || section,
      items,
      itemOf: (node) => items.find((li) => li.contains(node)) || null,
    };
  }

  /** 詳細ポップアップの host（カードを囲む要素）。なければ null。 */
  function popupHostOf(el) {
    return el && el.closest ? el.closest(SEL.popupHost) : null;
  }

  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

  /** 視聴画面のボタン（操作盤の中）。ARIA ラベルで探す。 */
  const labelBtn = (labels) => labels.map((l) => `button:has(svg[aria-label="${l}"])`).join(', ');
  const WATCH_BTN = Object.freeze({
    play: labelBtn(['再生', '一時停止', '停止']),
    skipBack: 'button:has(svg[aria-label$="秒戻る"])',
    skipFwd: 'button:has(svg[aria-label$="秒進む"])',
    speed: 'button[aria-label="再生速度の選択"]',
    quality: 'button[aria-label="画質を選択"]',
    fullscreen: labelBtn(['全画面', '全画面を終了']),
    volume: 'button:has(svg[aria-label^="音量"])',
  });

  /**
   * 視聴画面の部品。host（全画面の対象）が無ければ null。操作盤（ctl）は再生が始まるまで無い。見つからない部品は null で、動作は見つかった部品だけで続く。
   * 取得は呼ぶたびに DOM を探す（React が差し替えるので、参照を持ち続けない）。
   */
  function watchParts(doc) {
    const d = doc || root.document;
    const host = d.querySelector(SEL.watchHost);
    if (!host) return null;
    const ctl = host.querySelector(SEL.watchController);
    const parts = {
      host,
      ctl,
      video: host.querySelector('video'),
      player: host.querySelector(SEL.playerRoot),
      button: (name) => (ctl && WATCH_BTN[name] ? ctl.querySelector(WATCH_BTN[name]) : null),
      popup: () => host.querySelector(SEL.watchPopup),
      nextPlay: () => host.querySelector(SEL.nextPlay),
      nextClose: () => host.querySelector(SEL.nextClose),
      /** ボタン列で操作できるもの（DOM 順 = 左から右）。音量と全画面は /tv にないので見た目で隠している。隠れていないときも入れない。 */
      rowItems() {
        if (!ctl) return [];
        return Array.from(ctl.querySelectorAll('button')).filter((b) => !b.disabled && !b.matches(WATCH_BTN.volume + ', ' + WATCH_BTN.fullscreen) && b.getClientRects().length > 0);
      },
    };
    return parts;
  }

  /** プレイヤーの状態（Video.js / Streaks がルート要素に付けるクラス）。広告中・シーク不可の区間・ライブはシークしない（広告のスキップは提供しない）。 */
  function playerFlags(player, video, ctl) {
    const has = (c) => !!player && player.classList.contains(c);
    const liveCtl = !!ctl && /LiveController_/.test(String(ctl.className)); // リアルタイム配信の操作盤（LiveController）
    return {
      ad: has('vjs-ad-playing') || has('strp-adsactive') || has('strp-adbreaking'),
      noSeek: has('strp-no-seek'),
      live: liveCtl || has('vjs-live') || (!!video && video.readyState > 0 && !Number.isFinite(video.duration)),
    };
  }

  /** 視聴画面に出すタイトルとサブタイトル（番組名 • 放送局 • 放送日。/tv の「チャンネル • 再生回数 • 日付」の位置）。 */
  function meta(doc) {
    const d = doc || root.document;
    const title = text(d.querySelector(SEL.episodeTitle)) || text(d.querySelector(SEL.liveTitle)) || String(d.title || '').split('|')[0].trim();
    const parts = [text(d.querySelector(SEL.seriesTitle)), text(d.querySelector(SEL.producer)), text(d.querySelector(SEL.broadcastDate)), text(d.querySelector(SEL.liveDetail))].filter(Boolean);
    return { title, subtitle: parts.join(' • ') };
  }

  /** ヘッダーのキーワード検索のフォーム。なければ null。 */
  function searchForm(doc) {
    const d = doc || root.document;
    const input = d.querySelector(SEL.searchInput);
    return input ? { input, form: input.closest('form') } : null;
  }

  /** キーワード検索の結果ページ（TVer の /search/[keyword]）。 */
  function searchPath(keyword) {
    return '/search/' + encodeURIComponent(keyword);
  }

  function dialogOpen(doc) {
    const d = doc || root.document;
    for (const el of d.querySelectorAll(SEL.dialog)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return true;
    }
    return false;
  }

  const api = {
    SEL,
    pageType,
    detectType,
    isPlayerPage,
    isInternalHost,
    isExternalLink,
    isExcluded,
    regionOf,
    initialPrefer,
    billboard,
    popupHostOf,
    rowOf,
    WATCH_BTN,
    watchParts,
    playerFlags,
    meta,
    searchForm,
    searchPath,
    dialogOpen,
  };

  SV.tver = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
