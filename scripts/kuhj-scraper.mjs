import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { supabase } from '../lib/supabase.js';
import { notify } from '../utils/notify.js';

const execFileP = promisify(execFile);

// 高丽大化汀（Korea Univ. Hwajeong Gymnasium）官方 history 自动抓取 + 同步
// 数据源：https://kuhj.korea.ac.kr/kuhj/community/history.do
const BASE = 'https://kuhj.korea.ac.kr/kuhj/community/history.do';
const PAGE_SIZE = 5;
const CONCURRENCY = 6;
const VENUE_ID = 11;
const VENUE_NAME = '高丽大化汀';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

// 韩国时区（UTC+9）的今天，用来区分「未来演出」与「历史演出」
function todayKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

// 每条标题形如：TITLE(2026.10.03 - 2026.10.05) 或 TITLE(2026.07.11 - 2026.07.11)
// 只解析带日期的条目（历史老条目不带日期，跳过）
function parsePage(html) {
  const out = [];
  const re = /articleNo=(\d+)[^>]*>([^<]*)<\/a>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const no = Number(m[1]);
    const rawTitle = decodeHtml(m[2]);
    const d = rawTitle.match(/\((\d{4})\.(\d{2})\.(\d{2})(?:\s*-\s*(\d{4})\.(\d{2})\.(\d{2}))?\)\s*$/);
    if (!d) continue;
    const date = `${d[1]}-${d[2]}-${d[3]}`;
    const end = d[4] ? `${d[4]}-${d[5]}-${d[6]}` : null;
    const name = rawTitle
      .replace(/\((\d{4})\.(\d{2})\.(\d{2})(?:\s*-\s*(\d{4})\.(\d{2})\.(\d{2}))?\)\s*$/, '')
      .replace(/^20\d{2}(?:-\d{2})?\s*/, '')
      .trim();
    out.push({ no, title: rawTitle, name, date, end });
  }
  return out;
}

async function fetchPage(offset) {
  const url = `${BASE}?mode=list&&articleLimit=${PAGE_SIZE}&article.offset=${offset}`;
  // 本机 Node 的 TLS 握手到该站点会挂起（原生 fetch/https 均超时），curl 正常。
  // 因此统一走 curl 抓取，本地与 Vercel 运行时都可用。
  const { stdout } = await execFileP('curl', [
    '-4', '-s', '-L', '--max-time', '30', '--retry', '2', '-A', UA, url,
  ], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

export async function syncKuhj({ dryRun = false } = {}) {
  const first = await fetchPage(0);
  const allOffsets = [...first.matchAll(/article\.offset=(\d+)/g)].map(m => Number(m[1]));
  const lastOffset = allOffsets.length ? Math.max(...allOffsets) : 0;

  const offsets = [];
  for (let o = 0; o <= lastOffset; o += PAGE_SIZE) offsets.push(o);

  const pages = [first];
  for (let i = 1; i < offsets.length; i += CONCURRENCY) {
    const batch = offsets.slice(i, i + CONCURRENCY);
    pages.push(...(await Promise.all(batch.map(fetchPage))));
  }

  const seen = new Set();
  const events = [];
  for (const html of pages) {
    for (const ev of parsePage(html)) {
      if (seen.has(ev.no)) continue;
      seen.add(ev.no);
      events.push(ev);
    }
  }

  const { data: existing } = await supabase.from('concerts').select('date').eq('venue_id', VENUE_ID);
  const existingDates = new Set((existing || []).map(c => c.date));

  const today = todayKST();
  const toAdd = events.filter(e => !existingDates.has(e.date));
  // 未来演出：只提醒、不自动入库（站长手动翻译成合适语言后再加）；历史演出：自动补
  const futureEvents = toAdd.filter(e => e.date >= today);
  const pastEvents = toAdd.filter(e => e.date < today);

  const result = { total: events.length, addedPast: pastEvents.length, future: futureEvents.length, added: [] };

  for (const ev of pastEvents) {
    const label = `${ev.name} @ ${ev.date}${ev.end ? ' → ' + ev.end : ''}`;
    if (dryRun) {
      result.added.push(label);
      continue;
    }
    const { error } = await supabase.from('concerts').insert({
      date: ev.date,
      end_date: ev.end,
      artist: ev.name,
      venue_id: VENUE_ID,
      venue_name: VENUE_NAME,
      description: '来源：高丽大化汀官方',
    });
    if (error) {
      console.error(`insert fail (${label}):`, error.message);
    } else {
      result.added.push(label);
      existingDates.add(ev.date);
    }
  }

  // 有新增时通过微信（Server酱）提醒站长；未配置 SendKey 则静默跳过
  if (!dryRun) {
    if (futureEvents.length > 0) {
      const lines = futureEvents.map(e => `• ${e.date}${e.end ? ' → ' + e.end : ''}  ${e.name}`).join('\n');
      await notify(`🆕 高丽大化汀发现 ${futureEvents.length} 场未来演出（未入库，请确认后手动添加）`, lines);
    }
    if (pastEvents.length > 0) {
      const lines = pastEvents.map(e => `• ${e.date}${e.end ? ' → ' + e.end : ''}  ${e.name}`).join('\n');
      await notify(`🎤 高丽大化汀新增 ${pastEvents.length} 场历史演出`, lines);
    }
  }

  return result;
}
