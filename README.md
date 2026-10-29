# SofaView

テレビのリモコンだけで **YouTube**・**TVer**・**Spotify** を操作できるようにする、Chromium 向けの拡張機能（Manifest V3）。
十字キー・Enter・Esc・Home だけで「ハブ → YouTube／TVer → 視聴 → Home でハブへ」が完結します。

> **非公式のツールです。** YouTube（Google）・TVer（株式会社TVer）・Spotify（Spotify AB）とは無関係で、各社の承認・提携を受けていません。YouTube・TVer・Spotify は各社の商標・サービス名です。広告のブロック・スキップ、DRM や地域制限の回避はしません。TVer・YouTube の画面の変更で、動かなくなることがあります。

| 対象 | 方式 |
|---|---|
| **YouTube** | 公式の `youtube.com/tv`（TV 向け UI）をそのまま使う。拡張機能が TV 端末の User-Agent を与えて起動する |
| **TVer** | 既存サイトを /tv と同じ寸法・色・動きに再スキン（ガイド・検索ピル・棚・カード・フォーカスのリング。違いは [SPEC 9.8](docs/SPEC.md#98-youtubecomtv-との違い意図した差と残る差)）。詳細は TVer 標準の表示を使う。見た目は CSS、リモコン操作（十字キー移動・視聴画面の操作・画面倍率）は JS。**視聴画面は、TVer 自身のプレイヤーを /tv の視聴画面と同じ見た目・操作にする**（[SPEC 7.5](docs/SPEC.md#75-視聴画面tver-向け)）|
| **Spotify** | Web プレーヤー（`open.spotify.com`）の画面はそのまま。十字キー・OK・戻る・再生/一時停止・次・前、検索は画面上のキーボード。Home でハブへ戻るときも、Spotify のタブは動かさない（音楽が止まらない）。ログイン画面は触らない（[SPEC 7.8](docs/SPEC.md#78-spotifyopenspotifycom)）|
| **ハブ** | 共通ホーム。どの画面でも Home キーで戻れる。キー診断・設定・キー割り当てもここにある |

対象はテレビにつないだ PC／ミニPC の Chromium 系ブラウザ（キオスク起動を含む）。リモコンのキー（十字キー・Enter・Esc・Home など）がキーボード入力として届く前提です（HDMI-CEC など）。

## ステータス

**v0.2.0：実装済み・自動テスト済み。キーボードでの実機確認は済み（リモコンでの確認はこれから）。**

- ✔ 静的チェック、単体テスト 111 件、E2E 139 件（拡張機能を読み込んだ Chromium）、実サイトのスモーク 9 件（実プレイヤーは、地域制限の再生 API だけ偽の応答にして確認）
- ✔ 実機（キーボード操作）で確認済み：TVer の視聴画面の見た目と操作、全画面中の Esc
- ❔ 実機で確認が必要：リモコンの実際のキー、TVer の再生（日本国内の回線・コーデック・DRM・広告）、キオスク運用 → [実機チェックリスト](docs/NOTES.md#4-実機チェックリスト)

## 試す（Chromium／Chrome for Testing）

```sh
git clone https://github.com/fumi-24/sofaview.git
cd sofaview
chromium --user-data-dir="$HOME/.sofaview-profile" \
  --load-extension="$PWD/extension" \
  "chrome-extension://flbnighbcpldceamhclmdncdecjcefpc/hub/index.html"
```

- ハブが開いたら十字キーで選んで Enter。**キー診断**でリモコンのボタンが届くか確認できます。
- **製品版 Chrome（137 以降）は `--load-extension` が無効**です。開発者モードで読み込む方法やポリシー、キオスク起動、リモコン設定の手順は [docs/OPERATIONS.md](docs/OPERATIONS.md)。

### リモコンの操作

| キー | ハブ・設定 | YouTube（公式 /tv）| TVer | TVer の視聴画面（/tv と同じ）|
|---|---|---|---|---|
| ↑ ↓ ← → | フォーカス移動 | 公式 | フォーカス移動 | 操作画面を出す／バーで ← → ＝ スクラブ（10 秒ずつ）／ボタン列は ← → で移動 |
| Enter | 決定 | 公式 | 決定 | 操作画面を出す／バーで再生・一時停止／ボタンを押す／スクラブを確定 |
| Esc／Backspace | 戻る | 公式（戻る）| 戻る | 操作画面を隠す → もう一度で前のページへ（スクラブ中は取り消し）|
| Home | — | ハブへ | ハブへ | ハブへ |

## 開発

```sh
npm install
npx playwright install chromium   # E2E 用（初回のみ）

npm run check            # manifest の参照・構文・権限・バージョンの整合
npm run test:unit        # 単体テスト（純粋ロジック）
npm run test:e2e         # E2E（ネットワーク不要。TVer・YouTube は再現ページ）
LIVE=1 npm run test:live # 実サイトのスモーク（ネットワークが必要。DOM 変更の検知用）
npm run pack             # dist/sofaview-<version>.zip
```

ビルドは不要です（素の JS/CSS）。`extension/` をそのまま読み込めます。構成と規約は [CLAUDE.md](CLAUDE.md)。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | 仕様書（目標・設計方針・キー割当・UI・サイト別仕様・テスト・リスク・決定事項）|
| [docs/NOTES.md](docs/NOTES.md) | 調査メモ・決定ログ・実装ログ・落とし穴・実機チェックリスト・参考リンク |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | 導入・キオスク起動・リモコン設定・トラブルシュート |
| [PRIVACY.md](PRIVACY.md) | プライバシーポリシー（データを収集・送信しません）|
| [CLAUDE.md](CLAUDE.md) | 開発者向けの構成・コマンド・規約 |

## スマホから YouTube を送る（キャスト待機）

設定で「キャスト待機」をオンにすると、YouTube /tv を裏のタブで開いておきます。スマホの YouTube アプリから送る（キャスト）と、自動で前面に出て再生します。追加の通信や権限は増えません。手順は [docs/OPERATIONS.md](docs/OPERATIONS.md)。

## 方針

- 見た目は CSS を優先し、リモコンで動かす部分は JS で行います（コード量は JS のほうが多い。役割分担は [SPEC 4.3](docs/SPEC.md#43-css-と-js-の役割分担)）。
- 広告ブロック・広告スキップ・DRM 回避・地域制限の回避は**行いません**。
- 権限は `declarativeNetRequest` と `storage`、ホストは `youtube.com`・`youtu.be`・`tver.jp`・`open.spotify.com` のみ。テレメトリ・リモートコードなし。
- ログインや認証情報は扱いません（各サービスの画面で行い、ブラウザのプロファイルに保存されます）。

## ライセンス

MIT（[LICENSE](LICENSE)）
