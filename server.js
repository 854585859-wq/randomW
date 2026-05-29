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
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
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
