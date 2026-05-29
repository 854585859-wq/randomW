import { Router } from 'express';
import { readData, writeData } from '../utils/data.js';
import { sendFeedbackEmail } from '../utils/mail.js';
import { supabase } from '../lib/supabase.js';
import { verify, COOKIE_NAME } from '../middleware/auth.js';

export const apiRouter = Router();

// GET /api/concerts
apiRouter.get('/concerts', async (_req, res) => {
  try {
    const { data } = await supabase.from('concerts').select('*').order('date');
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: '读取演唱会数据失败' });
  }
});

// GET /api/venues
apiRouter.get('/venues', async (_req, res) => {
  try {
    const { data } = await supabase.from('venues').select('*').order('sort_order').order('name');
    res.json(data || []);
  } catch (err) {
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
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token || !verify(token)) {
      await supabase.from('page_views').insert({ path: req.body.path || '/' });
    }
    // Admin visits are silently skipped
  } catch (err) {}
  res.json({ success: true });
});

// POST /api/subscribe
apiRouter.post('/subscribe', async (req, res) => {
  try {
    const { email, artist } = req.body;
    if (!email || !email.includes('@') || !artist) {
      return res.status(400).json({ error: '邮箱和艺人不能为空' });
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
    sendFeedbackEmail({ name, email, message, page });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '提交失败' });
  }
});
