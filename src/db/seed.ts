import type { MonthLine } from './schema';
export const categoryNames = ['고정비', '용돈 A', '용돈 B', '생활비', '비상금', '차량', '저축'];
export const paymentNames = ['카드', '이체', 'A은행', 'B은행', 'C은행', 'D은행', 'E은행', '은행', '계좌'];
export function initialLines(year: number, month: number): MonthLine[] {
  const rows: [string, MonthLine['section'], string | null, number | null, string | null, MonthLine['saving_owner']][] = [
    ['쇼핑 멤버십', 'fixed', '고정비', 1, '카드', null], ['OTT 구독', 'fixed', '고정비', 5, '카드', null],
    ['가전 구독', 'fixed', '고정비', 10, '카드', null], ['종합 보험', 'fixed', '고정비', 10, '카드', null],
    ['가스비', 'fixed', '고정비', 12, '카드', null], ['인터넷', 'fixed', '고정비', 15, '카드', null],
    ['휴대폰 A', 'fixed', '고정비', 20, '카드', null], ['휴대폰 B', 'fixed', '고정비', 20, '카드', null],
    ['AI 구독', 'fixed', '고정비', 25, '카드', null], ['관리비', 'fixed', '고정비', 25, '카드', null],
    ['기타', 'fixed', '고정비', null, '카드', null], ['개인 고정 지출', 'fixed', '고정비', 3, '이체', null],
    ['대출 이자', 'fixed', '고정비', 8, 'A은행', null], ['실비 보험', 'fixed', '고정비', 12, 'A은행', null],
    ['멤버십', 'fixed', '고정비', 18, 'A은행', null],
    ['용돈 A', 'variable', '용돈 A', 1, 'B은행', null], ['용돈 B', 'variable', '용돈 B', 1, 'C은행', null],
    ['생활비', 'variable', '생활비', 1, 'D은행', null], ['비상금', 'variable', '비상금', 10, 'E은행', null],
    ...Array.from({ length: 6 }, (_, i): typeof rows[number] => [`저축 ${i + 1}`, 'saving', '저축', i < 3 ? 5 : 20, i < 3 ? '은행' : '계좌', [0, 3, 4, 5].includes(i) ? 'a' : 'b']),
    ['추가 저축', 'saving', '저축', null, null, 'extra'],
    ['월급', 'income', null, 10, null, null], ['월급', 'income', null, 25, null, null], ['보너스', 'income', null, null, null, null],
  ];
  return rows.map(([name, section, category, pay_day, payment, saving_owner], sort) => ({
    id: crypto.randomUUID(), year, month, series_id: `initial-${sort}`, section, name,
    category_id: category ? `category-${categoryNames.indexOf(category)}` : null,
    payment_method_id: payment ? `payment-${paymentNames.indexOf(payment)}` : null,
    pay_day, budget: 0, input_mode: section === 'saving' || name.startsWith('용돈') ? 'fixed' : 'manual',
    saving_owner, one_off: false, sort, transfer_key: null,
  }));
}
