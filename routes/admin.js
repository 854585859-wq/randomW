import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readData, writeData } from '../utils/data.js';
import { requireAdmin, setAdminCookie, clearAdminCookie } from '../middleware/auth.js';
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
  res.json({ loggedIn: !!req.session.isAdmin });
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
    const { id, name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '场馆名称不能为空' });

    if (id) {
      await supabase.from('venues').update({ name }).eq('id', id);
    } else {
      await supabase.from('venues').insert({ name });
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

// --- Stats (admin) ---
adminRouter.get('/stats', requireAdmin, async (_req, res) => {
  try {
    const { data: all } = await supabase.from('page_views').select('created_at');
    const total = all ? all.length : 0;
    const today = new Date().toISOString().split('T')[0];
    const todayViews = all ? all.filter(v => v.created_at.startsWith(today)).length : 0;
    res.json({ total, today: todayViews });
  } catch (err) {
    res.status(500).json({ error: '读取失败' });
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
