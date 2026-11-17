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

// 定时抓取：并行跑四个数据源（高丽大化汀 / 奥林匹克公园 / YES24 LIVE HALL / 明华）
// 合并成一个 cron 入口，避免占用多个 cron 名额
app.get('/api/cron/scrape-all', async (req, res) => {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const [{ syncKuhj }, { syncKspo }, { syncYes24 }, { syncMhlive }] = await Promise.all([
      import('./scripts/kuhj-scraper.mjs'),
      import('./scripts/kspo-scraper.mjs'),
      import('./scripts/yes24-scraper.mjs'),
      import('./scripts/mhlive-scraper.mjs'),
    ]);
    const [kuhj, kspo, yes24, mhlive] = await Promise.all([
      syncKuhj().catch(e => ({ error: e.message })),
      syncKspo().catch(e => ({ error: e.message })),
      syncYes24().catch(e => ({ error: e.message })),
      syncMhlive().catch(e => ({ error: e.message })),
    ]);
    res.json({ ok: true, kuhj, kspo, yes24, mhlive });
  } catch (err) {
    console.error('Scrape-all failed:', err.message);
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
