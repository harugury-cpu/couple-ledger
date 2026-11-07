// 새 달 이어받기 계획. DB에 쓰지 않는 순수 함수만 둔다.
// 화면에서 아직 만들지 않은 달을 볼 때(가상 줄)와, 실제로 그 달을 만들 때 같은 계획을 쓴다.
// 그래서 id를 (달, series)로 정해지게 만든다: 가상으로 본 줄의 id가 그대로 실제 줄의 id가 된다.
import type { Entry, LedgerMonth, MonthLine, Transfer } from './schema';
import { initialLines } from './seed';
import { sheetSections } from '../lib/sheet-grid';

export const monthIndex = (year: number, month: number) => year * 12 + month - 1;
export const fromIndex = (index: number) => ({ year: Math.floor(index / 12), month: index % 12 + 1 });
const pad = (month: number) => String(month).padStart(2, '0');
export const lineId = (year: number, month: number, series: string) => `l:${year}-${pad(month)}:${series}`;
export const transferId = (year: number, month: number, series: string) => `t:${year}-${pad(month)}:${series}`;
export const autoEntryId = (monthLineId: string) => `a:${monthLineId}`;
// 위 규칙으로 만든 id에서 달을 읽는다. 아직 없는 달의 줄·이체 계좌를 고치면 이 달을 먼저 만든다.
export function scopedMonth(id: string, kind: 'l' | 't') {
  const match = /^([lt]):(\d{4})-(\d{2}):./.exec(id);
  if (!match || match[1] !== kind) return null;
  const year = Number(match[2]); const month = Number(match[3]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}
// 자동 금액 기록 시각: 그 달 1일 0시(한국 시간). 가상으로 보일 때와 실제로 넣을 때 같은 값이 되도록 고정한다.
export const autoCreatedAt = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1) - 9 * 3600_000).toISOString();

export type MonthPlan = { month: LedgerMonth; lines: MonthLine[]; transfers: Transfer[]; entries: Entry[] };
// actuals: 전달 줄(series)마다 적힌 금액 합계. 자동 줄은 새 달에 이 금액을 이어 쓴다(기록이 없던 줄은 예산).
export type MonthBase = { lines: MonthLine[]; transfers: Transfer[]; actuals?: Map<string, number> };

// amountOf: 자동 금액. 기본은 예산, 새 달을 만들 때는 전달에 적힌 금액(planMonth)을 쓴다.
export function autoEntries(lines: MonthLine[], memberId: string, amountOf: (line: MonthLine) => number = l => l.budget): Entry[] {
  return lines.filter(l => l.input_mode === 'fixed').map(l => ({
    id: autoEntryId(l.id), month_line_id: l.id, amount: amountOf(l), source: 'auto' as const, raw_text: null,
    dedupe_key: null, created_by: memberId, created_at: autoCreatedAt(l.year, l.month),
  }));
}

// base: 직전에 실제로 있는 달의 줄·이체 계좌. 없으면 양식(seed)으로 시작한다(양식 달은 자동 금액을 넣지 않는다 — 예전과 같음).
// 자동(매달 같은 금액) 줄은 달을 만드는 순간 전달에 적힌 금액으로 채운다. 앞으로 올 달도 미리 채워 둔다.
export function planMonth(year: number, month: number, base: MonthBase | null, options: { memberId: string; categoryIds: Set<string>; methodIds: Set<string> }): MonthPlan {
  if (!base) {
    const lines = initialLines(year, month).map(l => ({
      ...l, id: lineId(year, month, l.series_id),
      category_id: l.category_id && options.categoryIds.has(l.category_id) ? l.category_id : null,
      payment_method_id: l.payment_method_id && options.methodIds.has(l.payment_method_id) ? l.payment_method_id : null,
    }));
    return { month: { year, month, special_prompt_seen: false, auto_filled: true }, lines, transfers: [], entries: [] };
  }
  const lines = base.lines.filter(l => !l.one_off).map(l => ({ ...l, id: lineId(year, month, l.series_id), year, month })).sort((a, b) => a.sort - b.sort);
  const keys = new Set(lines.map(l => l.transfer_key));
  const transfers = base.transfers.filter(t => keys.has(t.series_id)).map(t => ({ ...t, id: transferId(year, month, t.series_id), year, month }));
  return { month: { year, month, special_prompt_seen: false, auto_filled: true }, lines, transfers, entries: autoEntries(lines, options.memberId, l => base.actuals?.get(l.series_id) ?? l.budget) };
}

// 이체 묶음의 줄이 표에서 이어지도록, 묶음에 들어온 줄을 묶음의 마지막 줄 바로 아래로 옮긴 순서를 돌려준다. 옮길 필요가 없으면 그대로.
// 이체 묶음 = 같은 구역에서 표에 이어져 있고 이체 계좌 이름이 같은 줄들. 이름이 같아도 떨어져 있으면 따로 묶음이다.
// 줄을 추가·수정·이동·삭제한 뒤 그 달의 줄과 묶음을 이 규칙에 맞춘다(같은 입력이면 같은 결과).
// - 한 묶음이 여러 덩어리로 흩어졌으면 첫 덩어리가 묶음과 이체 금액을 갖고, 나머지 덩어리는 새 묶음(이체 금액 = 그 줄들의 예산 합계)이 된다.
// - 붙어 있는 이름 같은 묶음 여럿은 윗 묶음 하나로 합친다(이체 금액은 윗 묶음 값).
export function settleTransfers(year: number, month: number, rows: MonthLine[], transfers: Transfer[], newId: () => string = () => crypto.randomUUID()) {
  const byKey = new Map(transfers.map(t => [t.series_id, t]));
  const sorted = [...rows].sort((a, b) => a.sort - b.sort);
  const ordered = sheetSections.flatMap(section => sorted.filter(r => r.section === section));
  const account = (r: MonthLine) => (r.transfer_key ? byKey.get(r.transfer_key)?.account : undefined);
  const claimed = new Set<string>(); const relink: { id: string; key: string }[] = []; const created: Transfer[] = [];
  for (let i = 0; i < ordered.length;) {
    const name = account(ordered[i]);
    if (name === undefined) { i++; continue; }
    let j = i + 1;
    while (j < ordered.length && ordered[j].section === ordered[i].section && account(ordered[j]) === name) j++;
    const run = ordered.slice(i, j);
    let key = run.map(r => r.transfer_key!).find(k => !claimed.has(k));
    if (!key) {
      const transfer: Transfer = { id: newId(), year, month, series_id: newId(), account: name, amount: run.reduce((sum, r) => sum + Math.max(0, r.budget), 0) };
      created.push(transfer); key = transfer.series_id;
    }
    claimed.add(key);
    for (const r of run) if (r.transfer_key !== key) relink.push({ id: r.id, key });
    i = j;
  }
  return { relink, created, unused: transfers.filter(t => !claimed.has(t.series_id)) };
}
