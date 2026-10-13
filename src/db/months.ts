// 새 달 이어받기 계획. DB에 쓰지 않는 순수 함수만 둔다.
// 화면에서 아직 만들지 않은 달을 볼 때(가상 줄)와, 실제로 그 달을 만들 때 같은 계획을 쓴다.
// 그래서 id를 (달, series)로 정해지게 만든다: 가상으로 본 줄의 id가 그대로 실제 줄의 id가 된다.
import type { Entry, LedgerMonth, MonthLine, Transfer } from './schema';
import { initialLines } from './seed';

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
export type MonthBase = { lines: MonthLine[]; transfers: Transfer[] };

export function autoEntries(lines: MonthLine[], memberId: string): Entry[] {
  return lines.filter(l => l.input_mode === 'fixed').map(l => ({
    id: autoEntryId(l.id), month_line_id: l.id, amount: l.budget, source: 'auto' as const, raw_text: null,
    dedupe_key: null, created_by: memberId, created_at: autoCreatedAt(l.year, l.month),
  }));
}

// base: 직전에 실제로 있는 달의 줄·이체 계좌. 없으면 양식(seed)으로 시작한다(양식 달은 자동 금액을 넣지 않는다 — 예전과 같음).
// due: 그 달이 이번 달이거나 지난 달이면 true. 앞으로 올 달은 자동 금액을 미리 넣지 않는다.
export function planMonth(year: number, month: number, base: MonthBase | null, options: { due: boolean; memberId: string; categoryIds: Set<string>; methodIds: Set<string> }): MonthPlan {
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
  const entries = options.due ? autoEntries(lines, options.memberId) : [];
  return { month: { year, month, special_prompt_seen: false, auto_filled: options.due }, lines, transfers, entries };
}

// 이체 묶음의 줄이 표에서 이어지도록, 묶음에 들어온 줄을 묶음의 마지막 줄 바로 아래로 옮긴 순서를 돌려준다. 옮길 필요가 없으면 그대로.
export function placeWithTransfer<T extends Pick<MonthLine, 'id' | 'section' | 'transfer_key'>>(rows: T[], lineIdToPlace: string): T[] {
  const at = rows.findIndex(r => r.id === lineIdToPlace);
  const line = rows[at];
  if (!line?.transfer_key) return rows;
  const sameGroup = (r?: T) => !!r && r.section === line.section && r.transfer_key === line.transfer_key;
  if (sameGroup(rows[at - 1]) || sameGroup(rows[at + 1])) return rows;
  const others = rows.filter(r => r.id !== line.id);
  let last = -1;
  others.forEach((r, i) => { if (sameGroup(r)) last = i; });
  if (last < 0) return rows;
  others.splice(last + 1, 0, line);
  return others;
}
