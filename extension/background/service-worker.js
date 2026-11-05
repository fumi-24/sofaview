/*
 * SofaView Service Worker（ステートレス。状態は chrome.storage に置く）。
 *  - sv:goHub  : 送信元タブをハブ（拡張ページ）へ遷移させる
 *  - sv:zoom   : TVer の画面倍率を計算して chrome.tabs.setZoom で適用する
 *  - 設定に応じて DNR ルールセット（YouTube 通常URL → /tv 転送）を切り替える
 */
/* global importScripts, chrome */
importScripts('../common/sv.js', '../common/settings.js', '../common/zoom.js');

const SV = self.SV;
const HUB_URL = chrome.runtime.getURL(SV.HUB_PATH);

const YT_TV = 'https://www.youtube.com/tv';
const ytTabs = () => chrome.tabs.query({ url: YT_TV + '*' });
const isYt = (t) => !!t && (t.url || t.pendingUrl || '').startsWith(YT_TV);
const SPOTIFY = 'https://open.spotify.com/';
const isSpotify = (t) => !!t && (t.url || t.pendingUrl || '').startsWith(SPOTIFY);
const NP_URL = chrome.runtime.getURL('spotify/np.html'); // Spotify の再生中の画面（拡張の自前ページ。前面）。Spotify のタブは、再生エンジンとして、裏に置く
/** 再生中の画面のタブ（tabs 権限がないと、拡張のページの url は分からないので、ページが開いたとき知らせてきた id で探す）。 */
async function npTabs() {
  const { svNpTab } = await chrome.storage.session.get('svNpTab');
  if (svNpTab == null) return [];
  try {
    return [await chrome.tabs.get(svNpTab)];
  } catch (e) {
    return [];
  }
}

/** タブを前面に出す（ウィンドウも）。 */
async function activate(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
}

/**
 * スマホのリモコン用に、YouTube /tv を裏のタブで開いておく（設定 youtube.receiver）。
 * /tv は 1 つだけが受け取り役になれる（あとから開いたものが受け取る）ので、/tv のタブは常に 1 つだけにする。
 * 作った直後（url がまだ入る前）に重ねて作らないよう、作った時刻を覚えておく。
 */
async function ensureReceiver() {
  const s = await SV.settings.load();
  if (!s.youtube.receiver) return { ok: true, on: false };
  const existing = await ytTabs();
  if (existing.length > 1) {
    // /tv が 2 つ以上あると、あとから開いたほうだけが受け取る。前面のものを残し、残りは閉じて、再読み込みして登録し直す
    const keep = existing.find((t) => t.active) || existing[0];
    await chrome.tabs.remove(existing.filter((t) => t.id !== keep.id).map((t) => t.id)).catch(() => {});
    await chrome.tabs.reload(keep.id).catch(() => {});
    await chrome.storage.session.set({ svReceiverTab: keep.id });
    return { ok: true, on: true, created: false, deduped: true };
  }
  if (existing.length) return { ok: true, on: true, created: false };
  const { svReceiverAt } = await chrome.storage.session.get('svReceiverAt');
  if (svReceiverAt && Date.now() - svReceiverAt < 15000) return { ok: true, on: true, created: false };
  await chrome.storage.session.set({ svReceiverAt: Date.now() });
  const tab = await chrome.tabs.create({ url: YT_TV, active: false });
  await chrome.storage.session.set({ svReceiverTab: tab.id });
  return { ok: true, on: true, created: true };
}

/**
 * Spotify を、再生エンジンとして、裏のタブで開いておく（なければ作る。前面は奪わない）。Web プレーヤーは、開いているタブごとに「再生先」になる。
 * ほかのタブを閉じたり、重複を整えたりはしない（音楽が止まる）。再生中の画面（自前ページ）が開いたとき・ハブの Spotify タイルから呼ばれる。
 */
