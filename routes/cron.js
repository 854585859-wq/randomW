import { Router } from 'express';
import { supabase } from '../lib/supabase.js';
import { sendSubscriptionEmail } from '../utils/mail.js';
import nodemailer from 'nodemailer';

export const cronRouter = Router();

const PRODUCT_URL = 'https://www.ktown4u.com/iteminfo?goods_no=160464';

function getTransporter() {
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-app-password') return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '' },
  });
}

// ── Ktown4u Stock Check ────────────────────────────────────
cronRouter.get('/ktown4u-check', async (_req, res) => {
  res.json({ checking: true }); // Respond quickly, continue in background

  try {
    // Fetch product page
    const htmlRes = await fetch(PRODUCT_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    });
    const html = await htmlRes.text();
    const match = html.match(/__NEXT_DATA__" type="application\/json">([^<]+)</);
    if (!match) return;

    const data = JSON.parse(match[1]);
    const pd = data.props.pageProps.productDetails;

    const isAvailable = pd.saleStatus === true || (pd.quantity || 0) > 0;
    const hasOptionStock = (pd.productOptionsValues || []).some(
      opt => opt.saleStatus !== 'N' || (opt.stockQty || 0) > 0
    );
    const reallyAvailable = isAvailable || hasOptionStock;

    // Load previous state
    const { data: row } = await supabase.from('monitor_state')
      .select('*').eq('key', 'ktown4u_160464').single();
    const state = row || { last_sale_status: false, last_quantity: 0, notified: false };

    const wasAvailable = state.last_sale_status || state.last_quantity > 0;

    // Notify if changed from unavailable → available
    if (reallyAvailable && !wasAvailable && !state.notified) {
      const transporter = getTransporter();
      if (transporter) {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: process.env.DEV_EMAIL,
          subject: `🔔 [补货通知] ${pd.productName} 已上架！`,
          text: [
            `🔔 补货通知！`,
            ``,
            `商品：${pd.productName}`,
            `艺人：${pd.artistName || ''}`,
            `价格：${pd.displayPrice || 'N/A'} USD`,
            `链接：${PRODUCT_URL}`,
            ``,
            `库存：${pd.quantity || 0}`,
            `预计到货：${pd.expectedStockDate || '未公布'}`,
            ``,
            `检测时间：${new Date().toLocaleString('zh-CN')}`,
          ].join('\n'),
        });
      }

      await supabase.from('monitor_state').upsert({
        key: 'ktown4u_160464',
        last_sale_status: reallyAvailable,
        last_quantity: pd.quantity || 0,
        notified: true,
      });
    }

    // Reset notified if becomes unavailable again
    if (!reallyAvailable && state.notified) {
      await supabase.from('monitor_state').upsert({
        key: 'ktown4u_160464',
        last_sale_status: false,
        last_quantity: 0,
        notified: false,
      });
    }

    if (reallyAvailable === state.last_sale_status && (pd.quantity || 0) === state.last_quantity) {
      // No change, just update timestamp silently
      return;
    }

    await supabase.from('monitor_state').upsert({
      key: 'ktown4u_160464',
      last_sale_status: reallyAvailable,
      last_quantity: pd.quantity || 0,
      notified: state.notified,
    });

  } catch (err) {
    console.error('[ktown4u]', err.message);
  }
});
