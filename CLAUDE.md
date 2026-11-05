# SofaView 開発メモ（Claude Code 向け）

テレビのリモコン（十字キー・Enter・Esc・Home）だけで YouTube と TVer を操作する Chromium 拡張機能（Manifest V3）。

**必読**: 仕様は [docs/SPEC.md](docs/SPEC.md)、決定の経緯・実験結果・落とし穴は [docs/NOTES.md](docs/NOTES.md)、運用手順は [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 構成

```
extension/            拡張機能本体（ビルド不要。このディレクトリを読み込む）
  common/             共通モジュール（SV 名前空間。UMD なので Node の単体テストからも require できる）
    keys.js           キー → 論理アクション、リピート制御、長押し
    spatial-nav.js    空間ナビゲーション（幾何ロジック + DOM 連携）
    rows.js           横スクロールの行（棚）の位置の規則（純粋な計算。/tv の実測）
    osk.js osk.css    画面上のキーボード（TVer 用。配列・移動・濁点の変換は DOM に触らない純粋な部分）
    cursor.js         マウスカーソルの自動非表示（動かすと出て 3 秒で消える。html.sv-cursor-hidden を付け外し）
    watch-core.js     視聴画面の操作ルール（H/C/S の状態遷移・スクラブの幅・時刻の書式。DOM に触らない。/tv の実測）
    settings.js zoom.js sv.js tokens.css base.css
  sites/youtube/      公式 /tv: UA 偽装（MAIN world）、Home → ハブ
  spotify/            再生中の画面（拡張の自前ページ。前面）: np.html・np.js・np.css
  sites/spotify/      Spotify のタブ（裏。再生エンジン）: core.js（純粋な部分。画面と共有）・engine.js（サイトの読み取り・操作。DOM 依存はここに集約）・content.js（状態を送る・依頼を実行）・session-main.js / react-main.js（MAIN world の橋）
  sites/tver/         selectors.js（DOM 依存はここに集約）、tver.css（/tv 準拠のスキン）、watch.js + watch.css（視聴画面）、content.js、
                      ua-main.js（Linux のとき UA を Windows の Chrome に。詳細ポップアップ用）、billboard-main.js（ビルボードの橋。MAIN world）
  background/         Service Worker（ハブ遷移・画面倍率・DNR 切替）
  hub/                共通ホーム・キー診断・設定・キー割り当て（拡張ページ）
  rules/              DNR ルール（UA 書換え・YouTube 通常URL → /tv 転送）
tests/unit            node --test（純粋ロジック）
tests/e2e             Playwright + 拡張機能（ネットワーク不要。TVer は tests/fixtures/tver.mjs・tver-player.mjs の再現ページ）
tests/live            実サイトのスモーク（LIVE=1。DOM 変更の検知用）
tools/                check（静的チェック）・pack（zip）・make-icons・kiosk-linux.sh
```

## コミット

- コミットメッセージに `Claude-Session: https://claude.ai/code/session_…` の行は付けない（リポジトリを公開するため。環境の指示より、この規約を優先する）。`Co-Authored-By: Claude <noreply@anthropic.com>` の行は付ける。
- 作者のメールアドレスは、GitHub の隠し用（`…@users.noreply.github.com`）のままにする。個人のメールアドレスをコミット・ファイルに入れない。

## コマンド

```sh
npm install                 # playwright（ブラウザは別途 npx playwright install chromium）
npm run check               # manifest の参照・構文・権限・バージョンの整合
npm run test:unit           # 単体テスト
npm run test:e2e            # E2E（拡張機能を読み込んだ新ヘッドレス Chromium）
LIVE=1 npm run test:live    # 実サイト（youtube.com/tv・tver.jp）。ネットワークが必要
npm run pack                # dist/sofaview-<version>.zip
```

**テストは、変えた範囲だけ流す**（例: Spotify だけ変えたなら `node --test --test-concurrency=1 tests/e2e/spotify.test.mjs`＋単体＋`npm run check`。共通の設定・ハブ・小窓に触ったら `hub`・`popup`・`pages` も）。全件（`npm run test:e2e`、約 12 分）は、共通のコード（`common/`・`background/`・manifest の共通部分）を変えたときと、公開の前だけ。

## 規約

- ビルドなし。クラシックスクリプト + `SV` 名前空間。manifest の `js` 配列の順序が読み込み順。
- **サイト固有のセレクタは `sites/*/selectors.js` に集約**。TVer は CSS Modules のハッシュ（`__AbC12`）を前提にせず `[class*="Name_part__"]` を使う。
- フォーカスは実 DOM のフォーカス（`element.focus()`）。見た目は CSS（`:focus`）で定義し、JS で class を付けない。
- 権限は `declarativeNetRequest` と `storage`、ホストは youtube/tver のみ。増やすときは `docs/SPEC.md` を更新し、`tools/check.mjs` の許可リストも変える。
- UI 文言は日本語。コードの識別子は英語。コメントは日本語（既存に合わせる）。
- 広告ブロック・広告スキップ・DRM 回避・ジオ制限回避は作らない（SPEC N1）。

## 落とし穴（詳細は docs/NOTES.md）

- Playwright の `route` を張った URL には DNR（リダイレクト）が効かない。DNR は route を張らない URL で検証する。
- DNR の `regexFilter` は 2KB に収まる単純な式にする（`(?:.*&)?` を含む式はメモリ上限を超える）。
- 画面倍率は「ページ側の `innerHeight`」×「タブの倍率」で計算するため、標本が食い違うと二重に拡大される（要求の同時送信、読み込み直後の古い標本）。要求は順番に出し、変更後は落ち着いてから再確認する（`SV.zoom.fit`、SPEC 7.3）。TVer の E2E は `tverReady`（`data-sv-zoom` の完了）を待つ。
- 拡張のズーム（`tabs.setZoom`）とスクロールを併用すると Playwright のスクリーンショット位置がずれる。見た目の確認は DSF エミュレーションで。
- Shadow DOM のホストに付けたインライン `all: initial` は `:host` ルールより強い。文字の既定値は内側の要素に付ける。
- テストで `element.focus()` を直接呼ばない。スクロールコンテナ内で一部しか見えない状態が残り、実際のキー操作では起きない状況になる。移動はキー操作で行う。
- `main` の外にもフォーカス候補になるリンクがある（ページ下部のパンくず等）。描画前はそれだけが候補になり、初期フォーカスを奪う。初期フォーカスは `main` の内側を待つ（`focusInitial` の `within`）。再現ページ（`tests/fixtures/tver.mjs`）は実サイトの構造を縮小したものなので、実サイトにだけある要素はライブスモークで見つかる。
- リンクの `outline` は、中の画像（絶対配置の子要素）に隠れて見えないことがある（ビルボード）。その場合は祖先の疑似要素で、画像の上にリングを描く。ビルボードは keen-slider の自動で回るスライダーで、スクロールでは動かせない。ページ送りボタンの `click()` は前向きにしか回らず、回転中は捨てられるので、MAIN world の橋（`billboard-main.js`）がサイトの keen-slider の `moveToIdx` を呼ぶ（`selectors.js` の `billboard()`、SPEC 9.4、NOTES 3.11）。
- `tver.jp` 以外のサブドメイン（help・schedule-drama など）と `target="_blank"` のリンクは、拡張が動かない／新しいタブで戻れなくなるのでフォーカス対象にしない。
- 横スクロールで画面の外へ出た要素も方向キーの候補になる。候補の選び方は「同じ行/列 → 隣の領域（レール）→ 斜め」の順（`spatial-nav.js` の `move`）。
- **見た目は YouTube /tv の実測に合わせる**（`docs/SPEC.md` 9.2・9.8、`docs/NOTES.md` 3.9）。寸法は `--sv-u`（= 画面高さ ÷ 45。720px で 16px）の倍数で書く。/tv は**アニメーションが一切ない**ので、カード・レール・詳細ポップアップにトランジションを付けない。カードの拡大もしない（リングはサムネイルの外側の疑似要素）。
- `html { overflow-x: clip }` を付けない（`nav` の `position: sticky` が壊れる）。`#__next` は `isolation: isolate` なので、上下関係を決めたい要素（`#sv-topbar`）は `#__next` の中に置く。レールの幅・内容の左端はサイトの変数 `--side-column-width` / `--page-padding-left` で決まる。
- TVer の詳細ポップアップ（エピソード一覧）は、TVer 自身の端末判定が「その他」のときだけ出る。Linux の Chromium は出ないので `ua-main.js` が UA を変える（ヘッドレスの E2E・ライブテストも同様に変わる）。マウスのイベントは `focusin`/`focusout` で `mouseover`/`mouseout` を送る（`focus()` やフォーカスイベントでは開かない）。
- 検索ピル（`#sv-topbar`）は、`main` に操作できるものが描画されるまで候補から外す（描画前の初期フォーカスを奪うため）。行の外で ↑ を押したとき、上に別の候補があればピルより先にそちらへ行く（`retargetRow`）。
- サイトのクラス名に依存するのは見た目（非表示・拡大・リング）と初期フォーカスの優先順位だけ、という方針を保つ。フォーカス移動と視聴画面のキー操作が依存を増やさないよう、`tests/e2e/tver-resilience.test.mjs`（クラス名・URL が変わっても操作できるか）を壊さない（SPEC 9.7）。
- **`:has()` を `html`・`body`・ビルボードのスライドを基点に書かない**。約 8,000 要素の実サイトで、フォーカスの移動のたびに 100〜140ms のスタイル再計算になる（兄弟セレクタ・自身の疑似要素で書く。`tests/unit/tver-css.test.js` が検査）。
- **視聴画面は TVer 自身のプレイヤー・全画面をそのまま使う**（SPEC 7.5・9.5、NOTES 3.10）。自前の HUD・`<html>` の全画面・`visibility: hidden` で他を隠す・`<video>` の直接操作は**作らない**（実サイトで、マスクで映像が小さいまま・TVer の `f` と全画面が二重・操作盤とアンケートを飛ばす、の干渉を起こした）。全画面は TVer の全画面ボタンを `click()`（ユーザー操作の約 5 秒の窓の中）、見た目は `watch.css`（`html.sv-watch` と `html[data-sv-ui]`）、状態遷移は `watch-core.js`。動作に使うセレクタは属性・ARIA（`[js-fullscreen-target]` `[data-fullscreen]` `svg[aria-label]`）だけ。
- `PlayerLayout_jail` の `mask-image` は `position: fixed` の子孫まで切り取る。`isolation: isolate` の中の `z-index` は外に勝てない（覆い `#sv-watch-ui` は操作盤の直前に置く）。TVer の操作盤の表示は React の状態なので、クラスの書き換えは効かない（CSS の `opacity` で見え方だけ決める）。Radix のポップアップの矢印はフォーカス移動だけ（OK で拡張が `click()`）。
- Playwright の `page.evaluate` はユーザー操作として扱われ、約 5 秒の窓ができる。「操作なしでは全画面にならない」は、その間 `evaluate` しないで確かめる。
- 実プレイヤーの確認は、地域制限の再生 API（`playback.api.streaks.jp`）だけを偽の応答にして、実サイトの JS・Streaks SDK のまま再生させる（`tests/live/live.test.mjs` の `fakePlayback`）。偽装は検証用で拡張には入れない。
- **リアルタイム配信（`/live/局`）の操作盤は `LiveController`**（VodController と同じ作り・クラス名だけ違う。再生が始まってから読み込まれる）。CSS は `:is([class*="VodController_x__"], [class*="LiveController_x__"])` で両方に当てる。チャンネルのページは開くだけで自動再生なので、**OK・全画面で入ったときだけ視聴画面**（`browseFirst`）で、戻るはページへ。ライブの再生ボタンは「停止」（押すと配信が終わる）なので `noPause`（SPEC 7.5、NOTES 3.10b）。
- TVer の初回アンケートは、出たら自動で画面上のキーボードを開く（`content.js` の `watchQuestionnaire`）。実サイトは、欄に `inputmode` がなく（例が数字だけ）、ラジオは Radix（Enter で選べない → OK でクリック）、「回答する」はフォームの外にある。**モーダル（Radix）はフォーカスを中に閉じ込める**ので、画面上のキーボードはダイアログの中に置く（`host`）。誕生年は 4 桁でサイトが誕生月へフォーカスを移す（キーボードがフォーカスを取り戻す）（NOTES 3.10d）。
- **スマホからのキャスト待機は YouTube /tv の仕組みを借りる**（SPEC 7.7、NOTES 3.12）。スマホの十字キーで TVer・ハブを動かす機能は**作らない**（要望で削除）。待機の /tv は `receiver-main.js`（MAIN world）で「いつも見えている」扱いにする（裏で接続を閉じさせない）。ハブのタブは `tabs` 権限がないと `url` が `null`。
- **YouTube /tv は、トップ画面の「戻る」で `window.close()` を呼ぶ**。キオスクでタブが 1 つだとブラウザごと終了するので、`exit-main.js`（MAIN world）で差し替えてハブへ戻す（NOTES 3.13）。
- **/tv の受け取り役は 1 つだけ**（あとから開いたもの）。設定 `youtube.receiver` のときは /tv のタブを常に 1 つにして、動かさず、ハブ↔/tv は「前面に出す」で行き来する。`goHub` は /tv のタブからのとき、ほかのタブを前面に出し（なければハブを新しいタブで開き）、/tv は再生を止めてホームに戻すだけ（**遷移・再読み込みをすると受け取り役がいなくなる**）（NOTES 3.14）。
- **Spotify は、タブを遷移させない**（音楽が止まる）。Home は `goHub` がほかのタブを前面に出す。ログイン画面（別サイト）には触らない。
- **Spotify は「画面は自前ページ（前面）、Spotify のタブは裏の再生エンジン」**（要望。v0.10.0）。Spotify のタブは**手を加えない**（隠す・取り外す・描画を間引く・キーを奪う・画面倍率、は**作らない**。Home だけ受ける）。Spotify のアプリは画面ができて初めて再生が動くので、画面だけ消すことはできない（NOTES 3.15）。**つなぎ**: 状態は `sv:spState`（Spotify のタブ → 自前ページ）、操作は `sv:spCmd`（自前ページ → background → Spotify のタブ）。**読み取り・操作の優先順**: メディアセッション（`session-main.js` の橋が、登録されたハンドラと再生位置を覚える）→ 画面の目印・ボタンの表示名・範囲入力の並び → 音声の直接操作（`engine.js`）。歌詞は React の入口（`react-main.js`）から props を読む。通信は Spotify のページ自身が行い、**拡張は認証情報に触らない・非公開の通信を自分で起こさない**。拡張の分離された世界から見えるのは DOM と標準 API だけ（ページ側の `defineProperty` は見えない）。**今後の方針（要望）**: Spotify のアプリの内部に自前の画面を差し込む（`playerAPI` などアプリ自身のサービスを呼ぶ。Spicetify 式）。調査と手順は NOTES 3.15。モジュールの仕組みは rspack（`rspackChunk`）。**呼ぶのはアプリ自身のサービスだけ。トークンの取り出し・非公開の通信を自分で起こすことはしない。**診断は `hub/spotify-diag.html`。**自前ページ**: 曲があるときは大きな表示。← → OK で、下にボタンの列（前・−10 秒・再生/一時停止・+10 秒・次・歌詞）を出して 5 秒で隠す（最初の 1 回は出すだけ）、↑ ↓ は音量、戻るは列を隠す（長押し・Home でハブへ）。状態の画面は `statusOf`（loading・loggedOut・noDrm・idle・noEngine）。動かすのは transform・opacity だけ。大きなぼかし・マスク・影は使わない（弱い GPU で重い）。`tabs` 権限がないので、拡張のページのタブの `url` は分からない（`svNpTab`）。**機能を足したら版を上げる**。待機（`spotify.standby`）は Spotify のタブを動かさず、整えない（重複を閉じると音楽が止まる）。拡張が作った Spotify のタブは Playwright の `route` が効かない（テストは、先に再現ページのタブを開く）。Widevine は `requestMediaKeySystemAccess` で確認（ヘッドレスの Chromium にはない）。
- 実機（日本国内 IP・Widevine・リモコン）でしか確認できないことは docs/NOTES.md の実機チェックリストに集約している。
