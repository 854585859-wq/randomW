import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readData, writeData } from '../utils/data.js';
import { requireAdmin, setAdminCookie, clearAdminCookie, verify, COOKIE_NAME } from '../middleware/auth.js';
import { sendSubscriptionEmail } from '../utils/mail.js';
import { supabase } from '../lib/supabase.js';

export const adminRouter = Router();

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
        for (const s of matching) {
          const dateStr = endDate ? `${date} → ${endDate}` : date;
          await sendSubscriptionEmail({
            to: s.email, artist, dateStr, venueName, description: description || '',
          });
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

    const today = new Date().toISOString().split('T')[0];

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

    const todayViews = all.filter(v => v.created_at.startsWith(today)).length;

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

adminRouter.delete('/subscriptions/:id', requireAdmin, async (req, res) => {
  try {
    await supabase.from('subscriptions').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});
