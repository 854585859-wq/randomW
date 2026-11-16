import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { supabase } from '../lib/supabase.js';
import { notify } from '../utils/notify.js';

const execFileP = promisify(execFile);

// 奥林匹克公园官方「일정안내」自动抓取 + 同步
// 数据源：https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoListAjax.es
// 覆盖我们已有的 3 个场馆：KSPO DOME(5) / 奥林匹克大厅(6) / TICKET LINK LIVE ARENA(17)
const BASE = 'https://www.ksponco.or.kr/olympicpark/eventInfo/eventInfoListAjax.es';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const CONCURRENCY = 8;
const TRACKED_VENUE_IDS = [5, 6, 17];

// 官方场馆代码 → 我们的 venue_id（只收录已有 3 馆）
// 04 우리금융아트홀 / 05 K-아트홀 / 06 옥외·기타 / 07 뮤즈라이브 不在收录范围
// 注意：奥林匹克大厅部分条目 plcCd 为空字符串，同样归入 venue 6
const VENUE_ID_BY_PLC = { '01': 6, '': 6, '02': 5, '03': 17 };

// 抓取月份范围（YYYYMM）。默认回填 2025-01 ~ 2027-12。
function buildMonths() {
  const out = [];
  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${y}${String(m).padStart(2, '0')}`);
  }
  return out;
}

async function fetchMonth(nowYM) {
  const body = JSON.stringify({ nowYM, plcCd: '' });
  // 本机 Node 的 TLS 握手到该站点会挂起，curl 正常（与 kuhj 抓取同理）
  const { stdout } = await execFileP('curl', [
    '-4', '-s', '-L', '--max-time', '30', '--retry', '2', '-A', UA,
    '-H', 'Content-Type: application/json;charset=UTF-8',
    '-H', 'X-Requested-With: XMLHttpRequest',
    '-d', body, BASE,
  ], { maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  // 响应形如 [ [本月开演事件…], [跨月/续演事件…] ]，两段合并
  const events = [];
  if (Array.isArray(parsed)) {
    for (const part of parsed) if (Array.isArray(part)) events.push(...part);
  }
  return events;
}

export async function syncKspo({ dryRun = false } = {}) {
  const months = buildMonths();

  // 并发抓取所有月份
  const pages = [];
  for (let i = 0; i < months.length; i += CONCURRENCY) {
    const batch = months.slice(i, i + CONCURRENCY);
    pages.push(...(await Promise.all(batch.map(async (ym) => {
      try { return await fetchMonth(ym); }
      catch (e) { console.error(`fetch ${ym} failed:`, e.message); return []; }
    }))));
  }

  // 汇总：按 evtSeq 去重，只留收录场馆
  const seen = new Set();
  const events = [];
  for (const arr of pages) {
    for (const ev of arr) {
      if (!ev || !ev.beginDt || ev.delYn === 'Y') continue;
      if (seen.has(ev.evtSeq)) continue;
      const venueId = VENUE_ID_BY_PLC[String(ev.plcCd || '').trim()];
      if (!venueId) continue;
      seen.add(ev.evtSeq);
      events.push({ no: ev.evtSeq, title: ev.title, date: ev.beginDt, end: ev.endDt, venueId });
    }
  }

  // 场馆名与 venues 表保持一致
  const { data: venueRows } = await supabase.from('venues').select('id, name').in('id', TRACKED_VENUE_IDS);
  const nameById = Object.fromEntries((venueRows || []).map(v => [v.id, v.name]));

  // 现有数据去重（venue_id + 日期）
  const { data: existing } = await supabase.from('concerts').select('date, venue_id').in('venue_id', TRACKED_VENUE_IDS);
  const existingKeys = new Set((existing || []).map(c => `${c.venue_id}|${c.date}`));

  const toAdd = events.filter(e => !existingKeys.has(`${e.venueId}|${e.date}`));
  const result = { total: events.length, newCount: toAdd.length, added: [] };

  for (const ev of toAdd) {
    const name = nameById[ev.venueId] || '未知场馆';
    const endDate = ev.end && ev.end !== ev.date ? ev.end : null;
    const label = `${ev.title} @ ${ev.date}${endDate ? ' → ' + endDate : ''}（${name}）`;
    if (dryRun) { result.added.push(label); continue; }
    const { error } = await supabase.from('concerts').insert({
      date: ev.date,
      end_date: endDate,
      artist: ev.title,
      venue_id: ev.venueId,
      venue_name: name,
      description: '来源：奥林匹克公园官方',
    });
    if (error) console.error(`insert fail (${label}):`, error.message);
    else { result.added.push(label); existingKeys.add(`${ev.venueId}|${ev.date}`); }
  }

  // 有新增时通过微信（Server酱）提醒站长；未配置 SendKey 则静默跳过
  if (!dryRun && toAdd.length > 0) {
    const shown = toAdd.slice(0, 40);
    const lines = shown.map(e => `• ${e.date}${e.end && e.end !== e.date ? ' → ' + e.end : ''}  ${e.title} @ ${nameById[e.venueId] || ''}`).join('\n');
    const more = toAdd.length > 40 ? `\n…等共 ${toAdd.length} 场` : '';
    await notify(`🎤 奥林匹克公园新增 ${toAdd.length} 场演出`, lines + more);
  }

  return result;
}

// 直接运行本文件时执行（本地 dry-run / 手动同步）
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  syncKspo({ dryRun })
    .then((r) => {
      console.log(`\n[kspo] ${dryRun ? 'DRY-RUN' : '同步完成'}：官方共 ${r.total} 条，新增 ${r.newCount} 条`);
      for (const a of r.added) console.log('  +', a);
      process.exit(0);
    })
    .catch((e) => { console.error('同步失败：', e); process.exit(1); });
}
