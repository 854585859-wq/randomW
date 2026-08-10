#!/usr/bin/env node
/**
 * Create sent_emails table in Supabase
 * Usage: node scripts/setup-sent-emails.cjs
 */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

(async () => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY
  );

  // Try to read from the table to check if it exists
  const { error } = await supabase.from('sent_emails').select('id').limit(1);

  if (!error) {
    console.log('✅ sent_emails 表已存在');
    process.exit(0);
  }

  if (error.code !== '42P01') {
    console.error('❌ 检查失败:', error.message);
    process.exit(1);
  }

  console.log('⚠️  sent_emails 表不存在。');
  console.log('');
  console.log('请在 Supabase SQL Editor 中运行以下 SQL：');
  console.log('');
  console.log('---');
  console.log(`CREATE TABLE sent_emails (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  artist TEXT NOT NULL,
  concert_artist TEXT,
  concert_date TEXT,
  venue_name TEXT,
  type TEXT NOT NULL DEFAULT 'subscription',
  sent_at TIMESTAMPTZ DEFAULT now()
);`);
  console.log('---');
  console.log('');
  console.log('SQL Editor 地址: https://supabase.com/dashboard/project/_/sql');
  process.exit(1);
})().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
