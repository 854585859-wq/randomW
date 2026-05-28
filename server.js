import 'dotenv/config';
import express from 'express';
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }, // 8 hours
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

// 404 for unmatched API routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-app-password') {
    console.warn('Warning: SMTP not configured. Email notifications will log to console only.');
  }
});
