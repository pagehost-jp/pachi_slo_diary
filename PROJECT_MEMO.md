# pachi_slo_diary

パチスロ収支ノート - Gemini API連携ブログ自動生成ツール

## 概要
弟（スロプロ）のための毎日のパチスロ収支記録アプリ。
スクリーンショットをアップロードし、IN/OUTを入力するだけで、
Gemini APIが自動でブログ風の記事を生成する。

## データ形式（毎日アップロード）
Qマイスロアプリからのスクリーンショット：
- ゲーム数、DANCE TIME/DJ ZONEゲーム数
- BB/RB回数と確率
- NORMAL-BB、HYPER-BB、DOUBLE-UP-BB回数
- 技術介入成功率（真・極）
- 小役カウント（AT中共通10枚、スイカ、チェリー）
- 最大獲得枚数
- 実戦データグラフ（差枚数推移）

## 画面構成

### 1. 月別一覧画面（トップ）
- 年月選択（プルダウン）
- カレンダー or リスト形式で日付一覧
- 各日付に「収支」「機種名」サムネイル表示
- 月間トータル収支表示

### 2. 1日分の入力/詳細画面
- 日付表示
- スクリーンショットアップロード（複数枚可）
- IN（投資額）入力
- OUT（回収額）入力
- 機種名入力
- メモ欄（任意）
- 「ブログ生成」ボタン → Gemini APIで自動生成
- 生成されたブログ本文（編集可能テキストエリア）
- 保存ボタン

## 技術スタック
- **フロントエンド**: HTML/CSS/JavaScript（PWA対応予定）
- **データ保存**: IndexedDB（ブラウザローカル、画像もBase64で保存）
- **バックエンド**: Python FastAPI（Gemini API呼び出し用）
- **AI**: Google Gemini API（画像解析＋テキスト生成）

## ディレクトリ構成
```
pachi_slo_diary/
├── PROJECT_MEMO.md
├── index.html
├── style.css
├── script.js
├── backend/
│   ├── main.py          # FastAPI サーバー
│   └── requirements.txt
└── manifest.json        # PWA用
```

## 開発状況
- [x] プロジェクト作成
- [ ] フロントエンド基本構造
- [ ] 月別一覧画面
- [ ] 日別入力/詳細画面
- [ ] IndexedDBデータ保存
- [ ] FastAPIバックエンド
- [ ] Gemini API連携
