<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | **日本語** | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**ネイティブ [DeepSeek Harness（DSH）](docs/dsh.md) プラグインとして動く LLM Wiki：
プロジェクトの中に住み、自分で育ち続ける Obsidian 互換ナレッジベース。**

Andrej Karpathy の [LLM Wiki パターン](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
に従います。生のソース（URL、PDF、Markdown、JSON、XML）を、質問のたびに作り直すのでは
なく**積み上がっていく**、永続的で相互リンクされた LLM 管理の Wiki に変換します。

本リポジトリは [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) の DSH
フォークです。Vault フォーマットは同一で、同じ vault を両方のビルド間で自由に移動できます。

> **この DSH フォークでは[英語版 README](./README.md) が正**です。このページは要約です。
> レイヤ構成、ツール／コマンド一覧、ソースパケット形式、引用ルールは英語版にあります。

---

## クイックスタート — DeepSeek Harness

要件：Node ≥ 22、pnpm 9。プラグインは [`dsh/`](dsh/) に DSH **バンドル**として入っています。
ローカル専用のプライベートバンドル（`dsh-llm-wiki`）で、このフォークの npm 公開は**ありません**。

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # src/dsh → dist/dsh/ をビルド（dsh/host-index.js が再エクスポート）
```

続いて DeepSeek Harness で：

1. `plugin_manager` → `install_bundle` を開きます。
2. クローン内の `dsh/` ディレクトリの**絶対パス**を指定します
   （例：`/Users/you/src/dsh-llm-wiki/dsh`）。
3. プラグイン行 `llm-wiki` が HMR で有効になります。任意のプロジェクトを開くだけ —
   `.llm-wiki/` vault があってもなくても動き、無ければ静かに初期化します。

プロジェクトごとに得られるもの：LLM Wiki ツール群、**サイドバーのステータスパネル**
（`wiki-status`）、**設定 → LLM Wiki** セクション、**LLM Wiki synthesis** エージェント
プリセット、`/wiki-*` スラッシュコマンド。

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall 主要なパターンは？
```

> **ホストの詳細ドキュメント：** [`docs/dsh.md`](docs/dsh.md)

---

## 他のホスト — MCP（同時使用は禁止）

DeepSeek Harness 以外のクライアントは、同梱の stdio MCP サーバー経由で同じ vault に
アクセスします：

```bash
pnpm install && pnpm build:mcp      # dist/mcp/index.js を生成
```

クライアント（Claude Code、Codex CLI、Cursor、Windsurf、Zed、Cline）に
`dist/mcp/index.js` の**絶対パス**をローカルサーバーとして登録し、`WIKI_ROOT` で vault を
固定します。MCP クライアントは `~` を展開しないため、必ず絶対パスを使ってください。
クライアント別の設定例は [`docs/harnesses.md`](docs/harnesses.md)。

> ### ⚠️ 1 vault につき書き込み側は 1 つだけ
> **ネイティブ DSH プラグインと MCP サーバーを同じ vault に対して同時に動かしては
> いけません。** どちらも `meta/` の投影を書き、どちらも `raw/` を保護します。書き込み側が
> 2 つあると再構築が交互に走り、ロックが互いを壊します。

---

## ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [DeepSeek Harness プラグイン](docs/dsh.md) | DSH のインストール、設定、サイドバー、ロケール、移植の判断 |
| [アーキテクチャ](docs/architecture.md) | 4 層の仕組みと所有モデル |
| [コマンド](docs/commands.md) | コマンドとツールのリファレンス |
| [Obsidian](docs/obsidian.md) | Vault 設定と推奨プラグイン |
| [設定](docs/configuration.md) | Wiki モード、トピック、環境変数 |
| [API](docs/api.md) | ツールパラメータのリファレンス |
| [ハーネス](docs/harnesses.md) | DSH 以外のホスト向け MCP 設定 |

---

## ライセンス

MIT — [LICENSE](LICENSE) を参照。[zosmaai](https://github.com/zosmaai) が
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) として構築し、本フォークが
DeepSeek Harness ネイティブ移植を維持しています。コントリビューター：
[README.md#contributors](./README.md#contributors)。

<div align="center">
  <sub>DSH 移植の保守：<a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · 上流：<a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
