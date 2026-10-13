import { expect, it } from 'vitest';
import { parsePayment } from '../src/lib/payment';
const methods = [{ id: 'k', name: 'A은행' }, { id: 's', name: '생활카드' }, { id: 'd', name: '10일' }];
it('수단 글자를 결제일과 결제수단으로 읽는다', () => {
  expect(parsePayment('8일(A은행)', methods)).toEqual({ pay_day: 8, payment_method_id: 'k' });
  expect(parsePayment(' 생활카드 ', methods)).toEqual({ pay_day: null, payment_method_id: 's' });
  expect(parsePayment('7일', methods)).toEqual({ pay_day: 7, payment_method_id: null });
  expect(parsePayment('20', methods)).toEqual({ pay_day: 20, payment_method_id: null });
  expect(parsePayment('', methods)).toEqual({ pay_day: null, payment_method_id: null });
});
it('결제수단 이름이 날짜처럼 생겨도 이름이 먼저다', () => {
  expect(parsePayment('10일', methods)).toEqual({ pay_day: null, payment_method_id: 'd' });
});
it('없는 결제수단과 범위 밖 날짜는 이유를 알린다', () => {
  expect(() => parsePayment('토스', methods)).toThrow('결제수단이 없습니다');
  expect(() => parsePayment('8일(토스)', methods)).toThrow('결제수단이 없습니다');
  expect(() => parsePayment('32일', methods)).toThrow('1~31일');
  expect(() => parsePayment('0일(A은행)', methods)).toThrow('1~31일');
});
