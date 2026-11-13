# test_llm-ide

このリポジトリは、llm-ide の以下の機能を検証するテストコードをまとめたものです。

- グラフ（graph）
- Loop（特にテスト生成・ship・Factory 周辺）
- リファクタリング（Refactoring loop）
- Factory（作業項目のボード）
- Issue（一覧・フィルタ・スケジュール保存）
- Gantt（日付計算・バー・ドラッグ移動・保存キュー）

テストは llm-ide 本体のコードをそのまま import して実行します。テスト専用のコピーは持ちません。

## 概要

- 対象: llm-ide のリポジトリ（別リポジトリ、ローカルに checkout 済みであること）
- テストランナー: Node.js 組み込みの `node:test`（外部依存なし）
- 形式: 純粋関数の単体テスト、および一時 DB を使う Issue スケジュール保存のテスト

## セットアップ

前提:

- Node.js 22.6 以上（TypeScript の型除去を使うため）
- llm-ide の checkout（`extension/` の依存関係を `npm ci` 済み。Issue スケジュール保存テストに必要）

```bash
git clone <このリポジトリのURL> test_llm-ide
cd test_llm-ide
cp .env.example .env   # LLM_IDE_ROOT に llm-ide の場所を書く
```

`LLM_IDE_ROOT` が未設定の場合は、このリポジトリの隣にある `llm-ide/` を使います。

## 使い方

```bash
# すべて
npm test

# 領域ごと
npm run test:graph
npm run test:loop
npm run test:refactor
npm run test:factory
npm run test:issues
npm run test:gantt
```

LLM_IDE_ROOT を指定して実行する例:

```bash
LLM_IDE_ROOT=/Users/me/llm-ide npm test
```

## ディレクトリ構成

```text
tests/
  helpers/root.mjs              llm-ide の場所を解決し、UI/拡張のモジュールを import する
  graph/                        グラフのデコード、検索、LOD、重み、ファイルツリー、循環検出、コードグラフの整形
  loop/                         Factory テンプレート、Factory ヘルパー、テスト結果の台帳、ship の差分、エージェントの権限境界
  refactor/                     組み込みの Refactoring loop の定義と設定
  factory/                      Factory ボードのアクション・レーン・要約・リンクの安全確認
  issues/                       Issue の読み込み・フィルタ・リポジトリ名・URL・冪等キー、スケジュールの保存（一時 DB）
  gantt/                        日付計算、バーの範囲、ドラッグ移動、保存キュー
```

## テストの方針

- llm-ide 本体の関数を変更せずに呼び出す（ブラックボックス）。
- 期待値は仕様として書く。実装と食い違う場合は、まず実装の意図を確認してからテストを直す。
- ファイルシステムや DB を使うテストは、OS の一時ディレクトリにだけ書く。llm-ide の実データには触れない。

## 注意

- テストが失敗した場合、llm-ide 側の回帰か、テスト側の期待値のずれかを区別してください。
- `extension/` の依存関係が無い場合、`tests/issues/issue-schedule-store.test.mjs` と `tests/graph/graph-rollup.test.mjs` は失敗します。
