# SofaView 運用手順

テレビにつないだ PC／ミニPC に SofaView を導入し、リモコンだけで使えるようにするまでの手順。

- 最終更新: 2026-10-18
- 凡例: ✔＝この環境（Linux・Chromium 141・Playwright）で動作確認済み／❔＝実機で未確認（実機チェックリストは [NOTES.md](./NOTES.md) 4章）
- ツールバーの SofaView のアイコンを押すと、設定の小窓が出ます（マウス用）。リモコン用の設定はハブの「設定」です。
- 仕様は [SPEC.md](./SPEC.md)。リモコンのキー割り当ては 5 章（診断・設定ページ）で調整できます。

## 1. 用意するもの

| 項目 | 内容 |
|---|---|
| 端末 | テレビに HDMI 接続した PC／ミニPC（Windows・Linux・ChromeOS 等）|
| ブラウザ | Chromium 系（Chrome・Chromium・Edge）。**TVer の再生には製品版 Chrome（H.264/AAC・Widevine）を推奨** ❔ |
| リモコン | HDMI-CEC などで **キーボード入力として届くもの**（矢印・Enter・Esc・Home 等）。届くキーは 5 章の診断ページで確認 |
| ネットワーク | TVer は日本国内の回線のみ視聴可。YouTube のログインはスマホ（QR コード）|
| 拡張機能 | このリポジトリの `extension/` ディレクトリ、または `npm run pack` で作る `dist/sofaview-<version>.zip`（展開して使う）|

## 2. 拡張機能の導入方法

Chrome 137 以降の**製品版 Chrome は `--load-extension` フラグを無効化**しています（Chromium・Chrome for Testing は有効）。環境に合わせて選びます。

### A. Chromium / Chrome for Testing ＋ `--load-extension`（最も簡単）✔

```sh
chromium --load-extension=/path/to/sofaview/extension
```

- 非ブランドの Chromium は**コーデック・Widevine の制約**で TVer が再生できない場合があります ❔（ディストリビューション版の Chromium は H.264 に対応していることが多い）。
- 拡張機能 ID は manifest の `key` で固定されています：`flbnighbcpldceamhclmdncdecjcefpc`。

### B. 製品版 Chrome：開発者モードで読み込む ❔

1. `chrome://extensions` を開き、右上の「デベロッパーモード」をオン。
2. 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選ぶ。
3. 読み込んだ拡張はプロファイル（`--user-data-dir`）に保存され、次回以降も有効です。キオスク起動でも同じ `--user-data-dir` を指定してください。
4. 環境によっては起動のたびに「デベロッパーモードの拡張機能を無効にする」という警告が出ます（Windows など）。出る場合は C の方法を使います。

### C. ポリシーで強制インストール（Linux の例）❔

自前でホストした CRX と `update.xml` が必要です。`/etc/opt/chrome/policies/managed/sofaview.json`（Chromium は `/etc/chromium/policies/managed/`）に次を置きます。

```json
{
  "ExtensionInstallForcelist": ["flbnighbcpldceamhclmdncdecjcefpc;https://example.com/sofaview/update.xml"]
}
```

