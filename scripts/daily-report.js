import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import nodemailer from 'nodemailer';
import { createClient } from '@supabase/supabase-js';

// ── Supabase ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_ANON_KEY || '',
);

// ── Email ─────────────────────────────────────────────────────
function getTransporter() {
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-app-password') {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
}

// ── Report Logic ──────────────────────────────────────────────
async function generateReport() {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  // Fetch all data with pagination (Supabase max 1000 per request)
  let allViews = [];
  let from = 0;
  const BATCH = 1000;
  while (true) {
    const { data: batch } = await supabase.from('page_views')
      .select('created_at, path')
      .range(from, from + BATCH - 1).order('id', { ascending: false });
    if (!batch || batch.length === 0) break;
    allViews = allViews.concat(batch);
    if (batch.length < BATCH) break;
    from += BATCH;
  }
  const totalViews = allViews.length;

  const { data: venues } = await supabase.from('venues').select('id, name');

  const venueNameMap = {};
  (venues || []).forEach(v => { venueNameMap[v.id] = v.name; });

  // Today / yesterday views
  const todayViews = allViews.filter(v => v.created_at.startsWith(todayStr));
  const yesterdayViews = allViews.filter(v => v.created_at.startsWith(yesterdayStr));

  // Venue visit counts (today)
  const venueVisitMap = {};
  (allViews || []).forEach(v => {
    const match = v.path && v.path.match(/^venue\/(\d+)$/);
    if (match) {
      const venueId = parseInt(match[1]);
      venueVisitMap[venueId] = (venueVisitMap[venueId] || 0) + 1;
    }
  });

  const venueStats = Object.entries(venueVisitMap)
    .map(([id, count]) => ({
      venue_id: parseInt(id),
      venue_name: venueNameMap[parseInt(id)] || '未知场馆',
      count,
    }))
    .sort((a, b) => b.count - a.count);

  // Top venue today
  const todayVenueVisits = {};
  todayViews.forEach(v => {
    const match = v.path && v.path.match(/^venue\/(\d+)$/);
    if (match) {
      const venueId = parseInt(match[1]);
      todayVenueVisits[venueId] = (todayVenueVisits[venueId] || 0) + 1;
    }
  });
  const topTodayVenue = Object.entries(todayVenueVisits)
    .sort((a, b) => b[1] - a[1])[0];

  // Concert count
  const { data: concerts } = await supabase.from('concerts').select('*');

  // Yesterday's new additions
  const newConcerts = (concerts || []).filter(c => c.created_at && c.created_at.startsWith(yesterdayStr));
  const newVenues = (venues || []).filter(v => v.created_at && v.created_at.startsWith(yesterdayStr));

  return { todayStr, yesterdayStr, todayViews, yesterdayViews, totalViews, venueStats, topTodayVenue, concerts, venueNameMap, newConcerts, newVenues };
}

async function main() {
  console.log(`[${new Date().toLocaleString('zh-CN')}] 生成日报...`);

  try {
    const { todayStr, todayViews, yesterdayViews, totalViews, venueStats, topTodayVenue, concerts, newConcerts, newVenues } = await generateReport();

    const todayCount = todayViews.length;
    const yesterdayCount = yesterdayViews.length;
    const change = yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount * 100).toFixed(0) : 'N/A';

    // Unique visitors today (by cookie token)
    const uniqueIPs = new Set();
    todayViews.forEach(v => { if (v.ip) uniqueIPs.add(v.ip); });

    // Build venue ranking lines
    const topVenues = venueStats.slice(0, 5);
    const venueLines = topVenues.length === 0
      ? '暂无场馆访问数据'
      : topVenues.map((v, i) => `  ${i + 1}. ${v.venue_name} — ${v.count} 次访问`).join('\n');

    const totalConcerts = concerts ? concerts.length : 0;

    // Yesterday's new additions
    const newConcertLines = newConcerts.length === 0
      ? '  无新增演唱会'
      : newConcerts.map(c => `  • ${c.date}${c.end_date ? ' → ' + c.end_date : ''}  ${c.artist} @ ${c.venue_name}`).join('\n');

    const newVenueLines = newVenues.length === 0
      ? '  无新增场馆'
      : newVenues.map(v => `  • ${v.name}`).join('\n');

    // Upcoming concerts
    const upcoming = (concerts || [])
      .filter(c => c.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 5);
    const upcomingLines = upcoming.length === 0
      ? '暂无近期演唱会'
      : upcoming.map(c => `  • ${c.date} ${c.artist} @ ${c.venue_name}`).join('\n');

    const body = [
      `📊 Concert Info 日报`,
      `日期：${todayStr}`,
      ``,
      `━━━━ 访问统计 ━━━━`,
      `今日访问：${todayCount} 次`,
      `昨日访问：${yesterdayCount} 次`,
      `变化：${change === 'N/A' ? 'N/A' : (change >= 0 ? '+' + change + '%' : change + '%')}`,
      `累计总访问：${totalViews} 次`,
      ``,
      `━━━━ 热门场馆 Top 5 ━━━━`,
      venueLines,
      ``,
      topTodayVenue
        ? `🏆 今日最热门场馆：${topTodayVenue[1] ? venueStats.find(v => v.venue_id === parseInt(topTodayVenue[0]))?.venue_name || '未知' : '未知'}（${topTodayVenue[1]} 次访问）`
        : '🏆 今日暂无场馆访问',
      ``,
      `━━━━ 演唱会概况 ━━━━`,
      `总演唱会场次：${totalConcerts}`,
      ``,
      `━━━━ 昨日新增 ━━━━`,
      `新增演唱会（${newConcerts.length} 场）：`,
      newConcertLines,
      ``,
      `新增场馆（${newVenues.length} 个）：`,
      newVenueLines,
      ``,
      `近期演出：`,
      upcomingLines,
      ``,
      `── 每日自动报告 ──`,
    ].join('\n');

    const transporter = getTransporter();
    if (!transporter) {
      console.log('SMTP 未配置，仅输出到控制台：');
      console.log(body);
      return;
    }

    await transporter.sendMail({
      from: process.env.SMTP_USER,
      to: process.env.DEV_EMAIL,
      subject: `📊 Concert Info 日报 — ${todayStr}`,
      text: body,
    });

    console.log(`日报已发送至 ${process.env.DEV_EMAIL}`);
  } catch (err) {
    console.error('日报生成/发送失败：', err.message);
    process.exit(1);
  }
}

main();
