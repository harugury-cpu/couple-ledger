import { InputError } from './input-error';
import * as z from 'zod/mini';
// 영어 기본 문구 하나만 불러온다(z.locales 전체를 참조하면 60여 개 언어가 Worker 번들에 들어가 시작 CPU가 늘어난다).
import en from 'zod/v4/locales/en.js';
// 클래식 Zod와 같은 기본 오류 문구를 사용하고, 명시한 로케일은 유지한다.
if (!z.config().localeError) z.config(en());
export const money = z.number().check(z.int(), z.minimum(0), z.maximum(1_000_000_000_000));
// 1원 이상(특별 지출 금액 등).
export const positiveMoney = z.number().check(z.int(), z.minimum(1), z.maximum(1_000_000_000_000));
export const signedMoney = z.number().check(z.int(), z.minimum(-1_000_000_000_000), z.maximum(1_000_000_000_000));
export const entryMoney = z.number().check(z.int());
export const yearValue = z.number().check(z.int(), z.minimum(1900), z.maximum(2200));
export const monthValue = z.number().check(z.int(), z.minimum(1), z.maximum(12));
export const captureDate = z.string().check(z.regex(/^(?:\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})$/, '날짜 형식을 확인하세요.'));
export const nameValue = z.string().check(z.trim(), z.minLength(1, '이름을 입력하세요.'), z.maxLength(120));
export const accountKind = z.enum(['ready', 'reserved', 'invest']);
export const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, '날짜는 YYYY-MM-DD로 입력하세요.'));
export const paymentNotificationFields = {
  notify_app: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(200)))),
  notify_keyword: z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(200)))),
  billing_kind: z.optional(z.enum(['credit', 'debit', 'transfer'])),
  cutoff_day: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(31))),
};
const savingOwnerKey = z.enum(['a', 'b', 'extra']);
// 이전 저장 형식의 저축 명의 키를 a, b로 맞춘다. p 앞이면 b, 아니면 a. 이미 a, b, extra인 값은 그대로다.
export function canonicalSavingOwner(value: unknown): unknown {
  if (value === null || (typeof value === 'string' && savingOwnerKey.safeParse(value).success)) return value;
  if (typeof value === 'string' && value.length > 0 && value.length <= 32) return value < 'p' ? 'b' : 'a';
  return value;
}
export const lineFields = z.strictObject({
  name: nameValue, section: z.enum(['fixed', 'variable', 'saving', 'income']), category_id: z.nullable(z.string()),
  payment_method_id: z.nullable(z.string()), pay_day: z.nullable(z.number().check(z.int(), z.minimum(1), z.maximum(31))), budget: money,
  input_mode: z.enum(['card', 'fixed', 'manual']), saving_owner: z.nullable(savingOwnerKey), one_off: z.boolean(),
  transfer_key: z._default(z.nullable(z.string().check(z.maxLength(128))), null),
}).check(z.superRefine((v, ctx) => {
  if ((v.section === 'saving') !== (v.saving_owner !== null)) ctx.addIssue({ code: 'custom', message: '저축 구역은 명의를 선택해야 합니다.' });
}));
export type LineFields = z.infer<typeof lineFields>;
export type LineInput = z.input<typeof lineFields>;
// 이체 계좌 이름: 비우면 묶음 없음, 보내지 않으면 기존 묶음 유지
const transferAccount = z.optional(z.nullable(z.string().check(z.trim(), z.maxLength(120))));
// 처음 적은 결제수단 이름: 있으면 그 이름의 결제수단을 찾거나 만들어 payment_method_id 대신 쓴다.
const paymentName = z.optional(nameValue);
// 배포 전부터 열려 있던 화면도 저장할 수 있도록, 요청 경계에서 이전 명의 키를 DB·백업과 같은 기준으로 바꾼다.
const commandLineFields = z.pipe(z.transform(value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const fields = value as Record<string, unknown>;
  return { ...fields, saving_owner: canonicalSavingOwner(fields.saving_owner) };
}), lineFields);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cells'), year: yearValue, month: monthValue, changes: z.array(z.strictObject({ id: z.string().check(z.minLength(1), z.maxLength(128)), col: z.number().check(z.int(), z.minimum(0), z.maximum(6)), value: z.string().check(z.maxLength(12000)) })).check(z.minLength(1), z.maxLength(512)) }),
  z.object({ type: z.literal('cell-merge'), year: yearValue, month: monthValue, ids: z.array(z.string().check(z.minLength(1), z.maxLength(128))).check(z.minLength(1), z.maxLength(512)), first_col: z.number().check(z.int(), z.minimum(0), z.maximum(7)), last_col: z.number().check(z.int(), z.minimum(0), z.maximum(7)) }),
  z.object({ type: z.literal('cell-unmerge'), ids: z.array(z.string().check(z.minLength(1), z.maxLength(128))).check(z.minLength(1), z.maxLength(512)) }),
  z.object({ type: z.literal('history'), id: z.string().check(z.minLength(1), z.maxLength(128)), direction: z.enum(['undo', 'redo']) }),
  z.object({ type: z.literal('amount'), id: z.string(), amount: z.nullable(signedMoney), future: z.optional(z.boolean()) }),
  z.object({ type: z.literal('budget'), id: z.string(), amount: money, future: z.optional(z.boolean()) }),
  z.object({ type: z.literal('create'), year: yearValue, month: monthValue, fields: commandLineFields, amount: z.optional(signedMoney), transfer_account: transferAccount, future: z.optional(z.boolean()), payment_name: paymentName }),
  z.object({ type: z.literal('update'), id: z.string(), fields: commandLineFields, future: z.optional(z.boolean()), transfer_account: transferAccount, payment_name: paymentName }),
  z.object({ type: z.literal('transfer'), id: z.string(), account: z.optional(nameValue), amount: z.optional(money), future: z.optional(z.boolean()) }),
  z.object({ type: z.literal('payment'), ids: z.array(z.string()).check(z.minLength(1), z.maxLength(200)), pay_day: z.nullable(z.number().check(z.int(), z.minimum(1), z.maximum(31))), payment_method_id: z.nullable(z.string()), future: z.optional(z.boolean()), payment_name: paymentName }),
  z.object({ type: z.literal('delete'), id: z.string(), future: z.optional(z.boolean()) }),
  // 선택한 줄(과 이체 묶음)의 지금 내용을 이후 달에도 맞춘다.
  z.object({ type: z.literal('propagate'), ids: z.array(z.string()).check(z.maxLength(200)), transfer_ids: z.array(z.string()).check(z.maxLength(50)) }),
  // 같은 구역 안에서 줄을 index 자리(그 줄을 뺀 구역 안 순서, 0부터)로 옮긴다.
  z.object({ type: z.literal('move'), id: z.string(), index: z.number().check(z.int(), z.minimum(0), z.maximum(10_000)) }),
  z.object({ type: z.literal('quick'), id: z.string(), amount: signedMoney, raw: z.string().check(z.maxLength(500)) }),
  z.object({ type: z.literal('opening'), year: yearValue, amount: signedMoney }),
  z.object({ type: z.literal('use'), year: yearValue, month: monthValue, amount: money }),
  z.object({ type: z.literal('prompt'), year: yearValue, month: monthValue }),
  z.object({ type: z.literal('special'), year: yearValue, month: monthValue, name: nameValue, amount: money.check(z.minimum(1)), funding: z.enum(['line','saving']), from_line_id: z.nullable(z.string()) }),
  z.object({ type: z.literal('special-delete'), id: z.string() }),
  z.object({ type: z.literal('category-save'), name: nameValue, id: z.optional(z.string()) }),
  z.object({ type: z.literal('category-delete'), id: z.string() }),
  z.object({ type: z.literal('payment-save'), name: nameValue, kind: z.enum(['card','account']), owner: nameValue, id: z.optional(z.string()), ...paymentNotificationFields }),
  z.object({ type: z.literal('payment-delete'), id: z.string() }),
  z.object({ type: z.literal('undo'), entry_id: z.string() }),
  z.object({ type: z.literal('account-save'), name: nameValue, kind: accountKind, target: z._default(z.nullable(money), null), id: z.optional(z.string()),
    principal: z._default(money, 0), due_on: z._default(z.nullable(isoDate), null), series: z._default(z.array(z.string().check(z.minLength(1), z.maxLength(128))).check(z.maxLength(100)), []) }),
  z.object({ type: z.literal('account-delete'), id: z.string() }),
  z.object({ type: z.literal('balance'), id: z.string(), year: yearValue, month: monthValue, amount: z.nullable(signedMoney), checked_on: z._default(z.nullable(isoDate), null) }),
]);
const capturedItem = z.strictObject({ key: z.string().check(z.minLength(1), z.maxLength(1000)), lineId: z.nullable(z.string()), amount: signedMoney,
  raw: z.string().check(z.maxLength(10000)), remember: z.boolean(), merchant: nameValue });
