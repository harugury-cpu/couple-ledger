import { z } from 'zod';
import { computeLines, monthTotals, savingsRows } from './calculations';
import { accountKind, canonicalSavingOwner, lineFields, money, signedMoney, entryMoney, nameValue, yearValue, monthValue } from './validation';
import { notificationSchema, notificationSettingsSchema, notificationTransactionSchema } from './notification';
const id = z.string().min(1).max(128);
const sort = z.number().int().min(0).max(1000000);
const date = z.iso.datetime();
const ym = { year: yearValue, month: monthValue };
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(100000);
export const archiveSchema = z.object({
  app: z.literal('couple-ledger'), version: z.literal(1), exported_at: date,
  data: z.object({
    members: rows(z.object({ id, email: z.string().max(320), name: nameValue, role: z.enum(['owner', 'member']) }).strict()).min(1),
    invites: rows(z.object({ id, email: z.string().max(320), token: z.string().min(1).max(500), expires_at: date, accepted_at: date.nullable() }).strict()),
    categories: rows(z.object({ id, name: nameValue, sort }).strict()),
    payment_methods: rows(z.object({ id, name: nameValue, kind: z.enum(['card', 'account']), owner: nameValue, ...notificationSettingsSchema.shape }).strict()),
    month_lines: rows(lineFields.safeExtend({ id, ...ym, category_id: id.nullable(), payment_method_id: id.nullable(), series_id: id, sort })),
    entries: rows(z.object({ id, month_line_id: id, amount: entryMoney, source: z.enum(['manual', 'quick', 'auto', 'paste', 'notification', 'capture']), raw_text: z.string().max(12000).nullable(), dedupe_key: z.string().max(1000).nullable().optional().default(null), created_by: id, created_at: date }).strict()),
    budget_adjustments: rows(z.object({ id, month_line_id: id, amount: signedMoney, special_expense_id: id.nullable() }).strict()),
    special_expenses: rows(z.object({ id, ...ym, name: nameValue, amount: money.min(1), funding: z.enum(['line','saving']), from_line_id: id.nullable(), calendar_event_id: id.nullable() }).strict()),
    saving_years: rows(z.object({ year: yearValue, opening_balance: signedMoney }).strict()),
    saving_uses: rows(z.object({ id, ...ym, amount: money, memo: z.string().max(500), special_expense_id: id.nullable() }).strict()),
    match_rules: rows(z.object({ id, payment_method_id: id.nullable(), keyword: z.string().max(500).nullable(), series_id: id }).strict()),
    ledger_months: rows(z.object({ ...ym, special_prompt_seen: z.boolean(), auto_filled: z.boolean().default(true) }).strict()),
    transfers: rows(z.object({ id, ...ym, series_id: id, account: nameValue, amount: money }).strict()).default([]),
    // 잔액 화면 이전에 내보낸 파일에는 없으므로 비어 있는 것으로 읽는다.
    accounts: rows(z.object({ id, name: nameValue, kind: accountKind, target: money.nullable(), sort }).strict()).default([]),
    account_balances: rows(z.object({ id, account_id: id, ...ym, amount: signedMoney }).strict()).default([]),
    notification_events: rows(z.object({
      id, payload: z.string().max(100000), transaction_json: z.string().max(1000).nullable(),
      fingerprint: z.string().length(64), approval_key: z.string().length(64).nullable(),
      received_at: z.number().int().nonnegative(), payment_method_id: id.nullable(),
      billing_kind: notificationSettingsSchema.shape.billing_kind, cutoff_day: notificationSettingsSchema.shape.cutoff_day,
      ...ym, reason: z.string().max(200).nullable(), status: z.enum(['review', 'saved', 'undone', 'discarded']),
      entry_id: id.nullable(), line_name: nameValue.nullable(), created_at: date,
    }).strict()).default([]),
  }).strict(),
}).strict();
export type Archive = z.infer<typeof archiveSchema>;
function unique<T>(rows: T[], key: (row: T) => string | number, label: string) {
  const seen = new Set<string | number>();
  for (const row of rows) { const k = key(row); if (seen.has(k)) throw new Error(`${label}에 중복된 식별자가 있습니다.`); seen.add(k); }
}
function withCanonicalSavingOwners(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const data = (input as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || !Array.isArray((data as { month_lines?: unknown }).month_lines)) return input;
  const lines = (data as { month_lines: unknown[] }).month_lines.map(line => {
    if (!line || typeof line !== 'object' || !('saving_owner' in line)) return line;
    const row = line as { saving_owner: unknown };
    return { ...row, saving_owner: canonicalSavingOwner(row.saving_owner) };
  });
  return { ...input, data: { ...data, month_lines: lines } };
}
export function validateArchive(input: unknown): Archive {
  const result = archiveSchema.safeParse(withCanonicalSavingOwners(input));
  if (!result.success) throw new Error('가계부 JSON 형식·버전·금액·필수 항목을 확인하세요.');
  const archive = result.data; const d = archive.data;
  for (const [name, records] of Object.entries(d)) {
    if (name !== 'saving_years' && name !== 'ledger_months') unique(records as { id: string }[], r => r.id, name);
  }
  unique(d.month_lines, r => `${r.year}-${r.month}-${r.series_id}`, '월 항목');
  unique(d.transfers, r => `${r.year}-${r.month}-${r.series_id}`, '이체 계좌');
  unique(d.ledger_months, r => `${r.year}-${r.month}`, '월 정보'); unique(d.saving_years, r => r.year, '연도 잔액');
  unique(d.categories, r => r.name, '카테고리 이름'); unique(d.payment_methods, r => r.name, '결제수단 이름');
  unique(d.accounts, r => r.name, '계좌 이름'); unique(d.account_balances, r => `${r.account_id}-${r.year}-${r.month}`, '계좌 잔액');
  const accountIds = new Set(d.accounts.map(a => a.id));
  if (d.account_balances.some(b => !accountIds.has(b.account_id))) throw new Error('잔액 기록의 계좌를 찾을 수 없습니다.');
  if (d.members.filter(m => m.role === 'owner').length !== 1) throw new Error('가계부 주인 멤버가 한 명이어야 합니다.');
  const members = new Set(d.members.map(m => m.id)); const cats = new Set(d.categories.map(c => c.id)); const methods = new Set(d.payment_methods.map(m => m.id));
  const lines = new Map(d.month_lines.map(l => [l.id, l])); const specials = new Map(d.special_expenses.map(e => [e.id, e]));
  const series = new Set(d.month_lines.map(l => l.series_id)); const months = new Set(d.ledger_months.map(m => `${m.year}-${m.month}`));
  const check = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const computed = computeLines(d.month_lines, d.entries, d.budget_adjustments);
  const actuals = new Map(computed.map(l => [l.id, l.actual]));
  for (const l of d.month_lines) {
    check(months.has(`${l.year}-${l.month}`), '항목의 월 정보가 없습니다.');
    check(!l.category_id || cats.has(l.category_id), '항목의 카테고리를 찾을 수 없습니다.');
    check(!l.payment_method_id || methods.has(l.payment_method_id), '항목의 결제수단을 찾을 수 없습니다.');
  }
  for (const e of d.entries) {
    check(lines.has(e.month_line_id) && members.has(e.created_by), '입력 기록의 항목 또는 작성자를 찾을 수 없습니다.');
  }
  for (const a of d.budget_adjustments) {
    check(lines.has(a.month_line_id) && (!a.special_expense_id || specials.has(a.special_expense_id)), '예산 조정의 연결을 찾을 수 없습니다.');
  }
  for (const u of d.saving_uses) check(!u.special_expense_id || specials.has(u.special_expense_id), '저축 사용의 특별 지출을 찾을 수 없습니다.');
  for (const r of d.match_rules) check((!r.payment_method_id || methods.has(r.payment_method_id)) && series.has(r.series_id), '매칭 규칙의 결제수단 또는 항목을 찾을 수 없습니다.');
  unique(d.entries.filter(e => e.dedupe_key !== null), e => e.dedupe_key!, '입력 중복 키');
  unique(d.notification_events.filter(e => e.approval_key !== null), e => e.approval_key!, '알림 승인 키');
  const entryById = new Map(d.entries.map(e => [e.id, e]));
  for (const event of d.notification_events) {
    try {
      notificationSchema.parse(JSON.parse(event.payload));
      if (event.transaction_json !== null) notificationTransactionSchema.parse(JSON.parse(event.transaction_json));
    } catch { throw new Error('알림 원문 또는 읽은 거래 형식을 확인하세요.'); }
    // 줄 삭제·금액 비우기로 entry가 사라져도 알림의 중복 방지 흔적은 보존한다.
    const entry = event.entry_id ? entryById.get(event.entry_id) : undefined;
    if (entry) check(event.status === 'saved' && entry.source === 'notification' && entry.id === `notification:${event.id}`,
      '알림과 입력 기록의 연결을 확인하세요.');
  }
  for (const l of computed) {
    check(money.safeParse(l.effectiveBudget).success && signedMoney.safeParse(l.actual).success, '월별 금액 또는 예산이 허용 범위를 벗어났습니다.');
    if (l.series_id.startsWith('special:')) check(specials.has(l.series_id.slice(8)), '특별 지출 줄의 원본을 찾을 수 없습니다.');
  }
  for (const e of d.special_expenses) {
    check(months.has(`${e.year}-${e.month}`), '특별 지출의 월 정보가 없습니다.');
    const adjustments = d.budget_adjustments.filter(a => a.special_expense_id === e.id);
    const uses = d.saving_uses.filter(u => u.special_expense_id === e.id);
    const generated = d.month_lines.filter(l => l.series_id === `special:${e.id}`);
    if (e.funding === 'line') {
      const donor = e.from_line_id ? lines.get(e.from_line_id) : undefined;
      check(donor && donor.year === e.year && donor.month === e.month && ['fixed','variable'].includes(donor.section) && !donor.series_id.startsWith('special:'), '특별 지출의 재원 항목 또는 월이 다릅니다.');
      check(adjustments.length === 1 && adjustments[0].month_line_id === donor!.id && adjustments[0].amount === -e.amount && !uses.length, '항목 재원의 예산 조정이 특별 지출과 다릅니다.');
      const l = generated[0];
      check(generated.length === 1 && l.year === e.year && l.month === e.month && l.name === e.name && l.section === 'variable' && l.one_off && l.budget === e.amount && l.input_mode === 'manual' && (actuals.get(l.id) ?? 0) === e.amount, '특별 지출의 일회성 줄 또는 금액이 다릅니다.');
    } else {
      check(e.from_line_id === null && !adjustments.length && !generated.length && uses.length === 1 && uses[0].year === e.year && uses[0].month === e.month && uses[0].amount === e.amount, '저축 재원의 사용 기록이 특별 지출과 다릅니다.');
    }
  }
  // 과거 차액의 절댓값이 커도 최종 합계의 정밀도로 검증한다.
  for (const year of new Set([...d.month_lines.map(l => l.year), ...d.saving_uses.map(u => u.year), ...d.saving_years.map(y => y.year)])) {
    const yearLines = computed.filter(l => l.year === year);
    monthTotals(yearLines);
    savingsRows(year, yearLines, d.saving_uses, d.saving_years.find(y => y.year === year)?.opening_balance ?? 0);
  }
  return archive;
}
