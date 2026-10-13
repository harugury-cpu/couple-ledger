import { initialLines } from '../src/db/seed';
import type { Entry } from '../src/db/schema';
export function januaryFixture() {
  const lines = initialLines(2026, 1);
  const fixed: Record<string, number> = { '종합 보험': 200, '가스비': 300, '인터넷': 100, '휴대폰 A': 200, '휴대폰 B': 0, '관리비': 0, 'OTT 구독': 200, '쇼핑 멤버십': 300, '개인 고정 지출': 100, '대출 이자': 200, '멤버십': 300 };
  const entries: Entry[] = lines.map(l => ({ id: crypto.randomUUID(), month_line_id: l.id,
    amount: l.section === 'fixed' ? fixed[l.name] ?? 0 : l.section === 'saving' ? l.name === '추가 저축' ? 0 : 100 : l.section === 'income' ? l.name === '보너스' ? 100 : l.pay_day === 10 ? 100000 : 6000 : ({ '용돈 A': 1500, '용돈 B': 2000, '생활비': 100000, '비상금': 0 }[l.name] ?? 0),
    source: 'manual', raw_text: null, dedupe_key: null, created_by: 'local-owner', created_at: '2026-01-01T00:00:00.000Z' }));
  return { lines, entries };
}
