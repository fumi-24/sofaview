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

async function goHub(sender) {
  let tabId = sender && sender.tab ? sender.tab.id : undefined;
  if (tabId == null) {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tabs[0] && tabs[0].id;
  }
  if (tabId == null) return { ok: false, error: 'no-tab' };
  await chrome.tabs.update(tabId, { url: HUB_URL });
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
  const tabs = await chrome.tabs.query({ active: true, windowType: 'normal' });
  let sent = 0;
  for (const t of tabs) {
    if (t.id == null || (sender.tab && t.id === sender.tab.id)) continue;
    // 拡張自身のページ（ハブ）は、tabs 権限がないと url が見えない。url が分からないタブへは送る（受け取れるのは拡張のページだけ）
    if (t.url && !t.url.startsWith('https://tver.jp/')) continue;
    chrome.tabs.sendMessage(t.id, { type: 'sv:remoteKey', name }, () => void chrome.runtime.lastError);
    sent++;
  }
  return { ok: true, sent };
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
  if (area === 'local' && changes[SV.settings.KEY]) syncRulesets().catch(() => {});
});
chrome.runtime.onInstalled.addListener(() => syncRulesets().catch(() => {}));
chrome.runtime.onStartup.addListener(() => syncRulesets().catch(() => {}));
