import { z } from 'zod';
import type { MatchRule, MonthLine, PaymentMethod } from '../db/schema';
import { lineNameWithoutParentheses, normalizeCaptureMerchant } from './capture-match';
import { monthValue, signedMoney, yearValue } from './validation';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, '유효한 결제일이 아닙니다.');
export const notificationTransactionSchema = z.object({
  date: dateSchema, merchant: z.string().trim().min(1).max(120), amount: signedMoney.refine(value => value !== 0),
}).strict();
// 알 수 없는 키는 Zod가 제거한다. 원문 공백은 보존한다.
export const notificationSchema = z.object({ app: z.string().min(1).max(200), title: z.string().max(2000), text: z.string().min(1).max(8000) });
export const notificationSettingsSchema = z.object({
  notify_app: z.string().trim().max(200).nullable().default(null),
  notify_keyword: z.string().trim().max(200).nullable().default(null),
  billing_kind: z.enum(['credit', 'debit', 'transfer']).default('debit'),
  cutoff_day: z.number().int().min(1).max(31).default(31),
});
export const notificationConfirmSchema = z.object({
  type: z.literal('save'), id: z.string().min(1).max(128), transaction: notificationTransactionSchema,
  lineId: z.string().min(1).max(128), paymentMethodId: z.string().min(1).max(128).nullable(), remember: z.boolean(),
}).strict();
export const notificationActionSchema = z.discriminatedUnion('type', [
  notificationConfirmSchema,
  z.object({ type: z.literal('discard'), id: z.string().min(1).max(128) }).strict(),
  z.object({ type: z.literal('undo'), id: z.string().min(1).max(128) }).strict(),
]);
export type NotificationInput = z.infer<typeof notificationSchema>;
export type NotificationTransaction = z.infer<typeof notificationTransactionSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type NotificationBilling = Pick<NotificationSettings, 'billing_kind' | 'cutoff_day'>;
export type IngestResult = { status: 'saved' | 'review' | 'duplicate' | 'ignored'; lineName?: string };
export const DUPLICATE_WINDOW_MS = 3 * 60_000;

export function notificationRaw(input: NotificationInput) { return [input.title, input.text].filter(Boolean).join('\n'); }
export function seoulDate(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}
export function notificationMonth(date: string, billing: NotificationBilling) {
  const [year, month, day] = date.split('-').map(Number);
  const offset = billing.billing_kind === 'credit' ? 1 + (day > billing.cutoff_day ? 1 : 0) : 0;
  const index = year * 12 + month - 1 + offset;
  return { year: yearValue.parse(Math.floor(index / 12)), month: monthValue.parse(index % 12 + 1) };
}
export function identifyNotificationMethods(input: NotificationInput, methods: PaymentMethod[]) {
  const app = normalizeCaptureMerchant(input.app); const raw = normalizeCaptureMerchant(notificationRaw(input));
  return methods.filter(method => method.notify_app?.trim() && app.includes(normalizeCaptureMerchant(method.notify_app)) &&
    (!method.notify_keyword?.trim() || raw.includes(normalizeCaptureMerchant(method.notify_keyword))));
}