async function ensureSpotifyEngine(sender) {
  if (sender && sender.tab && sender.tab.id != null) await chrome.storage.session.set({ svNpTab: sender.tab.id }); // 再生中の画面のページが開いた（このメッセージを送るのは、そのページだけ）
  if ((await chrome.tabs.query({ url: SPOTIFY + '*' })).length) return { ok: true, created: false };
  const { svSpotifyAt } = await chrome.storage.session.get('svSpotifyAt');
  if (svSpotifyAt && Date.now() - svSpotifyAt < 15000) return { ok: true, created: false };
  await chrome.storage.session.set({ svSpotifyAt: Date.now() });
  const tab = await chrome.tabs.create({ url: SPOTIFY, active: false });
  await chrome.storage.session.set({ svSpotifyTab: tab.id });
  return { ok: true, created: true };
}

/**
 * スマホの Spotify から再生を始めたとき（Spotify Connect）に、再生中の画面を出せるよう、Spotify を裏のタブで開いておく（設定 spotify.standby）。
 */
async function ensureSpotifyStandby() {
  const s = await SV.settings.load();
  if (!s.spotify.standby) return { ok: true, on: false };
  const r = await ensureSpotifyEngine();
  return { ok: true, on: true, created: r.created };
}

/** どちらの待機タブも整える（YouTube /tv・Spotify）。 */
async function ensureStandby() {
  const a = await ensureReceiver();
  const b = await ensureSpotifyStandby();
  return { ok: true, youtube: a, spotify: b };
}

/**
 * Spotify のタブで曲が変わった（スマホから再生が始まった）とき、再生中の画面（自前ページ）を前面に出す（なければ開く）。設定 spotify.standby のとき。
 * すでに前面なら何もしない（操作中の画面を奪わない）。
 */
async function spotifyWake() {
  const s = await SV.settings.load();
  if (!s.spotify.standby) return { ok: true, woke: false };
  const tabs = await npTabs();
  if (tabs.some((t) => t.active)) return { ok: true, woke: false };
  if (tabs[0]) await activate(tabs[0]);
  else await chrome.tabs.create({ url: NP_URL, active: true });
  return { ok: true, woke: true };
}

/** 再生中の画面（自前ページ）からの操作の依頼を、Spotify のタブへ転送する。login は、Spotify のタブ（ログイン画面）を前面に出す。 */
async function spotifyCmd(msg) {
  const tabs = await chrome.tabs.query({ url: SPOTIFY + '*' });
  if (!tabs.length) return { ok: false, error: 'no-engine' };
  const send = (t) => new Promise((res) => chrome.tabs.sendMessage(t.id, { type: 'sv:spCmd', cmd: msg.cmd, arg: msg.arg }, (r) => res(chrome.runtime.lastError ? null : r)));
  await Promise.all(tabs.map(send));
  if (msg.cmd === 'login') await activate(tabs[0]);
  return { ok: true };
}

/** Spotify のタブの状態（曲・待機中・ログインしていない…）を覚える。ハブのタイルに出す。 */
async function recordSpotifyState(msg) {
  const keep = (v) => String(v == null ? '' : v).slice(0, 120);
  await chrome.storage.session.set({ svSpotifyState: { kind: keep(msg.kind), title: keep(msg.title), artists: keep(msg.artists), at: Date.now() } });
  return { ok: true };
}

/** ハブ用: Spotify のタブがあるか・前面か・最後に知らせてきた状態。 */
async function spotifyStatus() {
  const tabs = await chrome.tabs.query({ url: SPOTIFY + '*' });
  const { svSpotifyState } = await chrome.storage.session.get('svSpotifyState');
  return { ok: true, tab: tabs.length > 0, active: tabs.some((t) => t.active), state: tabs.length ? svSpotifyState || null : null, now: Date.now() };
}

/** ハブの YouTube タイル: 裏の /tv があれば、それを前面に出す（もう 1 つ /tv を開かない）。 */
async function openYoutube() {
  const s = await SV.settings.load();
  if (!s.youtube.receiver) {
    await chrome.storage.session.set({ svOpenLast: { at: Date.now(), how: 'off' } });
    return { ok: false };
  }
  const tabs = await ytTabs();
  if (tabs[0]) await activate(tabs[0]);
  else await chrome.tabs.create({ url: YT_TV, active: true });
  await chrome.storage.session.set({ svOpenLast: { at: Date.now(), how: tabs[0] ? 'activate' : 'create' } });
  return { ok: true };
}

