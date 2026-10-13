// 공유용 데모 가계부: 실제 앱 로직(LedgerCore)을 브라우저 메모리 안의 SQLite에 띄우고 예시 데이터로 채운다.
// 실제 가계부(D1)와는 아무 연결이 없다. 이름·금액은 모두 만든 예시이고, 새로고침하면 처음 상태로 돌아간다.
import type { Database } from 'sql.js';
import { LedgerCore } from '../db/ledger-core';
import { runLedgerCommand } from '../db/ledger-command';
import { SqlJsStore, type Migration } from '../db/store-sqljs';
import { commandSchema, yearValue, monthValue } from '../lib/validation';

// 양식 줄(series_id) → 데모에 보일 이름과 예산
const lines: Record<string, [string, number]> = {
  'initial-0': ['쇼핑 멤버십', 7_890], 'initial-1': ['OTT 구독', 13_500], 'initial-2': ['가전 구독', 39_900],
  'initial-3': ['종합 보험', 98_000], 'initial-4': ['가스비', 45_000], 'initial-5': ['인터넷', 33_000],
  'initial-6': ['휴대폰 A', 55_000], 'initial-7': ['휴대폰 B', 49_000], 'initial-8': ['AI 구독', 29_000],
  'initial-9': ['관리비', 230_000], 'initial-10': ['기타', 30_000], 'initial-11': ['개인 고정 지출', 120_000],
  'initial-12': ['대출 이자', 410_000], 'initial-13': ['실비 보험', 42_000], 'initial-14': ['멤버십', 4_900],
  'initial-15': ['용돈 A', 400_000], 'initial-16': ['용돈 B', 400_000], 'initial-17': ['생활비', 900_000],
  'initial-18': ['비상금', 300_000],
  'initial-19': ['저축 1', 500_000], 'initial-20': ['저축 2', 300_000], 'initial-21': ['저축 3', 200_000],
  'initial-22': ['저축 4', 300_000], 'initial-23': ['저축 5', 100_000], 'initial-24': ['저축 6', 100_000],
  'initial-25': ['추가 저축', 0], 'initial-26': ['월급', 3_200_000], 'initial-27': ['월급', 2_900_000], 'initial-28': ['보너스', 0],
};
// 쓴 만큼 달마다 달라지는 줄(나머지는 예산 그대로 나간다)
const varying = new Set(['initial-4', 'initial-9', 'initial-10', 'initial-17', 'initial-18']);
const categories = { 'category-1': '용돈 A', 'category-2': '용돈 B' };
const payments: Record<string, string> = { 'payment-2': 'A은행', 'payment-3': 'B은행', 'payment-4': 'C은행', 'payment-5': 'D은행', 'payment-6': 'E은행' };
const accounts: [string, 'ready' | 'reserved' | 'invest', number | null, number, number][] = [
  // 이름, 종류, 목표, 1월 잔액, 달마다 늘어나는 금액
  ['비상금 통장', 'ready', 3_000_000, 1_800_000, 90_000],
  ['여행 모으기', 'reserved', 2_000_000, 400_000, 150_000],
  ['적금', 'invest', null, 6_000_000, 500_000],
  ['주식', 'invest', null, 4_200_000, 180_000],
];

// 같은 줄·같은 달이면 늘 같은 값이 나오는 0~1 사이 수
function wobble(key: string) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
const round = (n: number) => Math.round(n / 100) * 100;

function amountFor(series: string, budget: number, month: number) {
  if (series === 'initial-28') return month === 2 ? 1_500_000 : null; // 보너스는 2월에만
  if (series === 'initial-25') return month % 3 === 0 ? 200_000 : null; // 추가 저축은 분기마다
  if (!varying.has(series)) return budget;
  return round(budget * (0.75 + wobble(`${series}-${month}`) * 0.45));
}

export async function seedDemo(core: LedgerCore, today: { year: number; month: number; day: number }) {
  const { year } = today;
  await core.init();
  for (const [id, name] of Object.entries(categories)) await core.saveCategory(name, id);
  for (const [id, name] of Object.entries(payments)) await core.savePayment(name, 'account', '공통', id);

  // 1월: 양식 줄을 데모 이름·예산으로 바꾼다. 이후 달은 이 달을 이어받는다.
  const january = await core.snapshot(year, 1);
  for (const line of january.lines.filter(l => l.month === 1)) {
    const [name, budget] = lines[line.series_id] ?? [line.name, line.budget];
    const { id: _id, year: _y, month: _m, series_id: _s, sort: _o, ...fields } = line;
    await core.updateLine(line.id, { ...fields, name, budget });
  }

  for (let month = 1; month <= today.month; month++) {
    const snapshot = await core.snapshot(year, month);
    for (const line of snapshot.lines.filter(l => l.month === month)) {
      // 이번 달은 결제일이 지난 줄까지만 채워 미입력 줄도 보이게 한다.
      if (month === today.month && (line.pay_day === null || line.pay_day > today.day)) continue;
      const amount = amountFor(line.series_id, line.budget, month);
      if (amount !== null) await core.setAmount(line.id, amount);
    }
  }

  await core.setOpening(year, 12_000_000);
  if (today.month > 1) await core.addSpecial(year, today.month - 1, '가족 여행', 600_000, 'saving', null);
  for (const [name, kind, target] of accounts) await core.saveAccount(name, kind, target);
  const saved = (await core.snapshot(year, today.month)).accounts;
  for (const [name, , , start, step] of accounts) {
    const account = saved.find(a => a.name === name)!;
    for (let month = 1; month <= today.month; month++) await core.setBalance(account.id, year, month, start + step * (month - 1));
  }
}

// now 기준 한국 날짜. 데모는 늘 "올해 1월 ~ 오늘"을 채운 모습으로 시작한다.
function seoulDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
  const part = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

export async function createDemoLedger(client: Database, migrations: Migration[], now = new Date()) {
  const today = seoulDate(now);
  const core = new LedgerCore(new SqlJsStore(client, migrations), { today: () => ({ year: today.year, month: today.month }) });
  await seedDemo(core, today);
  return core;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 화면의 /api/ledger 요청을 브라우저 안 가계부가 받는다. 서버로 나가야 하는 기능(명세서 읽기·알림·백업)은 데모에서 막는다.
export async function handleDemoRequest(core: LedgerCore, url: URL, init?: RequestInit): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/')) return null;
  if (url.pathname !== '/api/ledger') return json({ error: '데모에서는 쓸 수 없는 기능입니다.' }, 400);
  if ((init?.method ?? 'GET').toUpperCase() === 'GET') {
    try { return json(await core.snapshot(yearValue.parse(Number(url.searchParams.get('year'))), monthValue.parse(Number(url.searchParams.get('month'))))); }
    catch { return json({ error: '월 데이터를 불러오지 못했습니다. 연도와 월을 확인하세요.' }, 400); }
  }
  try {
    const entry_id = await runLedgerCommand(core, commandSchema.parse(JSON.parse(String(init?.body))));
    return json({ ok: true, entry_id });
  } catch (error) {
    return json({ error: error instanceof Error && !('issues' in error) ? error.message : '입력값을 확인하세요. 금액은 원 단위 정수입니다.' }, 400);
  }
}
