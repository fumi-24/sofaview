# プライバシーポリシー / Privacy Policy

SofaView（ブラウザ拡張機能）・作者 fumi24　最終更新日: 2026-10-29 / Last updated: 2026-10-29

## 日本語

SofaView は、YouTube と TVer をテレビのリモコンで操作するための拡張機能です。YouTube・TVer とは無関係の、非公式のツールです。

**SofaView は、個人情報を含め、利用者のデータを収集しません。外部のサーバーへ何も送信しません。**

- **保存するもの**: 設定（画面の倍率、UI の選択など）だけを、ブラウザの中（`chrome.storage.local`）に保存します。この設定はお使いの端末の外には出ません。設定の画面から、いつでも初期値に戻せます。拡張機能を削除すると消えます。
- **アクセスするサイト**: `youtube.com`・`youtu.be`・`tver.jp`・`open.spotify.com` のページだけです。ページの見た目の変更と、キー操作の受け取りのために使います。ページの内容、視聴履歴、入力した文字（検索語や、アンケートの回答など）を、保存したり送信したりしません。
- **ログイン情報**: 扱いません。ログインは各サービスの画面で行い、その情報はブラウザ自身が管理します。
- **外部サービス**: 分析（アナリティクス）・広告・クラッシュレポートなどは使いません。外部のコードも読み込みません。
- **権限の使いみち**: `declarativeNetRequest` は、YouTube の TV 用画面（/tv）を表示するための通信ヘッダーの書き換えと転送に使います。`storage` は上の設定の保存に使います。
- **第三者への提供**: 収集するデータがないため、ありません。

このポリシーを変えるときは、このファイルを更新します（変更の履歴はリポジトリの履歴で確認できます）。

**お問い合わせ**: https://github.com/fumi-24/sofaview/issues または https://new-site.fumi24.com/contact/

## English

SofaView is a browser extension that lets you operate YouTube and TVer with a TV remote control. It is an unofficial tool and is not affiliated with YouTube or TVer.

**SofaView does not collect any user data, including personal information, and sends nothing to any server.**

- **What is stored**: Only your settings (screen scale, UI choices, etc.), kept inside your browser (`chrome.storage.local`). They never leave your device. You can reset them from the settings page at any time, and they are removed when you uninstall the extension.
- **Sites it accesses**: Only pages on `youtube.com`, `youtu.be`, `tver.jp` and `open.spotify.com`, to change their appearance and handle key presses. It does not store or transmit page content, viewing history, or text you type (such as search terms or survey answers).
- **Credentials**: Not handled. You sign in on each service's own page; your browser manages that data.
- **Third parties**: No analytics, advertising, crash reporting, or remote code.
- **Permissions**: `declarativeNetRequest` is used to rewrite request headers and redirect so that YouTube's TV interface (/tv) can be shown. `storage` is used to save the settings above.
- **Sharing**: Nothing is shared, because nothing is collected.

If this policy changes, this file will be updated (see the repository history).

**Contact**: https://github.com/fumi-24/sofaview/issues or https://new-site.fumi24.com/contact/
