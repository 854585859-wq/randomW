import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readData, writeData } from '../utils/data.js';
import { requireAdmin, setAdminCookie, clearAdminCookie, verify, COOKIE_NAME } from '../middleware/auth.js';
import { sendSubscriptionEmail, sendSubscriptionBatch } from '../utils/mail.js';
import { supabase } from '../lib/supabase.js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const adminRouter = Router();

// --- 时区工具：统计按北京时间 (UTC+8) ---
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

function beijingDateStr(ts) {
  return new Date(new Date(ts).getTime() + BEIJING_OFFSET_MS).toISOString().split('T')[0];
}

function beijingMonthStr(ts) {
  return new Date(new Date(ts).getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 7);
}

// --- Auth ---
adminRouter.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const users = await readData('users');
    const user = users.find(u => u.username === username);
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    req.session.isAdmin = true;
    req.session.username = username;
    setAdminCookie(res, username);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '登录失败' });
  }
});

adminRouter.get('/check', (req, res) => {
  // Check admin_token cookie first (stateless, survives server restart),
  // then fall back to session
  const token = req.cookies?.[COOKIE_NAME];
  const loggedIn = (token && verify(token)) || !!req.session?.isAdmin;
  res.json({ loggedIn });
});

adminRouter.post('/logout', (req, res) => {
  req.session.destroy();
  clearAdminCookie(res);
  res.json({ success: true });
});

