-- ================================================================================
-- 工程表アプリ - Supabaseデータベースセットアップ手順
-- ================================================================================

-- 1. tasksテーブルの作成
-- ================================================================================
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  text TEXT NOT NULL CHECK (char_length(text) > 0 AND char_length(text) <= 200),
  assignee TEXT CHECK (char_length(assignee) <= 100),
  start_key TEXT NOT NULL CHECK (start_key ~ '^\d{4}-\d{2}-\d{2}$'),
  end_key TEXT NOT NULL CHECK (end_key ~ '^\d{4}-\d{2}-\d{2}$'),
  color TEXT NOT NULL DEFAULT 'orange' CHECK (color IN ('orange', 'blue', 'green', 'red', 'yellow', 'purple', 'gray')),
  done BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. インデックスの作成（パフォーマンス向上）
-- ================================================================================
CREATE INDEX IF NOT EXISTS idx_tasks_start_key ON tasks(start_key);
CREATE INDEX IF NOT EXISTS idx_tasks_end_key ON tasks(end_key);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
CREATE INDEX IF NOT EXISTS idx_tasks_color ON tasks(color);
CREATE INDEX IF NOT EXISTS idx_tasks_created_at ON tasks(created_at DESC);

-- 3. リアルタイム更新の有効化
-- ================================================================================
ALTER TABLE tasks REPLICA IDENTITY FULL;

-- 4. 更新日時の自動更新トリガー
-- ================================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tasks_updated_at 
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Row Level Security (RLS) の設定
-- ================================================================================
-- RLSを有効化
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- オプション A: 認証不要（全員が読み書き可能）
-- ============================================================
-- ⚠️ 注意: 誰でもデータを見たり編集できます
-- 社内イントラネットなど、限られた環境でのみ推奨

CREATE POLICY "全員がタスクを閲覧可能" ON tasks
    FOR SELECT USING (true);

CREATE POLICY "全員がタスクを作成可能" ON tasks
    FOR INSERT WITH CHECK (true);

CREATE POLICY "全員がタスクを更新可能" ON tasks
    FOR UPDATE USING (true);

CREATE POLICY "全員がタスクを削除可能" ON tasks
    FOR DELETE USING (true);

-- ============================================================
-- オプション B: 認証必須（推奨）
-- ============================================================
-- Supabaseの認証機能を使用する場合
-- 以下のコメントを外して、上記のポリシーを削除してください

-- CREATE POLICY "認証ユーザーがタスクを閲覧可能" ON tasks
--     FOR SELECT USING (auth.role() = 'authenticated');
-- 
-- CREATE POLICY "認証ユーザーがタスクを作成可能" ON tasks
--     FOR INSERT WITH CHECK (auth.role() = 'authenticated');
-- 
-- CREATE POLICY "認証ユーザーがタスクを更新可能" ON tasks
--     FOR UPDATE USING (auth.role() = 'authenticated');
-- 
-- CREATE POLICY "認証ユーザーがタスクを削除可能" ON tasks
--     FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================
-- オプション C: 組織単位の制限（より安全）
-- ============================================================
-- ユーザーテーブルに organization_id を持たせる場合
-- 以下のコメントを外して、上記のポリシーを削除してください

-- -- ユーザープロファイルテーブル（別途作成が必要）
-- CREATE TABLE IF NOT EXISTS user_profiles (
--   id UUID REFERENCES auth.users PRIMARY KEY,
--   organization_id UUID NOT NULL,
--   created_at TIMESTAMPTZ DEFAULT NOW()
-- );
-- 
-- -- tasksテーブルに organization_id を追加
-- ALTER TABLE tasks ADD COLUMN organization_id UUID;
-- CREATE INDEX idx_tasks_organization ON tasks(organization_id);
-- 
-- -- 同じ組織のユーザーのみアクセス可能
-- CREATE POLICY "同じ組織のタスクを閲覧可能" ON tasks
--     FOR SELECT USING (
--       organization_id IN (
--         SELECT organization_id FROM user_profiles WHERE id = auth.uid()
--       )
--     );
-- 
-- CREATE POLICY "同じ組織にタスクを作成可能" ON tasks
--     FOR INSERT WITH CHECK (
--       organization_id IN (
--         SELECT organization_id FROM user_profiles WHERE id = auth.uid()
--       )
--     );
-- 
-- CREATE POLICY "同じ組織のタスクを更新可能" ON tasks
--     FOR UPDATE USING (
--       organization_id IN (
--         SELECT organization_id FROM user_profiles WHERE id = auth.uid()
--       )
--     );
-- 
-- CREATE POLICY "同じ組織のタスクを削除可能" ON tasks
--     FOR DELETE USING (
--       organization_id IN (
--         SELECT organization_id FROM user_profiles WHERE id = auth.uid()
--       )
--     );

-- ================================================================================
-- セットアップ完了！
-- ================================================================================
-- 
-- 次のステップ:
-- 1. Supabaseの「SQL Editor」でこのファイルの内容を実行
-- 2. 「Database」→「Tables」で tasks テーブルが作成されたことを確認
-- 3. 「Database」→「Replication」でリアルタイム更新が有効になっていることを確認
-- 4. アプリケーションをテストして正常に動作することを確認
--
-- トラブルシューティング:
-- - RLSエラーが出る場合: ポリシーの設定を確認
-- - リアルタイム更新が動かない場合: REPLICA IDENTITYとReplicationを確認
-- - 権限エラーが出る場合: Supabaseのプロジェクト設定でanon keyの権限を確認
