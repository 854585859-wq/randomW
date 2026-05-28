import { Router } from 'express';
import { readData, writeData } from '../utils/data.js';
import { sendFeedbackEmail } from '../utils/mail.js';

export const apiRouter = Router();

// GET /api/concerts
apiRouter.get('/concerts', async (_req, res) => {
  try {
    const concerts = await readData('concerts');
    res.json(concerts);
  } catch (err) {
    res.status(500).json({ error: '读取演唱会数据失败' });
  }
});

// GET /api/venues
apiRouter.get('/venues', async (_req, res) => {
  try {
    const venues = await readData('venues');
    res.json(venues);
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
