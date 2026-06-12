import { Router } from 'express';
import { readData, writeData } from '../utils/data.js';
import { sendFeedbackEmail } from '../utils/mail.js';
import { supabase } from '../lib/supabase.js';
import { verify, COOKIE_NAME } from '../middleware/auth.js';

export const apiRouter = Router();

// Simple in-memory cache to avoid hitting slow Supabase on every request
const cache = new Map();
const CACHE_TTL = 60_000; // 1 minute

// GET /api/concerts
apiRouter.get('/concerts', async (_req, res) => {
  try {
    const cached = cache.get('concerts');
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.json(cached.data);
    }
    const { data } = await supabase.from('concerts').select('*').order('date');
    cache.set('concerts', { data: data || [], ts: Date.now() });
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(data || []);
  } catch (err) {
    // Serve stale cache on Supabase failure
    const stale = cache.get('concerts');
    if (stale) return res.json(stale.data);
    res.status(500).json({ error: '读取演唱会数据失败' });
  }
});

// GET /api/venues
apiRouter.get('/venues', async (_req, res) => {
  try {
    const cached = cache.get('venues');
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
      return res.json(cached.data);
    }
    const { data } = await supabase.from('venues').select('*').order('sort_order').order('name');
    cache.set('venues', { data: data || [], ts: Date.now() });
    res.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.json(data || []);
  } catch (err) {
    const stale = cache.get('venues');
    if (stale) return res.json(stale.data);
    res.status(500).json({ error: '读取场馆数据失败' });
  }
});

// GET /api/venue-bookings?venueId=xxx
apiRouter.get('/venue-bookings', async (req, res) => {
  try {
    const venueId = parseInt(req.query.venueId);
    const bookings = await readData('venueBookings');
    if (isNaN(venueId)) return res.json(bookings);
    res.json(bookings.filter(b => b.venueId === venueId));
  } catch (err) {
    res.status(500).json({ error: '读取档期数据失败' });
  }
});

// POST /api/track
apiRouter.post('/track', async (req, res) => {
  res.json({ success: true }); // Respond immediately, work in background
  try {
    if (req.cookies?.notrack) return;
    const token = req.cookies?.[COOKIE_NAME];
    if (token && verify(token)) return;

    const ip = req.ip || req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
    const ua = (req.headers['user-agent'] || '').slice(0, 200);

    // Insert with IP first
    const { data: inserted } = await supabase.from('page_views')
      .insert({ path: req.body.path || '/', ip, user_agent: ua })
      .select('id');

    if (!inserted?.length) return;
    const id = inserted[0].id;

    // Resolve IP → city in background
    const isPublic = ip && !ip.startsWith('127.') && !ip.startsWith('192.168.') && !ip.startsWith('10.') && !ip.startsWith('172.') && ip !== '::1';
    if (!isPublic) return;

    try {
      const geoRes = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?lang=zh-CN&fields=city,regionName,country,isp`);
      const geo = await geoRes.json();
      if (geo?.city) {
        await supabase.from('page_views').update({
          city: geo.city, region: geo.regionName || '', country: geo.country || '', isp: geo.isp || '',
        }).eq('id', id);
      }
    } catch {}
  } catch (err) {}
});

// POST /api/subscribe
apiRouter.post('/subscribe', async (req, res) => {
  try {
    const { email, artist } = req.body;
    if (!email || !artist) {
      return res.status(400).json({ error: '邮箱和艺人不能为空' });
    }
    // Basic email validation: must have @, domain must have . with valid TLD
    const emailMatch = email.match(/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/);
    if (!emailMatch) {
      return res.status(400).json({ error: '请输入有效的邮箱地址' });
    }
    const { data: existing } = await supabase.from('subscriptions').select('*').eq('email', email).eq('artist', artist);
    if (existing && existing.length > 0) return res.json({ success: true, message: '已订阅' });
    await supabase.from('subscriptions').insert({ email, artist });
    res.json({ success: true, message: '订阅成功' });
  } catch (err) {
    res.status(500).json({ error: '订阅失败' });
  }
});

// POST /api/user-feedback
apiRouter.post('/user-feedback', async (req, res) => {
  try {
    const { name, email, message, page } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: '消息内容不能为空' });
    }
    // Store in DB
    await supabase.from('feedback').insert({
      name: (name || '').trim(),
      email: (email || '').trim(),
      message: message.trim(),
      page: page || '',
    });
    // Also send email
    sendFeedbackEmail({ name, email, message, page });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '提交失败' });
  }
});
