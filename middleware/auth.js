import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'dev-secret';
export const COOKIE_NAME = 'admin_token';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

function sign(data) {
  const payload = `${data}:${Date.now()}`;
  const hash = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return `${payload}:${hash}`;
}

export function verify(token) {
  try {
    const parts = token.split(':');
    const hash = parts.pop();
    const payload = parts.join(':');
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    return hash === expected;
  } catch { return false; }
}

export function setAdminCookie(res, username) {
  const token = sign(username);
  res.cookie(COOKIE_NAME, token, { httpOnly: true, maxAge: MAX_AGE, sameSite: 'lax', path: '/' });
}

export function clearAdminCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (token && verify(token)) return next();

  // Fallback to session
  if (req.session?.isAdmin) return next();

  return res.status(401).json({ error: '未登录或无权限' });
}
