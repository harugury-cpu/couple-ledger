import type { MonthLine } from '../db/schema';
import { parseMoney } from './validation';
export function parseQuick(text: string) {
  const match = text.trim().match(/^(.+?)\s+(-?[\d,]+)$/);
  if (!match) throw new Error('“가스비 12000”처럼 항목명과 금액을 입력하세요.');
  return { name: match[1].trim(), amount: parseMoney(match[2], true)! };
}
export function quickCandidates(lines: MonthLine[], name: string) {
  const normalize = (value: string) => value.replace(/\s/g, '').toLocaleLowerCase('ko-KR');
  const query = normalize(name);
  const exact = lines.filter(l => normalize(l.name) === query);
  return exact.length ? exact : lines.filter(l => normalize(l.name).includes(query));
}
