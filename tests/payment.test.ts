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
it('처음 보는 결제수단 이름은 만들 이름으로 돌려주고, 범위 밖 날짜는 이유를 알린다', () => {
  expect(parsePayment('토스', methods)).toEqual({ pay_day: null, payment_method_id: null, payment_name: '토스' });
  expect(parsePayment('8일(토스)', methods)).toEqual({ pay_day: 8, payment_method_id: null, payment_name: '토스' });
  expect(() => parsePayment('32일', methods)).toThrow('1~31일');
  expect(() => parsePayment('0일(A은행)', methods)).toThrow('1~31일');
});

it('표에 처음 적은 결제수단은 저장할 때 만들어지고, 같은 이름은 다시 만들지 않는다', async () => {
  const { Ledger } = await import('../src/db/ledger');
  const { runLedgerCommand } = await import('../src/db/ledger-command');
  const { commandSchema } = await import('../src/lib/validation');
  const l = new Ledger(':memory:');
  const run = (cmd: object) => runLedgerCommand(l, commandSchema.parse(cmd));
  const [a, b] = (await l.month(2026, 1)).filter(r => r.section === 'variable');
  await run({ type: 'payment', ids: [a.id], ...parsePayment('5일(새카드)', []) });
  const methods = (await l.snapshot(2026, 1)).paymentMethods.filter(m => m.name === '새카드');
  expect(methods).toHaveLength(1);
  expect(methods[0].kind).toBe('card');
  expect((await l.month(2026, 1)).find(r => r.id === a.id)).toMatchObject({ pay_day: 5, payment_method_id: methods[0].id });
  await run({ type: 'payment', ids: [b.id], ...parsePayment('새카드', []) });
  expect((await l.snapshot(2026, 1)).paymentMethods.filter(m => m.name === '새카드')).toHaveLength(1);
  expect((await l.month(2026, 1)).find(r => r.id === b.id)?.payment_method_id).toBe(methods[0].id);
});
