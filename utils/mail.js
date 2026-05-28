import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your-app-password') {
    return null;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });
  return transporter;
}

export async function sendFeedbackEmail({ name, email, message, page }) {
  const devEmail = process.env.DEV_EMAIL || 'developer@example.com';
  const subject = `[演唱会系统] 用户新反馈 - ${page}`;
  const body = `
用户提交了新反馈：

姓名：${name || '未提供'}
邮箱：${email || '未提供'}
来源页面：${page === 'calendar' ? '演唱会日历' : page === 'venues' ? '场馆档期' : page}
提交时间：${new Date().toLocaleString('zh-CN')}

消息内容：
${message}
`.trim();

  const t = getTransporter();
  if (!t) {
    console.log('--- Email would be sent ---');
    console.log('To:', devEmail);
    console.log('Subject:', subject);
    console.log(body);
    console.log('--- End email ---');
    return;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_USER,
      to: devEmail,
      subject,
      text: body,
    });
    console.log('Feedback email sent to', devEmail);
  } catch (err) {
    console.error('Failed to send feedback email:', err.message);
  }
}

export async function sendSubscriptionEmail({ to, artist, dateStr, venueName, description }) {
  const t = getTransporter();
  const body = `您关注的 ${artist} 有新演出！

日期：${dateStr}
场馆：${venueName}
描述：${description || '暂无'}

查看详情：https://concert-kr.space

——
本次推送为一次性通知。如需继续接收 ${artist} 或其他艺人的最新演出信息，请前往 https://concert-kr.space 重新订阅。`;

  if (!t) {
    console.log('--- Subscription email would be sent ---');
    console.log('To:', to);
    console.log(body);
    console.log('--- End ---');
    return;
  }

  try {
    await t.sendMail({
      from: process.env.SMTP_USER,
      to,
      subject: `[Concert Info] ${artist} 新演出通知`,
      text: body,
    });
    console.log('Subscription email sent to', to);
  } catch (err) {
    console.error('Failed to send subscription email:', err.message);
  }
}