export const captureConfirmSchema = z.strictObject({ year: yearValue, month: monthValue, items: z.array(capturedItem).check(z.maxLength(2000)) });
export type CaptureConfirmItem = z.infer<typeof capturedItem>;
// 엑셀처럼 =로 시작하면 더하기·빼기 식의 합계로 읽는다(예: =12,000 + 8,500 - 500).
export function moneyFormula(parts: number[]) {
  return '=' + parts.map((n, i) => `${i === 0 ? (n < 0 ? '-' : '') : n < 0 ? ' - ' : ' + '}${Math.abs(n).toLocaleString('ko-KR')}`).join('');
}
export function parseMoney(text: string, signed = false): number | null {
  if (!text.trim()) return null;
  if (text.trim().startsWith('=')) {
    const formula = text.trim().slice(1).replace(/[\s,]/g, '');
    if (!/^[+-]?\d+([+-]\d+)*$/.test(formula)) throw new InputError('식은 =12000+8500 처럼 숫자를 더하거나 빼서 적으세요.');
    const value = (formula.match(/[+-]?\d+/g) ?? []).reduce((sum, term) => sum + Number(term), 0);
    (signed ? signedMoney : money).parse(value);
    return value;
  }
  const clean = text.replaceAll(',', '').trim();
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(clean)) throw new InputError('금액은 원 단위 정수로 입력하세요.');
  const value = Number(clean);
  (signed ? signedMoney : money).parse(value);
  return value;
}
