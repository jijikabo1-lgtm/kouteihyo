# kouteihyo（工程表）

建設現場向けのスケジュール管理システムです。タスクをガントチャート形式で管理し、複数端末でリアルタイム同期が可能です。

## 🚀 主な機能

- **3つのビューモード**
  - 📅 今日の作業
  - 📆 明日の作業
  - 📋 工程表（7日/14日/28日表示）

- **タスク管理**
  - タスクの追加・編集・削除
  - 7種類の工種分類（構造、設備、内装、検査、定例、搬入、その他）
  - 完了/未完了のトグル
  - 担当者（会社名・担当者名）の管理

- **フィルタリング**
  - 担当者名での絞り込み
  - 工種別での絞り込み

- **リアルタイム同期**
  - Supabaseによる複数端末間のデータ同期

## 📋 セットアップ手順

### 1. リポジトリのクローン

```bash
git clone <repository-url>
cd kouteihyo
```

### 2. 依存パッケージのインストール

```bash
npm install
```

### 3. Supabaseプロジェクトのセットアップ

1. [Supabase](https://supabase.com/)にアクセスし、新しいプロジェクトを作成
2. SQLエディタで以下のテーブルを作成:

```sql
-- tasksテーブルの作成
CREATE TABLE tasks (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL,
  assignee TEXT,
  start_key TEXT NOT NULL,
  end_key TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'orange',
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックスの作成（パフォーマンス向上）
CREATE INDEX idx_tasks_start_key ON tasks(start_key);
CREATE INDEX idx_tasks_end_key ON tasks(end_key);

-- リアルタイム更新の有効化
ALTER TABLE tasks REPLICA IDENTITY FULL;
```

3. プロジェクト設定からAPI情報を取得:
   - Project URL: `https://your-project-id.supabase.co`
   - anon/public key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### 4. 環境変数の設定

```bash
# .env.exampleをコピー
cp .env.example .env

# .envファイルを編集して、Supabaseの情報を入力
# VITE_SUPABASE_URL=https://your-project-id.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 5. 開発サーバーの起動

```bash
npm run dev
```

ブラウザで http://localhost:5173 にアクセスしてください。

## 🏗️ ビルド

```bash
npm run build
```

ビルドされたファイルは `dist` ディレクトリに出力されます。

## 📱 使い方

### タスクの追加

1. カレンダーの日付をクリック
2. 作業内容、担当者、工種、期間を入力
3. 「追加する」ボタンをクリック

### タスクの編集・削除

1. タスクバーをクリックしてプレビューを表示
2. 「編集する」ボタンから編集
3. 「削除」ボタンで削除

### フィルタリング

- 検索バーに担当者名を入力して絞り込み
- 工種チップをクリックして工種別に絞り込み

## 🛠️ 技術スタック

- **フロントエンド**: React 18 + Vite
- **バックエンド**: Supabase (PostgreSQL + Realtime)
- **スタイリング**: インラインCSS（CSS-in-JSスタイル）

## 🐛 トラブルシューティング

### タスクが表示されない

1. ブラウザのコンソールを確認
2. 環境変数（.env）が正しく設定されているか確認
3. Supabaseのテーブルが正しく作成されているか確認
4. ネットワークタブでAPI通信を確認

### リアルタイム同期が動作しない

1. Supabaseプロジェクトでリアルタイム機能が有効か確認
2. `ALTER TABLE tasks REPLICA IDENTITY FULL;` が実行されているか確認

## 📝 ライセンス

MIT

## 🤝 コントリビューション

プルリクエストを歓迎します！
