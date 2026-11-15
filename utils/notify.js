// utils/notify.js — 微信推送（Server酱 / 方糖），把站长的提醒从邮件换成微信
// 需要环境变量 SERVERCHAN_SENDKEY：在 https://sct.ftqq.com 用微信扫码绑定后获取
// 未配置时静默跳过并返回 false，调用方可以回退到邮件。
// 说明：只推送给站长本人（DEV_EMAIL 对应的收件人），不涉及前台订阅邮件。

const API = 'https://sctapi.ftqq.com/';

export async function notify(title, desp = '') {
  const key = process.env.SERVERCHAN_SENDKEY || process.env.SC_SENDKEY || '';
  if (!key) {
    console.log('[notify] 未配置 SERVERCHAN_SENDKEY，跳过微信推送');
    return false;
  }
  try {
    const res = await fetch(`${API}${key}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ title, desp }),
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.code === 0) {
      console.log('[notify] 微信推送成功');
      return true;
    }
    console.error('[notify] 微信推送失败：', JSON.stringify(data));
    return false;
  } catch (err) {
    console.error('[notify] 微信推送异常：', err.message);
    return false;
  }
}
