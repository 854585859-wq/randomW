import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { supabase } from '../lib/supabase.js';
import { notify } from '../utils/notify.js';

// 明华（명화라이브 / Myunghwa Live Hall）官方演出自动抓取 + 同步
// 数据源：https://mhlivehall.kr/concert —— 页面背后是公开 JSON 接口，key 写在前端 bundle 里（公开数据，非密钥）
// 规则（站长 2026-11 决定）：只抓「未来演出」自动入库；不补历史演出。
const BASE = 'https://mhlive.api.zigu.space';
const API_KEY = 'Z5zhmmbnGemTXf6wfIxHwHZARxNcQfEmmdumHvuJqxLfqurtqkvngJPCfXP9uIJNHyBvrOvg7n4WAt64kdBYTjuEPfno5mT1h38ZmPyYlN1PpEVEKxPqKgB1qKLIQDSS';
const VENUE_ID = 16;
const VENUE_NAME = 'Myunghwa/明华';
const PAGE_SIZE = 12;

// 韩国时区（UTC+9）的今天
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 接口日期是 UTC（如 2026-11-20T15:00:00Z = 韩国 11/21 00:00），转成韩国日期字符串
function kstDate(iso) {
  if (!iso) return null;
  return new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    page: String(page),
    size: String(PAGE_SIZE),
    concertPageScope: 'SCHEDULED',
    sort: 'period.start,asc',
  });
  params.append('sort', 'period.end,asc');
  const res = await fetch(`${BASE}/api/mhlive-calendars/concerts/page?${params}`, {
    headers: { 'api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`fetch page ${page} failed: HTTP ${res.status}`);
  return res.json();
}

export async function syncMhlive({ dryRun = false } = {}) {
  const first = await fetchPage(0);
  const totalPages = first.totalPages || 1;
  const pages = [first];
  for (let p = 1; p < totalPages; p++) pages.push(await fetchPage(p));

  const events = [];
  for (const pg of pages) {
    for (const c of pg.content || []) {
      const date = kstDate(c.fromPeriodDate);
      if (!date) continue;
      const end = kstDate(c.toPeriodDate);
      events.push({ title: c.title, date, end });
    }
  }

  const today = todayKST();
  // 只处理未来演出（含今天）；过去的按站长要求不补
  const futureEvents = events.filter((e) => e.date >= today);

  const { data: existing } = await supabase.from('concerts').select('date').eq('venue_id', VENUE_ID);
  const existingDates = new Set((existing || []).map((c) => c.date));
  const toAdd = futureEvents.filter((e) => !existingDates.has(e.date));

  const result = { total: events.length, future: futureEvents.length, added: [] };

  for (const ev of toAdd) {
    const endDate = ev.end && ev.end !== ev.date ? ev.end : null;
    const label = `${ev.title} @ ${ev.date}${endDate ? ' → ' + endDate : ''}`;
    if (dryRun) {
      result.added.push(label);
      continue;
    }
    const { error } = await supabase.from('concerts').insert({
      date: ev.date,
      end_date: endDate,
      artist: ev.title,
      venue_id: VENUE_ID,
      venue_name: VENUE_NAME,
      description: '来源：明华官方',
    });
    if (error) console.error(`insert fail (${label}):`, error.message);
    else {
      result.added.push(label);
      existingDates.add(ev.date);
    }
  }

  // 有新增时通过微信（Server酱）提醒站长；未配置 SendKey 则静默跳过
  if (!dryRun && result.added.length > 0) {
    const shown = result.added.slice(0, 40);
    const lines = shown.map((a) => `• ${a}`).join('\n');
    const more = result.added.length > 40 ? `\n…等共 ${result.added.length} 场` : '';
    await notify(`🆕 明华新增 ${result.added.length} 场未来演出`, lines + more);
  }

  return result;
}

// 直接运行本文件时执行（本地 dry-run / 手动同步）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  syncMhlive({ dryRun })
    .then((r) => {
      console.log(`\n[mhlive] ${dryRun ? 'DRY-RUN' : '同步完成'}：官方未来共 ${r.future} 条，本次新增 ${r.added.length} 条`);
      for (const a of r.added) console.log('  +', a);
      process.exit(0);
    })
    .catch((e) => { console.error('同步失败：', e); process.exit(1); });
}
