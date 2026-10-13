import type { Entry, MatchRule } from '../db/schema';
import type { ComputedLine } from './calculations';
import type { CaptureReadItem } from './capture-read';

export type CaptureMatchItem = CaptureReadItem & { key: string; lineId: string | null; duplicate: boolean };

export function normalizeCaptureMerchant(merchant: string) {
  return merchant.normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase('ko-KR');
}

function normalizedText(value: string) { return normalizeCaptureMerchant(value); }

export function lineNameWithoutParentheses(name: string) {
  return name.replace(/\([^)]*\)/g, '').trim();
}

export function captureDedupeKey(year: number, month: number, date: string, merchant: string, amount: number, occurrence: number) {
  return `capture:${year}-${month}:${date.trim()}:${normalizeCaptureMerchant(merchant)}:${amount}:${occurrence}`;
}

function findLine(merchant: string, lines: ComputedLine[], rules: MatchRule[]) {
  const merchantText = normalizedText(merchant);
  const bySeries = new Map(lines.map(line => [line.series_id, line]));
  const rule = rules.find(candidate => candidate.keyword && merchantText.includes(normalizedText(candidate.keyword)) && bySeries.has(candidate.series_id));
  if (rule) return bySeries.get(rule.series_id) ?? null;
  return lines.find(line => {
    const name = normalizedText(lineNameWithoutParentheses(line.name));
    return !!name && (merchantText.includes(name) || name.includes(merchantText));
  }) ?? null;
}

export function matchCaptureItems(items: CaptureReadItem[], lines: ComputedLine[], rules: MatchRule[], entries: Entry[], year: number, month: number): CaptureMatchItem[] {
  const occurrences = new Map<string, number>();
  const existing = new Set(entries.map(entry => entry.dedupe_key).filter((key): key is string => !!key));
  return items.map(item => {
    const tuple = `${item.date.trim()}\u0000${normalizeCaptureMerchant(item.merchant)}\u0000${item.amount}`;
    const occurrence = occurrences.get(tuple) ?? 0;
    occurrences.set(tuple, occurrence + 1);
    const key = captureDedupeKey(year, month, item.date, item.merchant, item.amount, occurrence);
    const line = findLine(item.merchant, lines, rules);
    return { ...item, key, lineId: line?.id ?? null, duplicate: existing.has(key) };
  });
}

export const matchCaptures = matchCaptureItems;
