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

/** ハブの YouTube タイル: 裏の /tv があれば、それを前面に出す（もう 1 つ /tv を開かない）。 */
async function openYoutube() {
  const s = await SV.settings.load();
  if (!s.youtube.receiver) return { ok: false };
  const tabs = await ytTabs();
  if (tabs[0]) await activate(tabs[0]);
  else await chrome.tabs.create({ url: YT_TV, active: true });
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
      const others = (await chrome.tabs.query({ windowId: sender.tab.windowId })).filter((t) => t.id !== sender.tab.id && !isYt(t));
      others.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
      // /tv のタブは動かさない（遷移・再読み込みをすると、受け取り役がいなくなる）。ほかのタブがなければ、ハブを新しいタブで開く
      if (others[0]) await activate(others[0]);
      else await chrome.tabs.create({ url: HUB_URL, active: true, windowId: sender.tab.windowId });
      // 再生を止めて、ホームの画面に戻すだけ
      chrome.tabs.sendMessage(sender.tab.id, { type: 'sv:ytReset' }, () => void chrome.runtime.lastError);
      return { ok: true, receiver: true };
    }
  }
  await chrome.tabs.update(tabId, { url: HUB_URL });
  ensureReceiver().catch(() => {});
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
    targetHeight: s.zoom.targetHeight,
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

/** スマホのリモコンのキーを、前面の TVer・ハブのタブへ渡す（YouTube /tv のタブが受け取ったもの）。 */
async function forwardRemote(sender, name) {
  const tabs = await chrome.tabs.query({ active: true });
  let sent = 0;
  for (const t of tabs) {
    if (t.id == null || (sender.tab && t.id === sender.tab.id)) continue;
    // 拡張自身のページ（ハブ）は、tabs 権限がないと url が見えない。url が分からないタブへは送る（受け取れるのは拡張のページだけ）
    if (t.url && !t.url.startsWith('https://tver.jp/')) continue;
    chrome.tabs.sendMessage(t.id, { type: 'sv:remoteKey', name }, () => void chrome.runtime.lastError);
    sent++;
  }
  // 診断ページ用の記録（届いたか・どこへ渡したか）
  await chrome.storage.session.set({ svRemoteLast: { at: Date.now(), name, sent, fromActive: !!(sender.tab && sender.tab.active) } });
  return { ok: true, sent };
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

/** 診断ページ用: スマホのリモコンの状態。 */
async function remoteStatus() {
  const s = await SV.settings.load();
  const tabs = await ytTabs();
  const { svRemoteLast } = await chrome.storage.session.get('svRemoteLast');
  const { svLounge = [] } = await chrome.storage.session.get('svLounge');
  return {
    ok: true,
    setting: !!s.youtube.receiver,
    yt: tabs.map((t) => ({ active: !!t.active, discarded: !!t.discarded, status: t.status })),
    last: svRemoteLast || null,
    lounge: svLounge,
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
      p = ensureReceiver();
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
    case 'sv:remoteStatus':
      p = remoteStatus();
      break;
    case 'sv:remoteKeep':
      p = sender.tab && sender.tab.id != null ? chrome.tabs.update(sender.tab.id, { autoDiscardable: false }).then(() => ({ ok: true })) : Promise.resolve({ ok: false });
      break;
    case 'sv:remote':
      p = forwardRemote(sender, msg.name);
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
    ensureReceiver().catch(() => {});
  }
});
chrome.runtime.onInstalled.addListener(() => {
  syncRulesets().catch(() => {});
  ensureReceiver().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  syncRulesets().catch(() => {});
  ensureReceiver().catch(() => {});
});
// どこかのタブが別のページへ移ったとき（/tv から出て受け取り役がいなくなった、/tv が 2 つになった）も、少しあとに整える
let tidy = 0;
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url === undefined) return;
  clearTimeout(tidy);
  tidy = setTimeout(() => ensureReceiver().catch(() => {}), 3000);
});
// 裏の /tv を閉じてしまっても、少しあとに開き直す
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { svReceiverTab } = await chrome.storage.session.get('svReceiverTab');
  if (tabId !== svReceiverTab) return;
  await chrome.storage.session.remove(['svReceiverTab', 'svReceiverAt']);
  setTimeout(() => ensureReceiver().catch(() => {}), 3000);
});
