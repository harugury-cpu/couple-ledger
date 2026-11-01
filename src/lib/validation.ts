import { InputError } from './input-error';
import { z } from 'zod';
export const money = z.number().int().min(0).max(1_000_000_000_000);
export const signedMoney = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const entryMoney = z.number().int();
export const yearValue = z.number().int().min(1900).max(2200);
export const monthValue = z.number().int().min(1).max(12);
export const captureDate = z.string().regex(/^(?:\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})$/, '날짜 형식을 확인하세요.');
export const nameValue = z.string().trim().min(1, '이름을 입력하세요.').max(120);
export const accountKind = z.enum(['ready', 'reserved', 'invest']);
export const paymentNotificationFields = {
  notify_app: z.string().trim().max(200).nullable().optional(),
  notify_keyword: z.string().trim().max(200).nullable().optional(),
  billing_kind: z.enum(['credit', 'debit', 'transfer']).optional(),
  cutoff_day: z.number().int().min(1).max(31).optional(),
};
const savingOwnerKey = z.enum(['a', 'b', 'extra']);
// 이전 저장 형식의 저축 명의 키를 a, b로 맞춘다. p 앞이면 b, 아니면 a. 이미 a, b, extra인 값은 그대로다.
export function canonicalSavingOwner(value: unknown): unknown {
  if (value === null || (typeof value === 'string' && savingOwnerKey.safeParse(value).success)) return value;
  if (typeof value === 'string' && value.length > 0 && value.length <= 32) return value < 'p' ? 'b' : 'a';
  return value;
}
export const lineFields = z.object({
  name: nameValue, section: z.enum(['fixed', 'variable', 'saving', 'income']), category_id: z.string().nullable(),
  payment_method_id: z.string().nullable(), pay_day: z.number().int().min(1).max(31).nullable(), budget: money,
  input_mode: z.enum(['card', 'fixed', 'manual']), saving_owner: savingOwnerKey.nullable(), one_off: z.boolean(),
  transfer_key: z.string().max(128).nullable().default(null),
}).strict().superRefine((v, ctx) => {
  if ((v.section === 'saving') !== (v.saving_owner !== null)) ctx.addIssue({ code: 'custom', message: '저축 구역은 명의를 선택해야 합니다.' });
});
export type LineFields = z.infer<typeof lineFields>;
export type LineInput = z.input<typeof lineFields>;
// 이체 계좌 이름: 비우면 묶음 없음, 보내지 않으면 기존 묶음 유지
const transferAccount = z.string().trim().max(120).nullable().optional();
// 처음 적은 결제수단 이름: 있으면 그 이름의 결제수단을 찾거나 만들어 payment_method_id 대신 쓴다.
const paymentName = nameValue.optional();
// 배포 전부터 열려 있던 화면도 저장할 수 있도록, 요청 경계에서 이전 명의 키를 DB·백업과 같은 기준으로 바꾼다.
const commandLineFields = z.preprocess(value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const fields = value as Record<string, unknown>;
  return { ...fields, saving_owner: canonicalSavingOwner(fields.saving_owner) };
}, lineFields);
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cells'), year: yearValue, month: monthValue, changes: z.array(z.object({ id: z.string().min(1).max(128), col: z.number().int().min(0).max(6), value: z.string().max(12000) }).strict()).min(1).max(512) }),
  z.object({ type: z.literal('cell-merge'), year: yearValue, month: monthValue, ids: z.array(z.string().min(1).max(128)).min(1).max(512), first_col: z.number().int().min(0).max(7), last_col: z.number().int().min(0).max(7) }),
  z.object({ type: z.literal('cell-unmerge'), ids: z.array(z.string().min(1).max(128)).min(1).max(512) }),
  z.object({ type: z.literal('history'), id: z.string().min(1).max(128), direction: z.enum(['undo', 'redo']) }),
  z.object({ type: z.literal('amount'), id: z.string(), amount: signedMoney.nullable(), future: z.boolean().optional() }),
  z.object({ type: z.literal('budget'), id: z.string(), amount: money, future: z.boolean().optional() }),
  z.object({ type: z.literal('create'), year: yearValue, month: monthValue, fields: commandLineFields, amount: signedMoney.optional(), transfer_account: transferAccount, future: z.boolean().optional(), payment_name: paymentName }),
  z.object({ type: z.literal('update'), id: z.string(), fields: commandLineFields, future: z.boolean().optional(), transfer_account: transferAccount, payment_name: paymentName }),
  z.object({ type: z.literal('transfer'), id: z.string(), account: nameValue.optional(), amount: money.optional(), future: z.boolean().optional() }),
  z.object({ type: z.literal('payment'), ids: z.array(z.string()).min(1).max(200), pay_day: z.number().int().min(1).max(31).nullable(), payment_method_id: z.string().nullable(), future: z.boolean().optional(), payment_name: paymentName }),
  z.object({ type: z.literal('delete'), id: z.string(), future: z.boolean().optional() }),
  // 같은 구역 안에서 줄을 index 자리(그 줄을 뺀 구역 안 순서, 0부터)로 옮긴다.
  z.object({ type: z.literal('move'), id: z.string(), index: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal('quick'), id: z.string(), amount: signedMoney, raw: z.string().max(500) }),
  z.object({ type: z.literal('opening'), year: yearValue, amount: signedMoney }),
  z.object({ type: z.literal('use'), year: yearValue, month: monthValue, amount: money }),
  z.object({ type: z.literal('prompt'), year: yearValue, month: monthValue }),
  z.object({ type: z.literal('special'), year: yearValue, month: monthValue, name: nameValue, amount: money.min(1), funding: z.enum(['line','saving']), from_line_id: z.string().nullable() }),
  z.object({ type: z.literal('special-delete'), id: z.string() }),
  z.object({ type: z.literal('category-save'), name: nameValue, id: z.string().optional() }),
  z.object({ type: z.literal('category-delete'), id: z.string() }),
  z.object({ type: z.literal('payment-save'), name: nameValue, kind: z.enum(['card','account']), owner: nameValue, id: z.string().optional(), ...paymentNotificationFields }),
  z.object({ type: z.literal('payment-delete'), id: z.string() }),
  z.object({ type: z.literal('undo'), entry_id: z.string() }),
  z.object({ type: z.literal('account-save'), name: nameValue, kind: accountKind, target: money.nullable(), id: z.string().optional() }),
  z.object({ type: z.literal('account-delete'), id: z.string() }),
  z.object({ type: z.literal('balance'), id: z.string(), year: yearValue, month: monthValue, amount: signedMoney.nullable() }),
]);
const capturedItem = z.object({ key: z.string().min(1).max(1000), lineId: z.string().nullable(), amount: signedMoney,
  raw: z.string().max(10000), remember: z.boolean(), merchant: nameValue }).strict();
export const captureConfirmSchema = z.object({ year: yearValue, month: monthValue, items: z.array(capturedItem).max(2000) }).strict();
export type CaptureConfirmItem = z.infer<typeof capturedItem>;
export function parseMoney(text: string, signed = false): number | null {
  if (!text.trim()) return null;
  const clean = text.replaceAll(',', '').trim();
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(clean)) throw new InputError('금액은 원 단위 정수로 입력하세요.');
  const value = Number(clean);
  (signed ? signedMoney : money).parse(value);
  return value;
}
