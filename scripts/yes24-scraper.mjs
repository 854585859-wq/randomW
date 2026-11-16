import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { supabase } from '../lib/supabase.js';
import { notify } from '../utils/notify.js';

const execFileP = promisify(execFile);

// YES24 LIVE HALL 官方演出列表自动抓取 + 同步
// 数据源：https://yes24livehall.com/ko/show/list.php?type=1（예정）/ type=0（지난）
const LIST = 'https://yes24livehall.com/ko/show/list.php';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const VENUE_ID = 15;
const VENUE_NAME = 'YES24 LIVE HALL';
// 过去演出回填截止（早于该日期的不收）
const CUTOFF = '2025-01-01';
const MAX_PAGES_PER_TYPE = 40;

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

// 每个演出块结构：<div class="shows">…<a class="title">标题</a>…<a class="datetime">日期</a>…</div>
function parseList(html) {
  const out = [];
  const blockRe = /<div class="shows">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const dateMatch = block.match(/perform_date=(\d{8})/);
    const titleMatch = block.match(/class="title"[^>]*>([\s\S]*?)<\/a>/);
    if (!dateMatch || !titleMatch) continue;
    const d = dateMatch[1];
    const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const title = decodeHtml(titleMatch[1]);
    if (!title) continue;
    out.push({ date, title });
  }
  return out;
}

async function fetchList(type, page) {
  const url = `${LIST}?type=${type}&P=${page}`;
  const { stdout } = await execFileP('curl', [
    '-4', '-s', '-L', '--max-time', '30', '--retry', '2', '-A', UA, url,
  ], { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
}

// 抓某类（type）所有页，直到空页或超过截止日期
async function fetchType(type) {
  const events = [];
  for (let page = 1; page <= MAX_PAGES_PER_TYPE; page++) {
    let html;
    try { html = await fetchList(type, page); }
    catch (e) { console.error(`fetch ${type}/P${page} failed:`, e.message); break; }
    const parsed = parseList(html);
    if (parsed.length === 0) break;
    // 过去演出按日期升序排列，一旦早于截止日期就停止
    if (type === 0 && parsed[0].date < CUTOFF) {
      events.push(...parsed.filter(e => e.date >= CUTOFF));
      break;
    }
    events.push(...parsed);
  }
  return events;
}

export async function syncYes24({ dryRun = false } = {}) {
  // type=1 未来 + type=0 过去，按日期去重（多天演出只取首演日 perform_date）
  const upcoming = await fetchType(1);
  const past = await fetchType(0);

  const seen = new Set();
  const events = [];
  for (const ev of [...upcoming, ...past]) {
    if (seen.has(ev.date)) continue;
    seen.add(ev.date);
    events.push(ev);
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  const { data: existing } = await supabase.from('concerts').select('date').eq('venue_id', VENUE_ID);
  const existingDates = new Set((existing || []).map(c => c.date));

  const today = todayKST();
  const toAdd = events.filter(e => !existingDates.has(e.date));
  // 未来演出：只提醒、不自动入库（站长手动翻译成合适语言后再加）；历史演出：自动补
  const futureEvents = toAdd.filter(e => e.date >= today);
  const pastEvents = toAdd.filter(e => e.date < today);
  const result = { total: events.length, addedPast: pastEvents.length, future: futureEvents.length, added: [] };

  for (const ev of pastEvents) {
    const label = `${ev.title} @ ${ev.date}`;
    if (dryRun) { result.added.push(label); continue; }
    const { error } = await supabase.from('concerts').insert({
      date: ev.date,
      artist: ev.title,
      venue_id: VENUE_ID,
      venue_name: VENUE_NAME,
      description: '来源：YES24 LIVE HALL 官方',
    });
    if (error) console.error(`insert fail (${label}):`, error.message);
    else { result.added.push(label); existingDates.add(ev.date); }
  }

  if (!dryRun) {
    if (futureEvents.length > 0) {
      const shown = futureEvents.slice(0, 40);
      const lines = shown.map(e => `• ${e.date}  ${e.title}`).join('\n');
      const more = futureEvents.length > 40 ? `\n…等共 ${futureEvents.length} 场` : '';
      await notify(`🆕 YES24 LIVE HALL 发现 ${futureEvents.length} 场未来演出（未入库，请确认后手动添加）`, lines + more);
    }
    if (pastEvents.length > 0) {
      const shown = pastEvents.slice(0, 40);
      const lines = shown.map(e => `• ${e.date}  ${e.title}`).join('\n');
      const more = pastEvents.length > 40 ? `\n…等共 ${pastEvents.length} 场` : '';
      await notify(`🎤 YES24 LIVE HALL 新增 ${pastEvents.length} 场历史演出`, lines + more);
    }
  }

  return result;
}

// 直接运行本文件时执行（本地 dry-run / 手动同步）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  syncYes24({ dryRun })
    .then((r) => {
      console.log(`\n[yes24] ${dryRun ? 'DRY-RUN' : '同步完成'}：官方共 ${r.total} 条，历史新增 ${r.addedPast} 条，未来提醒 ${r.future} 条`);
      for (const a of r.added) console.log('  +', a);
      process.exit(0);
    })
    .catch((e) => { console.error('同步失败：', e); process.exit(1); });
}
