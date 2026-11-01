import { InputError } from './input-error';
import * as z from 'zod/mini';
import { computeLines, monthTotals, savingsRows } from './calculations';
import { accountKind, canonicalSavingOwner, lineFields, money, signedMoney, entryMoney, nameValue, yearValue, monthValue } from './validation';
import { notificationSchema, notificationSettingsSchema, notificationTransactionSchema } from './notification';
const id = z.string().check(z.minLength(1), z.maxLength(128));
const sort = z.number().check(z.int(), z.minimum(0), z.maximum(1000000));
const date = z.iso.datetime();
const ym = { year: yearValue, month: monthValue };
const rows = <T extends z.ZodMiniType>(schema: T) => z.array(schema).check(z.maxLength(100000));
export const archiveSchema = z.strictObject({
  app: z.literal('couple-ledger'), version: z.literal(1), exported_at: date,
  data: z.strictObject({
    members: rows(z.strictObject({ id, email: z.string().check(z.maxLength(320)), name: nameValue, role: z.enum(['owner', 'member']) })).check(z.minLength(1)),
    invites: rows(z.strictObject({ id, email: z.string().check(z.maxLength(320)), token: z.string().check(z.minLength(1), z.maxLength(500)), expires_at: date, accepted_at: z.nullable(date) })),
    categories: rows(z.strictObject({ id, name: nameValue, sort })),
    payment_methods: rows(z.strictObject({ id, name: nameValue, kind: z.enum(['card', 'account']), owner: nameValue, ...notificationSettingsSchema.shape })),
    month_lines: rows(z.safeExtend(lineFields, { id, ...ym, category_id: z.nullable(id), payment_method_id: z.nullable(id), series_id: id, sort })),
    entries: rows(z.strictObject({ id, month_line_id: id, amount: entryMoney, source: z.enum(['manual', 'quick', 'auto', 'paste', 'notification', 'capture']), raw_text: z.nullable(z.string().check(z.maxLength(12000))), dedupe_key: z._default(z.optional(z.nullable(z.string().check(z.maxLength(1000)))), null), created_by: id, created_at: date })),
    budget_adjustments: rows(z.strictObject({ id, month_line_id: id, amount: signedMoney, special_expense_id: z.nullable(id) })),
    special_expenses: rows(z.strictObject({ id, ...ym, name: nameValue, amount: money.check(z.minimum(1)), funding: z.enum(['line','saving']), from_line_id: z.nullable(id), calendar_event_id: z.nullable(id) })),
    saving_years: rows(z.strictObject({ year: yearValue, opening_balance: signedMoney })),
    saving_uses: rows(z.strictObject({ id, ...ym, amount: money, memo: z.string().check(z.maxLength(500)), special_expense_id: z.nullable(id) })),
    match_rules: rows(z.strictObject({ id, payment_method_id: z.nullable(id), keyword: z.nullable(z.string().check(z.maxLength(500))), series_id: id })),
    ledger_months: rows(z.strictObject({ ...ym, special_prompt_seen: z.boolean(), auto_filled: z._default(z.boolean(), true) })),
    transfers: z._default(rows(z.strictObject({ id, ...ym, series_id: id, account: nameValue, amount: money })), []),
    cell_merges: z._default(rows(z.strictObject({ id, ...ym, section: z.enum(['fixed', 'variable', 'saving', 'income']), line_ids: z.string().check(z.maxLength(100000)), first_col: z.number().check(z.int(), z.minimum(0), z.maximum(7)), last_col: z.number().check(z.int(), z.minimum(0), z.maximum(7)) })), []),
    // 잔액 화면 이전에 내보낸 파일에는 없으므로 비어 있는 것으로 읽는다.
    accounts: z._default(rows(z.strictObject({ id, name: nameValue, kind: accountKind, target: z.nullable(money), sort })), []),
    account_balances: z._default(rows(z.strictObject({ id, account_id: id, ...ym, amount: signedMoney })), []),
    notification_events: z._default(rows(z.strictObject({
      id, payload: z.string().check(z.maxLength(100000)), transaction_json: z.nullable(z.string().check(z.maxLength(1000))),
      fingerprint: z.string().check(z.length(64)), approval_key: z.nullable(z.string().check(z.length(64))),
      received_at: z.number().check(z.int(), z.nonnegative()), payment_method_id: z.nullable(id),
      billing_kind: notificationSettingsSchema.shape.billing_kind, cutoff_day: notificationSettingsSchema.shape.cutoff_day,
      ...ym, reason: z.nullable(z.string().check(z.maxLength(200))), status: z.enum(['review', 'saved', 'undone', 'discarded']),
      entry_id: z.nullable(id), line_name: z.nullable(nameValue), created_at: date,
    })), []),
  }),
});
export type Archive = z.infer<typeof archiveSchema>;
function unique<T>(rows: T[], key: (row: T) => string | number, label: string) {
  const seen = new Set<string | number>();
  for (const row of rows) { const k = key(row); if (seen.has(k)) throw new InputError(`${label}에 중복된 식별자가 있습니다.`); seen.add(k); }
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
  if (!result.success) throw new InputError('가계부 JSON 형식·버전·금액·필수 항목을 확인하세요.');
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
  if (d.account_balances.some(b => !accountIds.has(b.account_id))) throw new InputError('잔액 기록의 계좌를 찾을 수 없습니다.');
  if (d.members.filter(m => m.role === 'owner').length !== 1) throw new InputError('가계부 주인 멤버가 한 명이어야 합니다.');
  const members = new Set(d.members.map(m => m.id)); const cats = new Set(d.categories.map(c => c.id)); const methods = new Set(d.payment_methods.map(m => m.id));
  const lines = new Map(d.month_lines.map(l => [l.id, l])); const specials = new Map(d.special_expenses.map(e => [e.id, e]));
  const series = new Set(d.month_lines.map(l => l.series_id)); const months = new Set(d.ledger_months.map(m => `${m.year}-${m.month}`));
  for (const merge of d.cell_merges) {
    let ids: unknown;
    try { ids = JSON.parse(merge.line_ids); } catch { throw new InputError('병합 정보의 항목 목록이 올바르지 않습니다.'); }
    if (!Array.isArray(ids) || !ids.length || ids.length > 512 || new Set(ids).size !== ids.length || merge.first_col > merge.last_col || ids.some(id => typeof id !== 'string' || !lines.has(id) || lines.get(id)!.year !== merge.year || lines.get(id)!.month !== merge.month || lines.get(id)!.section !== merge.section)) throw new InputError('병합 정보의 범위 또는 항목을 확인하세요.');
  }
  const check = (condition: unknown, message: string) => { if (!condition) throw new InputError(message); };
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
    } catch { throw new InputError('알림 원문 또는 읽은 거래 형식을 확인하세요.'); }
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