> ⚠ CRX を自分の鍵で署名すると、拡張機能 ID が manifest の `key` から決まる ID と**変わります**。その場合はキオスクの開始 URL の ID を合わせてください。ポリシーの詳細は [Chrome Enterprise のドキュメント](https://support.google.com/chrome/a/answer/9867568?hl=en)。

## 3. キオスク起動

開始ページはハブ（`chrome-extension://<拡張ID>/hub/index.html`）です。

### Linux（例）❔

`tools/kiosk-linux.sh` を使うか、次のコマンドを参考にします。

```sh
chromium --kiosk \
  --user-data-dir="$HOME/.sofaview-profile" \
  --load-extension="$HOME/sofaview/extension" \
  --autoplay-policy=no-user-gesture-required \
  --noerrdialogs --disable-infobars --no-first-run --no-default-browser-check \
  --disable-session-crashed-bubble --disable-features=Translate \
  "chrome-extension://flbnighbcpldceamhclmdncdecjcefpc/hub/index.html"
```

- **Ubuntu の `chromium` は snap 版**です。snap 版は、ホームの「`.` で始まる隠しフォルダ」に書けず、設定（プロファイル）が保存されなかったり、拡張機能が毎回消えたりします。`tools/kiosk-linux.sh` は snap を見つけると、プロファイルを `~/snap/chromium/common/sofaview-profile` に置きます。コマンドで書くときも、`--user-data-dir` を隠しフォルダにしないでください。
- **ssh でつないで実行すると、`tools/kiosk-linux.sh` は、テレビにつないだパソコンの画面（`DISPLAY=:0`）に出します**（そのままだと、つなぎ元のパソコンの画面に出てしまいます）。ssh を切っても動き続けるよう、裏で起動し、ログは `/tmp/sofaview-kiosk.log` に出ます。画面の番号は `SOFAVIEW_DISPLAY` で変えられます。
- **起動は「空白で起動 → 拡張機能の登録を確認 → ホームを開く」の順です**。`--load-extension` の拡張機能は起動の少しあとに登録されるため、最初からホームを開くと `ERR_BLOCKED_BY_CLIENT` になることがありました（F5 で直る）。スクリプトは 127.0.0.1 のデバッグ用ポート（既定 9222、`SOFAVIEW_PORT` で変更。外からはつながらない）で登録を確かめてから開きます。
- **新しい Chromium（137 以降）は、`--load-extension` を既定で無効にしている**ことがあります。スクリプトは `--disable-features=DisableLoadExtensionCommandLineSwitch` を付けて、有効に戻します。それでも読み込まれないときは、`bash tools/kiosk-linux.sh` で起動して、別の ssh から `curl -s http://127.0.0.1:9222/json/list` を実行すると、開いているページの URL とタイトルが見られます（エラーページかどうかが分かります）。
- **すでに Chromium が動いていると、新しく起動できません**（動いているほうにページを開くだけで、`--load-extension` も `--kiosk` も無視されます。拡張機能が読み込まれず、`chrome-extension://…` が「ブロック」になります）。先に `pkill -f chromium` で終了してください（スクリプトは、動いていると止まります）。
- `--autoplay-policy=no-user-gesture-required`：TVer の再生をキー操作の直後でなくても自動で始めるため。
- 自動起動は `systemd --user` のサービスやデスクトップ環境の autostart を使います。マウスカーソルは各ページの CSS で隠しますが、OS 側のカーソルも消したい場合は `unclutter` 等を併用します。

### Windows（例）❔

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk ^
  --user-data-dir="%USERPROFILE%\.sofaview-profile" ^
  --autoplay-policy=no-user-gesture-required --no-first-run ^
  "chrome-extension://flbnighbcpldceamhclmdncdecjcefpc/hub/index.html"
```

（製品版 Chrome では事前に 2 章 B で拡張を読み込んでおきます。）

## 4. 初回セットアップ（リモコンのキーを合わせる）

1. ハブが表示されたら、十字キーで「キー診断」を開き、リモコンのボタンを順に押します。**画面に出る `key` の名前**（例：`Home`・`BrowserHome`・`Escape`・`XF86Back`…）を確認します。
2. 想定のキーで動いていれば（「割り当て」に `HOME`・`BACK`・`OK`・`UP`… と出れば）設定は不要です。
3. 「未割り当て」と出るボタンがあれば、**ハブ → 設定 → キー割り当て**で、動作を選んで Enter → 割り当てたいリモコンのボタンを押します（既定のキーは消えず、追加されます）。
4. リモコンに Home がない場合は、設定で「戻るキーの長押しでホームへ」をオンにします。
5. **YouTube**：ハブから YouTube を開き、「使ってみる」→「スマートフォンでログインする」。表示される QR コード（または `yt.be/activate` とコード）をスマホで読み取ってログインします。ログイン状態はブラウザのプロファイルに保存されます。
6. **TVer**：ハブから TVer を開き、番組を選んで再生できることを確認します。再生できない場合は国内回線・ブラウザのコーデック／DRM を確認してください ❔。

## 5. 操作の早見表

| キー | ハブ・設定 | YouTube（公式 /tv） | TVer（一覧・番組） | TVer（視聴画面。/tv と同じ） |
|---|---|---|---|---|
| ↑ ↓ ← → | フォーカス移動 | 公式 | フォーカス移動（左端で ← → レール）| 非表示から押すと操作画面。操作画面: ↑ ↓ でバーとボタン列、バーで ← → ＝ スクラブ（10 秒ずつ。押しっぱなしで加速）、ボタン列は ← → で移動。↑ をバーで押すと隠れる |
| Enter | 決定 | 公式 | 決定（再生前のポスターの再生ボタンなら、再生を始める）| 操作画面を出す／バーで再生・一時停止／ボタンを押す（再生速度・画質は開いて、↑ ↓ で動かして Enter で選ぶ）／スクラブを確定 |
| Esc / Backspace | 設定からハブへ | 公式（戻る）| 戻る（ホームではハブへ）| 操作画面を隠す → もう一度で全画面を終えて前のページへ（スクラブ中は取り消し。再生終了後の「次のエピソード」は 1 回目で自動再生を止め、TVer がプレイヤーを最初のポスターに戻す。もう一度で前のページへ）|
| Home | — | **ハブへ** | **ハブへ** | **ハブへ** |
| 再生/停止・早送り・巻き戻し | — | 公式 | — | 操作できる（再生/停止は切り替え、早送り・巻き戻しはスクラブを始める）|

## 6. テレビ側の設定

- **オーバースキャン**：画面の端が切れるときは、テレビの画面サイズ設定を「ジャストスキャン」「ドットバイドット」「画面全体」などにしてください。
- **HDMI-CEC**：テレビのリモコンの操作を PC に送るには、テレビと PC（またはアダプタ）の CEC を有効にします。Linux では `libcec` の `cec-client` や `ir-keytable` 等でキーボード入力に変換する構成が一般的です ❔。キーリピートの間隔が短すぎる場合も、診断ページの「前回から」の値で確認できます（拡張は方向キーのリピートを 1 秒に 12 回までに制限します）。
- **解像度**：1080p でも 4K でも、TVer は CSS の画面高さが 720px 相当になるよう自動で拡大します（設定で変更可）。YouTube /tv は公式が自動でスケールします。

### スマホをリモコンにする（YouTube アプリの「テレビで見る」）

スマホの YouTube アプリのリモコン（十字キー・決定・戻る）で、TVer とハブも操作できます。拡張機能だけで動き、新しい通信先や権限は増えません。

1. テレビ側のブラウザで、`https://www.youtube.com/tv` を**別のタブで開いたまま**にします（受け取り役。裏のタブでかまいません。閉じると受け取れません）。
2. スマホの YouTube アプリで、公式の方法でテレビとつなぎます（アプリの「テレビで見る」。テレビコードを入力する方法など。表示はアプリのバージョンで変わります）。
3. アプリにリモコンが出ます。十字キーと決定、戻るが、前面のタブ（TVer・ハブ）に届きます。YouTube /tv が前面のときは、/tv 自身が受け取ります。

- 仕組み：/tv は、スマホからの十字キー（dpadCommand）を受け取ると、ページの中でキーイベントを出します。拡張はそれを横取りして、前面の TVer・ハブのタブへ渡します（`common/remote.js`、NOTES 3.12）。
- 届くのは、上・下・左・右・決定・戻るです。Home・文字入力は届きません（文字入力は、TVer の画面上キーボードを使います）。
- 受け取りのタブが休止・破棄されると届きません。拡張は破棄されないようにしています（効果は実機で確認 ❔）。

## 7. トラブルシュート

| 症状 | 確認すること |
|---|---|
| ハブが開かない／真っ白 | 拡張機能が読み込まれているか（`chrome://extensions`）。ID が `flbnighbcpldceamhclmdncdecjcefpc` か |
| YouTube が「youtube.com に移動します」の案内ページになる | UA 偽装が効いていません。拡張機能が有効か、ブラウザが Chromium 111 以降か確認 |
| YouTube /tv が起動しない・「このデバイスでは未対応」| YouTube 側の UA 判定が変わった可能性。[SPEC.md](./SPEC.md) 15章の R1 を参照して報告してください |
| 十字キーが効かない | 診断ページでキーが届いているか確認。届いていなければ OS／CEC の設定、届いていて「未割り当て」なら設定のキー割り当て |
| Home が効かない | ブラウザや OS が先に処理している可能性。診断ページで `Home` か `BrowserHome` か確認し、届かなければ OS 側で別のキーに割り当てる |
| TVer の見た目が崩れた | TVer のサイト更新の可能性。`LIVE=1 npm run test:live` で DOM の変化を検知できます（開発者向け）|
| TVer の文字が小さい／大きい | 設定の「画面倍率」を「固定倍率」にして調整 |
| TVer の番組ページで、エピソードにカーソルを合わせても詳細（あらすじ・いいね・シェア）が出ない | TVer の端末判定が原因のことがあります。Linux の Chromium は拡張が UA を Windows の Chrome に見せて対応します（`sites/tver/ua-main.js`）。出ない場合は拡張機能が有効か、TVer のクラス名が変わっていないか（`LIVE=1 npm run test:live` の「詳細ポップアップ」）確認 |
| TVer のレールでページを選んだあと、カーソルがレールのまま | 仕様です（勝手に動かさない）。→ で新しいページの内容へ入ります |
| TVer が再生できない | 日本国内回線か、ブラウザが H.264/AAC・Widevine に対応しているか（製品版 Chrome を推奨）❔ |
| 視聴画面の操作画面が出ない／全画面にならない | 再生が始まる前は、TVer のページ（ポスターの再生ボタンで Enter）です。初回は TVer のアンケート（誕生年・誕生月・性別・郵便番号）に答えないと再生されません。アンケートが出ると、画面上のキーボードが自動で開くので、数字を入れて「完了」→ 次の欄、性別は OK で選ぶ → 郵便番号 → 「回答する」の順に、リモコンだけで答えられます。全画面は、再生を始めたキー操作から約 5 秒以内でないとブラウザが拒否します（そのときは次のキー操作で入ります。見た目は同じ画面いっぱいの表示になります）。それでも出ない場合は NOTES.md の実機チェックリスト #7 の情報を添えて報告 |

## 8. 更新手順

- Chromium + `--load-extension`（A）：`git pull` してブラウザを再起動。
- 開発者モード（B）：`git pull` した後、`chrome://extensions` で拡張機能の「再読み込み」。
- ポリシー（C）：新しい CRX を配置して `update.xml` のバージョンを上げる。

## 9. プライバシー・権限

- 外部への通信・テレメトリはありません（`tools/check.mjs` が許可していない権限やリモートコードを検知します）。
- 権限：`declarativeNetRequest`（YouTube /tv の User-Agent 書換え・通常 URL の転送）、`storage`（設定）、ホスト `youtube.com`・`youtu.be`・`tver.jp`。
- 認証情報は扱いません（ログインは各サービスの画面で行い、ブラウザのプロファイルに保存されます）。