/** スマホから YouTube を送られた（/tv が再生画面になった）とき、裏のタブなら前面に出す。 */
async function wake(sender) {
  const s = await SV.settings.load();
  if (!s.youtube.receiver || !sender.tab || sender.tab.active) return { ok: true, woke: false };
  await activate(sender.tab);
  return { ok: true, woke: true };
}

async function goHub(sender) {
  let tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (tabId == null) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0] && tabs[0].id;
  }
  if (tabId == null) return { ok: false, error: 'no-tab' };
  // 裏で /tv を開いておく設定のときは、/tv のタブは動かさずに、もう片方（ハブ・TVer）を前面に出す。/tv は再生を止めてホームに戻す
  if (sender && isYt(sender.tab)) {
    const s = await SV.settings.load();
    if (s.youtube.receiver) {
      const others = (await chrome.tabs.query({ windowId: sender.tab.windowId })).filter((t) => t.id !== sender.tab.id && !isYt(t) && !isSpotify(t));
      others.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      // /tv のタブは動かさない（遷移・再読み込みをすると、受け取り役がいなくなる）。ほかのタブがなければ、ハブを新しいタブで開く
      if (others[0]) await activate(others[0]);
      else await chrome.tabs.create({ url: HUB_URL, active: true, windowId: sender.tab.windowId });
      // 再生を止めて、ホームの画面に戻すだけ
      chrome.tabs.sendMessage(sender.tab.id, { type: 'sv:ytReset' }, () => void chrome.runtime.lastError);
      return { ok: true, receiver: true };
    }
  }
  // Spotify のタブは動かさない（遷移すると音楽が止まる）。ほかのタブ（ハブ・TVer）を前面に出す。なければハブを新しいタブで開く
  if (sender && isSpotify(sender.tab)) {
    const others = (await chrome.tabs.query({ windowId: sender.tab.windowId })).filter((t) => t.id !== sender.tab.id && !isYt(t) && !isSpotify(t));
    others.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    if (others[0]) await activate(others[0]);
    else await chrome.tabs.create({ url: HUB_URL, active: true, windowId: sender.tab.windowId });
    return { ok: true, spotify: true };
  }
  await chrome.tabs.update(tabId, { url: HUB_URL });
  ensureStandby().catch(() => {});
  return { ok: true };
}

async function applyZoom(sender, msg) {
  if (!sender || !sender.tab) return { ok: false, error: 'no-tab' };
  const tabId = sender.tab.id;
  const s = await SV.settings.load();
  const mode = s.zoom.mode;
  const current = await chrome.tabs.getZoom(tabId);
  // 最初の標本（settled でない）は、読み込み直後でページ側の倍率が遅れていることがある。矛盾していたら使わない。
  // 落ち着いてからの再確認（settled）で正しい標本が届く。
  if (mode === 'auto' && !msg.settled && !SV.zoom.isConsistent(Number(msg.dpr), current)) {
    return { ok: true, mode, current, target: null, applied: false, stale: true };
  }
  const target = SV.zoom.compute({
    innerHeight: Number(msg.innerHeight) || 0,
    currentZoom: current,
    mode,
    // サイトごとの目標の高さ（Spotify は小さめ＝大きく拡大）。自動のときだけ効く
    targetHeight: Number(msg.targetHeight) >= 360 && Number(msg.targetHeight) <= 1440 ? Number(msg.targetHeight) : s.zoom.targetHeight,
    factor: s.zoom.factor,
  });
  if (!SV.zoom.shouldApply(current, target)) return { ok: true, mode, current, target, applied: false };
  await chrome.tabs.setZoom(tabId, target);
  return { ok: true, mode, current, target, applied: true };
}

async function syncRulesets(s) {
  const settings = s || (await SV.settings.load());
  const on = !!settings.youtube.redirect;
  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds: on ? ['yt-redirect'] : [],
    disableRulesetIds: on ? [] : ['yt-redirect'],
  });
}