// 문장 형식을 확정할 수 있는 경우만 자동 저장한다. 낯선 형식은 원문과 읽은 일부 값을 남긴다.
export function readNotification(raw: string, receivedAt: string) {
  const normalized = raw.normalize('NFKC').replaceAll('\u2212', '-');
  const lines = normalized.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const receivedDate = seoulDate(new Date(receivedAt));
  const stamps = [...normalized.matchAll(/(?:^|\s)(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})(?=\s|$)/gm)];
  let date: string | null = receivedDate;
  if (stamps.length > 1) date = null;
  else if (stamps.length === 1) {
    const stamp = stamps[0];
    let year = stamp[1] ? Number(stamp[1]) : Number(receivedDate.slice(0, 4));
    if (!stamp[1] && receivedDate.slice(5, 7) === '01' && Number(stamp[2]) === 12) year--;
    const candidate = `${year}-${stamp[2].padStart(2, '0')}-${stamp[3].padStart(2, '0')}`;
    date = dateSchema.safeParse(candidate).success ? candidate : null;
  }
  const amountLines = lines.filter(line => !/(누적|잔액|한도|합계|청구|예정)/.test(line));
  const amounts = amountLines.flatMap(line => [...line.matchAll(/(?:^|[^\d,])(-?(?:\d{1,3}(?:,\d{3})+|\d+))\s*원/g)]);
  const writtenAmount = amounts.length === 1 ? Number(amounts[0][1].replaceAll(',', '')) : null;
  const value = writtenAmount !== null ? (/취소/.test(normalized) ? -Math.abs(writtenAmount) : writtenAmount) : null;
  const amount = value !== null && signedMoney.safeParse(value).success && value !== 0 ? value : null;
  const merchantLines = lines.filter(line => !/\d[\d,]*\s*원/.test(line) &&
    !/(카드|승인|결제|취소|누적|잔액|한도|일시불|할부|님|\[web발신\])/i.test(line) &&
    !/\d{1,2}[-/.]\d{1,2}|\d{1,2}:\d{2}/.test(line));
  const merchant = merchantLines.length === 1 && merchantLines[0].length <= 120 ? merchantLines[0] : null;
  const parsed = notificationTransactionSchema.safeParse({ date, merchant, amount });
  const transaction = /(승인|결제|취소)/.test(normalized) && parsed.success ? parsed.data : null;
  // 날짜와 함께 적힌 승인 시각만 식별값으로 쓴다. 누적 안내의 시각은 사용하지 않는다.
  const timeMatches = stamps.length === 1 ? [...normalized.matchAll(/(?:\d{1,2}[-/.]\d{1,2})\s+([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(?=\s|$)/g)] : [];
  const time = timeMatches.length === 1 ? `${timeMatches[0][1].padStart(2, '0')}:${timeMatches[0][2]}:${timeMatches[0][3] ?? '00'}` : null;
  return { date, merchant, amount, transaction, time };
}
export function parseNotification(raw: string, receivedAt: string) { return readNotification(raw, receivedAt).transaction; }

// 명세서 맞춰보기와 같은 지식(가맹점 규칙 → 줄 이름)으로 그 카드의 줄을 찾는다.
// 명세서에서 기억한 규칙(카드 없음)도 쓴다. "매달 같은 금액" 줄은 새 달에 이미 채워지므로 넣지 않는다.
export function matchNotification(transaction: NotificationTransaction, paymentMethodId: string, lines: MonthLine[], rules: MatchRule[]) {
  const eligible = lines.filter(line => ['fixed', 'variable'].includes(line.section) && line.input_mode !== 'fixed' &&
    line.payment_method_id === paymentMethodId && !line.series_id.startsWith('special:'));
  const merchant = normalizeCaptureMerchant(transaction.merchant);
  const matches = rules.filter(rule => (rule.payment_method_id === paymentMethodId || rule.payment_method_id === null) &&
    eligible.some(line => line.series_id === rule.series_id));
  const only = (targets: MonthLine[]) => targets.length === 1 ? targets[0] : null;
  const keywordIds = new Set(matches.filter(rule => rule.keyword && merchant.includes(normalizeCaptureMerchant(rule.keyword))).map(rule => rule.series_id));
  if (keywordIds.size) return only(eligible.filter(line => keywordIds.has(line.series_id)));
  const byName = eligible.filter(line => {
    const name = normalizeCaptureMerchant(lineNameWithoutParentheses(line.name));
    return !!name && (merchant.includes(name) || name.includes(merchant));
  });
  if (byName.length) return only(byName);
  const cardIds = new Set(matches.filter(rule => rule.keyword === null && rule.payment_method_id === paymentMethodId).map(rule => rule.series_id));
  return only(eligible.filter(line => cardIds.has(line.series_id)));
}
export async function notificationHash(values: unknown[]) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function notificationKeys(input: NotificationInput, methodId: string | null, receivedAt: string) {
  const raw = notificationRaw(input); const read = readNotification(raw, receivedAt);
  const fingerprint = await notificationHash([normalizeCaptureMerchant(input.app), normalizeCaptureMerchant(raw)]);
  const approvalKey = read.transaction && read.time ? await notificationHash([
    normalizeCaptureMerchant(input.app), methodId, read.transaction.date, read.time,
    normalizeCaptureMerchant(read.transaction.merchant), read.transaction.amount,
  ]) : null;
  return { fingerprint, approvalKey, read };
}

export async function authorizedIngest(headers: Headers, token: string | undefined) {
  if (!token || token.length < 32) return false;
  const supplied = headers.get('authorization')?.replace(/^Bearer /, '');
  if (!supplied || supplied.length > 512) return false;
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [expected, actual] = await Promise.all([hash(token), hash(supplied)]);
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i] ^ actual[i];
  return difference === 0;
}
