/*
 * Spotify 診断（読み取りだけ）: 裏の Spotify のタブに、アプリの内部の「形」（部品の名前・種類・メソッド名・通信先の名前。文字の値は含まない）を集めさせ、
 * 結果を表示して、ファイルに保存できるようにする。画面の差し替え（Spotify のアプリの内部に自前の画面を差し込む）の設計に使う、一度きりの調査。
 */
(function () {
  'use strict';

  const SV = self.SV;
  const $ = (id) => document.getElementById(id);
  let report = null;
  let waitTimer = 0;

  function summarize(r) {
    const rows = [
      ['部品の数（fiber）', String(r.fibers)],
      ['Provider の値', String((r.providers || []).length) + ' 件'],
      ['プレーヤーらしい部品', String((r.candidates || []).length) + ' 件'],
      ['通信先', String((r.endpoints || []).length) + ' 件'],
      ['標準にないグローバル変数', String((r.globals || []).length) + ' 件'],
      ['かかった時間', r.ms + ' ms'],
    ];
    const dl = $('summary');
    dl.textContent = '';
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  function show(r) {
    clearTimeout(waitTimer);
    report = r;
    $('run-sub').textContent = '取れました。もう一度取ることもできます';
    $('save').disabled = false;
    summarize(r);
    $('out').textContent = JSON.stringify(r, null, 1);
  }

  function run() {
    $('run-sub').textContent = '集めています…（数秒）';
    $('out').textContent = '…';
    SV.sendMessage({ type: 'sv:ensureSpotifyEngine' });
    SV.sendMessage({ type: 'sv:spCmd', cmd: 'diag' });
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => {
      $('run-sub').textContent = 'Spotify のタブにつながりません。Spotify を開いてから、もう一度';
      $('out').textContent = 'Spotify のタブから返事がありません（開いたばかりなら、読み込みを待ってください）';
    }, 10000);
  }

  function save() {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sofaview-spotify-diag.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  $('run').addEventListener('click', run);
  $('save').addEventListener('click', save);
  if (SV.hasChrome()) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'sv:spDiag' && msg.report) show(msg.report);
      return false;
    });
  }
})();