/** 診断ページ用: /tv がスマホから受け取った命令の名前（新しい順に最大 8 件）。 */
async function recordLounge(names) {
  if (!Array.isArray(names)) return { ok: false };
  const { svLounge = [] } = await chrome.storage.session.get('svLounge');
  const now = Date.now();
  const list = [...names.reverse().map((n) => ({ n: String(n).slice(0, 40), at: now })), ...svLounge].slice(0, 8);
  await chrome.storage.session.set({ svLounge: list });
  return { ok: true };
}

/** 診断用: /tv のページが読み込まれた回数と時刻（開き直すたびに読み込み直されていないか見る）。 */
async function recordYtLoaded() {
  const { svYtLoads } = await chrome.storage.session.get('svYtLoads');
  const n = ((svYtLoads && svYtLoads.n) || 0) + 1;
  await chrome.storage.session.set({ svYtLoads: { n, at: Date.now() } });
  return { ok: true, n };
}

/** 診断ページ用: スマホのリモコンの状態。 */
async function remoteStatus() {
  const s = await SV.settings.load();
  const tabs = await ytTabs();
  const { svLounge = [] } = await chrome.storage.session.get('svLounge');
  const { svYtLoads, svOpenLast } = await chrome.storage.session.get(['svYtLoads', 'svOpenLast']);
  return {
    ok: true,
    setting: !!s.youtube.receiver,
    yt: tabs.map((t) => ({ active: !!t.active, discarded: !!t.discarded, status: t.status })),
    lounge: svLounge,
    loads: svYtLoads || null,
    openLast: svOpenLast || null,
    now: Date.now(),
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  let p = null;
  switch (msg.type) {
    case 'sv:goHub':
      p = goHub(sender);
      break;
    case 'sv:zoom':
      p = applyZoom(sender, msg);
      break;
    case 'sv:ensureReceiver':
      p = ensureStandby();
      break;
    case 'sv:spotifyState':
      p = recordSpotifyState(msg);
      break;
    case 'sv:spotifyStatus':
      p = spotifyStatus();
      break;
    case 'sv:spotifyWake':
      p = spotifyWake();
      break;
    case 'sv:spCmd':
      p = spotifyCmd(msg);
      break;
    case 'sv:ensureSpotifyEngine':
      p = ensureSpotifyEngine(sender);
      break;
    case 'sv:openYoutube':
      p = openYoutube();
      break;
    case 'sv:wake':
      p = wake(sender);
      break;
    case 'sv:loungeSeen':
      p = recordLounge(msg.names);
      break;
    case 'sv:ytLoaded':
      p = recordYtLoaded();
      break;
    case 'sv:remoteStatus':
      p = remoteStatus();
      break;
    case 'sv:remoteKeep':
      p = sender.tab && sender.tab.id != null ? chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).then(() => ({ ok: true })) : Promise.resolve({ ok: false });
      break;
    case 'sv:info':
      p = Promise.resolve({ ok: true, version: SV.VERSION, id: chrome.runtime.id });
      break;
    default:
      return false;
  }
  p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true; // 非同期で応答する
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[SV.settings.KEY]) {
    syncRulesets().catch(() => {});
    ensureStandby().catch(() => {});
  }
});
chrome.runtime.onInstalled.addListener(() => {
  syncRulesets().catch(() => {});
  ensureStandby().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  syncRulesets().catch(() => {});
  ensureStandby().catch(() => {});
});
// どこかのタブが別のページへ移ったとき（/tv から出て受け取り役がいなくなった、/tv が 2 つになった）も、少しあとに整える
let tidy = 0;
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url === undefined) return;
  clearTimeout(tidy);
  tidy = setTimeout(() => ensureStandby().catch(() => {}), 3000);
});
// 裏の /tv を閉じてしまっても、少しあとに開き直す
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { svReceiverTab, svSpotifyTab } = await chrome.storage.session.get(['svReceiverTab', 'svSpotifyTab']);
  if (tabId !== svReceiverTab && tabId !== svSpotifyTab) return;
  await chrome.storage.session.remove(tabId === svSpotifyTab ? ['svSpotifyTab', 'svSpotifyAt'] : ['svReceiverTab', 'svReceiverAt']);
  setTimeout(() => ensureStandby().catch(() => {}), 3000);
});