// --- Concerts (admin) ---
adminRouter.post('/concerts', requireAdmin, async (req, res) => {
  try {
    const { id, date, endDate, artist, venueId, venueName, description } = req.body;
    const data = { date, end_date: endDate || null, artist, venue_id: parseInt(venueId), venue_name: venueName, description: description || '' };

    if (id) {
      await supabase.from('concerts').update(data).eq('id', id);
    } else {
      await supabase.from('concerts').insert(data);

      // Notify subscribers for new concerts
      try {
        const { data: subs } = await supabase.from('subscriptions').select('*');
        const matching = (subs || []).filter(s =>
          artist.toLowerCase().includes(s.artist.toLowerCase()) ||
          s.artist.toLowerCase().includes(artist.toLowerCase())
        );
        console.log(`Found ${matching.length} subscribers for ${artist}`);
        const dateStr = endDate ? `${date} → ${endDate}` : date;

        // 每 20 个收件人打包成一封 BCC 批量发送，避免 QQ 邮箱限流
        const BATCH_SIZE = 20;
        for (let i = 0; i < matching.length; i += BATCH_SIZE) {
          const batch = matching.slice(i, i + BATCH_SIZE);
          const recipients = batch.map(s => s.email);
          const result = await sendSubscriptionBatch({
            recipients, artist, dateStr, venueName, description: description || '',
          });
          // 记录每个收件人的状态
          for (const s of batch) {
            try {
              await supabase.from('sent_emails').insert({
                email: s.email, artist: s.artist, concert_artist: artist,
                concert_date: dateStr, venue_name: venueName,
                type: result.success ? 'subscription' : 'subscription_failed',
              });
            } catch {}
          }
          // 批次之间间隔 2 秒，进一步降低限流风险
          if (i + BATCH_SIZE < matching.length) {
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        if (matching.length > 0) {
          await supabase.from('subscriptions').delete().in('id', matching.map(s => s.id));
          console.log(`Sent ${matching.length} emails, cleared subscriptions`);
        }
      } catch (e) {
        console.error('Subscription notify error:', e.message);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

adminRouter.delete('/concerts/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('concerts').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// --- Venues (admin) ---
adminRouter.post('/venues', requireAdmin, async (req, res) => {
  try {
    const { id, name, sort_order } = req.body;

    const data = {};
    if (name && name.trim()) data.name = name.trim();
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order);

    if (Object.keys(data).length === 0) return res.status(400).json({ error: '无有效数据' });

    if (id) {
      await supabase.from('venues').update(data).eq('id', id);
    } else {
      if (!data.name) return res.status(400).json({ error: '场馆名称不能为空' });
      await supabase.from('venues').insert({ name: data.name, sort_order: data.sort_order || 0 });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

adminRouter.delete('/venues/:id', requireAdmin, async (req, res) => {
  try {
    const { data: concerts } = await supabase.from('concerts').select('id').eq('venue_id', req.params.id);
    if (concerts && concerts.length > 0) {
      return res.status(400).json({ error: '该场馆有演唱会关联，无法删除。请先删除关联演唱会。' });
    }
    await supabase.from('venues').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// Venue reorder
adminRouter.post('/venues/reorder', requireAdmin, async (req, res) => {
  try {
    const { id, direction } = req.body;
    const { data: venues } = await supabase.from('venues').select('*').order('sort_order').order('name');

    const idx = venues.findIndex(v => v.id === id);
    if (idx === -1) return res.status(404).json({ error: '未找到' });

    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= venues.length) return res.json({ success: true });

    const a = venues[idx], b = venues[swapIdx];
    await supabase.from('venues').update({ sort_order: b.sort_order }).eq('id', a.id);
    await supabase.from('venues').update({ sort_order: a.sort_order }).eq('id', b.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '排序失败' });
  }
});

// --- Stats (admin) ---
adminRouter.get('/stats', requireAdmin, async (_req, res) => {
  try {
    // Get actual total count (not limited by Supabase default 1000)
    const { count: total } = await supabase.from('page_views').select('*', { count: 'exact', head: true });

    const today = beijingDateStr(new Date());

    // Paginate to get all records for analysis (Supabase returns max 1000 per request)
    let all = [];
    let from = 0;
    const BATCH = 1000;
    while (true) {
      const { data: batch } = await supabase.from('page_views').select('created_at, path').range(from, from + BATCH - 1).order('id', { ascending: false });
      if (!batch || batch.length === 0) break;
      all = all.concat(batch);
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    const todayViews = all.filter(v => v.created_at && beijingDateStr(v.created_at) === today).length;

    // Venue visit popularity
    const venueVisitMap = {};
    all.forEach(v => {
      const match = v.path && v.path.match(/^venue\/(\d+)$/);
      if (match) {
        const venueId = parseInt(match[1]);
        venueVisitMap[venueId] = (venueVisitMap[venueId] || 0) + 1;
      }
    });

    const { data: venues } = await supabase.from('venues').select('id, name');
    const venueNameMap = {};
    (venues || []).forEach(v => { venueNameMap[v.id] = v.name; });

    const venueStats = Object.entries(venueVisitMap)
      .map(([id, count]) => ({ venue_id: parseInt(id), venue_name: venueNameMap[parseInt(id)] || '未知场馆', count }))
      .sort((a, b) => b.count - a.count);

    // Concert count per venue
    const { data: concerts } = await supabase.from('concerts').select('venue_id, venue_name');
    const concertCountMap = {};
    (concerts || []).forEach(c => {
      concertCountMap[c.venue_id] = concertCountMap[c.venue_id] || { venue_id: c.venue_id, venue_name: c.venue_name, count: 0 };
      concertCountMap[c.venue_id].count++;
    });
    const concertStats = Object.values(concertCountMap).sort((a, b) => b.count - a.count);

    res.json({ total: total || 0, today: todayViews, venueStats, concertStats });
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// --- Daily Stats (admin) ---
adminRouter.get('/daily-stats', requireAdmin, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;

    // Fetch all page_views with pagination
    let all = [];
    let from = 0;
    const BATCH = 1000;
    while (true) {
      const { data: batch } = await supabase.from('page_views').select('created_at').range(from, from + BATCH - 1).order('id', { ascending: false });
      if (!batch || batch.length === 0) break;
      all = all.concat(batch);
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    // Build date range (Beijing time)
    const result = [];
    const beijingNow = new Date(Date.now() + BEIJING_OFFSET_MS);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(beijingNow);
      d.setDate(d.getDate() - i);
      result.push({ date: d.toISOString().split('T')[0], count: 0 });
    }

    // Count per day (Beijing time)
    all.forEach(v => {
      if (!v.created_at) return;
      const dateStr = beijingDateStr(v.created_at);
      const entry = result.find(r => r.date === dateStr);
      if (entry) entry.count++;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// --- Monthly Stats (admin) ---
adminRouter.get('/monthly-stats', requireAdmin, async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 12;

    // Fetch all page_views with pagination
    let all = [];
    let from = 0;
    const BATCH = 1000;
    while (true) {
      const { data: batch } = await supabase.from('page_views').select('created_at').range(from, from + BATCH - 1).order('id', { ascending: false });
      if (!batch || batch.length === 0) break;
      all = all.concat(batch);
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    // Build month range (Beijing time)
    const result = [];
    const beijingNow = new Date(Date.now() + BEIJING_OFFSET_MS);
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(beijingNow);
      d.setMonth(d.getMonth() - i);
      d.setDate(1);
      const monthStr = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      result.push({ month: monthStr, count: 0 });
    }

    // Count per month (Beijing time)
    all.forEach(v => {
      if (!v.created_at) return;
      const monthStr = beijingMonthStr(v.created_at);
      const entry = result.find(r => r.month === monthStr);
      if (entry) entry.count++;
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// --- IP Analytics (admin) ---
adminRouter.get('/ip-stats', requireAdmin, async (_req, res) => {
  try {
    // Paginate to get all records
    let all = [];
    let from = 0;
    const BATCH = 1000;
    while (true) {
      const { data: batch } = await supabase.from('page_views')
        .select('ip, city, region, country, isp, created_at')
        .range(from, from + BATCH - 1).order('id', { ascending: false });
      if (!batch || batch.length === 0) break;
      all = all.concat(batch);
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    // City distribution
    const cityMap = {};
    // ISP distribution
    const ispMap = {};
    // Top IPs
    const ipMap = {};

    all.forEach(v => {
      const cityKey = [v.city, v.region, v.country].filter(Boolean).join(', ') || '未知';
      cityMap[cityKey] = (cityMap[cityKey] || 0) + 1;

      if (v.isp) ispMap[v.isp] = (ispMap[v.isp] || 0) + 1;

      if (v.ip) {
        if (!ipMap[v.ip]) {
          ipMap[v.ip] = { ip: v.ip, city: v.city || '', region: v.region || '', country: v.country || '', isp: v.isp || '', count: 0 };
        }
        ipMap[v.ip].count++;
      }
    });

    const cities = Object.entries(cityMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const isps = Object.entries(ispMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const topIPs = Object.values(ipMap).sort((a, b) => b.count - a.count).slice(0, 20);

    const withIP = all.filter(v => v.ip).length;
    const total = all.length;

    res.json({ cities, isps, topIPs, withIP, total });
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// --- Feedback (admin) ---
adminRouter.get('/feedback', requireAdmin, async (_req, res) => {
  try {
    const { data } = await supabase.from('feedback').select('*').order('id', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

adminRouter.delete('/feedback/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('feedback').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// --- Subscriptions (admin) ---
adminRouter.get('/subscriptions', requireAdmin, async (_req, res) => {
  try {
    const { data } = await supabase.from('subscriptions').select('*').order('created_at', { ascending: false });
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

// --- Sent Emails (admin) ---
adminRouter.get('/sent-emails', requireAdmin, async (_req, res) => {
  try {
    const { data } = await supabase.from('sent_emails').select('*').order('sent_at', { ascending: false }).limit(500);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
  }
});

adminRouter.post('/subscriptions/:id/push', requireAdmin, async (req, res) => {
  try {
    const { data: subs } = await supabase.from('subscriptions').select('*').eq('id', req.params.id);
    if (!subs || subs.length === 0) {
      return res.status(404).json({ error: '订阅不存在' });
    }
    const sub = subs[0];

    const today = new Date().toISOString().split('T')[0];
    const { data: concerts } = await supabase.from('concerts').select('*').gte('date', today).order('date');

    const matching = (concerts || []).filter(c =>
      c.artist.toLowerCase().includes(sub.artist.toLowerCase()) ||
      sub.artist.toLowerCase().includes(c.artist.toLowerCase())
    );

    if (matching.length === 0) {
      return res.status(404).json({ error: `没有找到 ${sub.artist} 的 upcoming 演出` });
    }

    for (const c of matching) {
      const dateStr = c.end_date ? `${c.date} → ${c.end_date}` : c.date;
      try {
        await sendSubscriptionEmail({
          to: sub.email, artist: c.artist, dateStr, venueName: c.venue_name, description: c.description || '',
        });
        await supabase.from('sent_emails').insert({
          email: sub.email, artist: sub.artist, concert_artist: c.artist,
          concert_date: dateStr, venue_name: c.venue_name, type: 'subscription',
        });
      } catch (mailErr) {
        console.error('Push send failed:', mailErr.message);
        try { await supabase.from('sent_emails').insert({ email: sub.email, artist: sub.artist, concert_artist: c.artist, concert_date: dateStr, venue_name: c.venue_name, type: 'subscription_failed' }); } catch {}
      }
    }

    await supabase.from('subscriptions').delete().eq('id', sub.id);

    res.json({ success: true, sent: matching.length, artist: sub.artist, email: sub.email });
  } catch (err) {
    console.error('Push error:', err.message);
    res.status(500).json({ error: '推送失败' });
  }
});

adminRouter.delete('/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('subscriptions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// --- Build mini-tool zip (admin) ---
adminRouter.post('/build-minitool', requireAdmin, async (_req, res) => {
  try {
    const { data: concerts } = await supabase.from('concerts').select('*').order('date');
    const { data: venues } = await supabase.from('venues').select('*').order('sort_order').order('name');

    const cleanConcerts = concerts.map(c => ({
      id: c.id, date: c.date, end_date: c.end_date, artist: c.artist,
      venue_id: c.venue_id, venue_name: c.venue_name, description: c.description || '',
    }));
    const cleanVenues = venues.map(v => ({
      id: v.id, name: v.name, sort_order: v.sort_order,
    }));

    const distDir = path.join(__dirname, '..', 'dist');
    const templateDir = path.join(__dirname, '..', 'minitool');
    const buildDir = path.join(distDir, 'concert-calendar');

    fs.mkdirSync(buildDir, { recursive: true });

    // Copy template files
    fs.copyFileSync(path.join(templateDir, 'index.html'), path.join(buildDir, 'index.html'));
    fs.copyFileSync(path.join(templateDir, 'app.js'), path.join(buildDir, 'app.js'));

    // Write data.js with fresh data
    const dataJS = `window.__DATA__ = ${JSON.stringify({ concerts: cleanConcerts, venues: cleanVenues })};`;
    fs.writeFileSync(path.join(buildDir, 'data.js'), dataJS);

    // Zip
    const zipPath = path.join(distDir, 'concert-calendar.zip');
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    execSync(`cd "${buildDir}" && zip -r "${zipPath}" . -x '*.DS_Store'`, { stdio: 'pipe' });

    const size = (fs.statSync(zipPath).size / 1024).toFixed(0);
    res.json({ success: true, count: cleanConcerts.length, venues: cleanVenues.length, size: `${size} KB` });
  } catch (err) {
    console.error('Build mini-tool error:', err.message);
    res.status(500).json({ error: '构建失败: ' + err.message });
  }
});

// Download built mini-tool zip
adminRouter.get('/download-minitool', requireAdmin, (_req, res) => {
  const zipPath = path.join(__dirname, '..', 'dist', 'concert-calendar.zip');
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: '请先构建小工具' });
  }
  res.download(zipPath, 'concert-calendar.zip');
});
