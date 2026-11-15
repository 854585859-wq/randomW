import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDataFiles } from './utils/data.js';
import { apiRouter } from './routes/api.js';
import { adminRouter } from './routes/admin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 days
}));

// Initialize data files
initDataFiles();

// Mount routes
app.use('/api', apiRouter);
app.use('/api/admin', adminRouter);

// Vercel Cron：校验 Bearer CRON_SECRET（本地未配置时放行，便于手动测试）
function isCronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.authorization === `Bearer ${secret}`;
}

// 定时抓取高丽大化汀官方 history，自动补全演出档期
app.get('/api/cron/scrape-kuhj', async (req, res) => {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { syncKuhj } = await import('./scripts/kuhj-scraper.mjs');
    const result = await syncKuhj();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('KU scrape failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 定时日报（微信优先，邮件回退）
app.get('/api/cron/daily-report', async (req, res) => {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { runDailyReport } = await import('./scripts/daily-report.js');
    await runDailyReport();
    res.json({ ok: true });
  } catch (err) {
    console.error('Daily report failed:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Exclude this device from tracking
app.get('/notrack', (_req, res) => {
  res.cookie('notrack', '1', { maxAge: 365 * 24 * 60 * 60 * 1000, path: '/', sameSite: 'lax' });
  res.redirect('/');
});

// Serve public HTML pages
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/venues', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'venues.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html')));
app.get('/admin/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'dashboard.html')));

// 404
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use(async (err, _req, res, _next) => {
  console.error('Server error:', err.message);
  try {
    const { sendFeedbackEmail } = await import('./utils/mail.js');
    sendFeedbackEmail({
      name: 'System',
      email: '',
      message: `Server Error:\n${err.message}\n\nStack:\n${err.stack}`,
      page: 'error',
    });
  } catch {}
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-app-password') {
    console.warn('Warning: SMTP not configured. Email notifications will log to console only.');
  }
});
