import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase環境変数が設定されていません')
  console.error('VITE_SUPABASE_URL:', supabaseUrl ? '設定済み' : '未設定')
  console.error('VITE_SUPABASE_ANON_KEY:', supabaseKey ? '設定済み' : '未設定')
  throw new Error(
    'Supabase環境変数が設定されていません。\n' +
    '.envファイルに以下を設定してください:\n' +
    'VITE_SUPABASE_URL=your-supabase-url\n' +
    'VITE_SUPABASE_ANON_KEY=your-supabase-anon-key'
  )
}

export const supabase = createClient(supabaseUrl, supabaseKey)
