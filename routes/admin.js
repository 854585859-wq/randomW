import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { readData, writeData } from '../utils/data.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendSubscriptionEmail } from '../utils/mail.js';
import { supabase } from '../lib/supabase.js';

export const adminRouter = Router();

// Helper: get next ID
function nextId(items) {
  if (items.length === 0) return 1;
  return Math.max(...items.map(i => i.id)) + 1;
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
  res.json({ success: true });
});

// --- Concerts (admin) ---
adminRouter.post('/concerts', requireAdmin, async (req, res) => {
  try {
    const concerts = await readData('concerts');
    const { id, date, endDate, artist, venueId, venueName, description } = req.body;

    if (id) {
      const idx = concerts.findIndex(c => c.id === id);
      if (idx === -1) return res.status(404).json({ error: '未找到该演唱会' });
      concerts[idx] = { id, date, endDate: endDate || null, artist, venueId, venueName, description };
    } else {
      const newConcert = {
        id: nextId(concerts),
        date, endDate: endDate || null, artist, venueId: parseInt(venueId), venueName, description: description || '',
      };
      concerts.push(newConcert);

      // Notify subscribers for new concerts
      try {
        const { data: subs, error: subErr } = await supabase.from('subscriptions').select('*');
        if (subErr) console.error('Supabase query error:', subErr);
        const matching = (subs || []).filter(s =>
          artist.toLowerCase().includes(s.artist.toLowerCase()) ||
          s.artist.toLowerCase().includes(artist.toLowerCase())
        );
        console.log(`Found ${matching.length} subscribers for ${artist}`);
        for (const s of matching) {
          const dateStr = endDate ? `${date} → ${endDate}` : date;
          await sendSubscriptionEmail({
            to: s.email,
            artist,
            dateStr,
            venueName,
            description: description || '',
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
    await writeData('concerts', concerts);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

adminRouter.delete('/concerts/:id', requireAdmin, async (req, res) => {
  try {
    const concerts = await readData('concerts');
    const filtered = concerts.filter(c => c.id !== parseInt(req.params.id));
    if (filtered.length === concerts.length) return res.status(404).json({ error: '未找到' });
    await writeData('concerts', filtered);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败' });
  }
});

// --- Venues (admin) ---
adminRouter.post('/venues', requireAdmin, async (req, res) => {
  try {
    const venues = await readData('venues');
    const { id, name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '场馆名称不能为空' });

    if (id) {
      const idx = venues.findIndex(v => v.id === id);
      if (idx === -1) return res.status(404).json({ error: '未找到该场馆' });
      venues[idx] = { id, name };
    } else {
      venues.push({ id: nextId(venues), name });
    }
    await writeData('venues', venues);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '操作失败' });
  }
});

adminRouter.delete('/venues/:id', requireAdmin, async (req, res) => {
  try {
    const venueId = parseInt(req.params.id);
    const concerts = await readData('concerts');
    const bookings = await readData('venueBookings');

    const hasConcert = concerts.some(c => c.venueId === venueId);
    const hasBooking = bookings.some(b => b.venueId === venueId);
    if (hasConcert || hasBooking) {
      return res.status(400).json({ error: '该场馆有关联的演唱会或档期，无法删除。请先删除关联数据。' });
    }

    const venues = await readData('venues');
    const filtered = venues.filter(v => v.id !== venueId);
    await writeData('venues', filtered);
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
