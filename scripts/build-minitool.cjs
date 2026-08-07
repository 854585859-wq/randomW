#!/usr/bin/env node
/**
 * 从 Supabase 拉最新数据 → 生成 data.js → 重新打包小工具 zip
 *
 * 用法: node scripts/build-minitool.js
 * 产物: dist/concert-calendar.zip
 */

const { supabase } = require('../lib/supabase.js');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIST = path.join(__dirname, '..', 'dist');
const TEMPLATE = path.join(__dirname, '..', 'minitool');
const BUILD = path.join(DIST, 'concert-calendar');

(async () => {
  console.log('🔍 从 Supabase 拉取最新数据...');

  const { data: concerts } = await supabase.from('concerts').select('*').order('date');
  const { data: venues } = await supabase.from('venues').select('*').order('sort_order').order('name');

  if (!concerts || !venues) {
    console.error('❌ 数据拉取失败');
    process.exit(1);
  }

  const cleanConcerts = concerts.map(c => ({
    id: c.id, date: c.date, end_date: c.end_date, artist: c.artist,
    venue_id: c.venue_id, venue_name: c.venue_name, description: c.description || '',
  }));
  const cleanVenues = venues.map(v => ({
    id: v.id, name: v.name, sort_order: v.sort_order,
  }));

  // Copy templates + write data
  fs.mkdirSync(BUILD, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATE, 'index.html'), path.join(BUILD, 'index.html'));
  fs.copyFileSync(path.join(TEMPLATE, 'app.js'), path.join(BUILD, 'app.js'));
  fs.writeFileSync(path.join(BUILD, 'data.js'),
    `window.__DATA__ = ${JSON.stringify({ concerts: cleanConcerts, venues: cleanVenues })};`);
  console.log(`✅ data.js 已更新 (${cleanConcerts.length} 场演出 / ${cleanVenues.length} 个场馆)`);

  // Zip
  const zipPath = path.join(DIST, 'concert-calendar.zip');
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${BUILD}" && zip -r "${zipPath}" . -x '*.DS_Store'`, { stdio: 'pipe' });

  const size = (fs.statSync(zipPath).size / 1024).toFixed(0);
  console.log(`📦 已打包: dist/concert-calendar.zip (${size} KB)`);
  console.log('🎉 完成！可以去小红书后台上传新版本了。');
})().catch(err => {
  console.error('❌', err.message);
  process.exit(1);
});
