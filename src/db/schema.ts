import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const members = sqliteTable('members', {
  id: text().primaryKey(), email: text().notNull(), name: text().notNull(), role: text({ enum: ['owner', 'member'] }).notNull(),
});
export const invites = sqliteTable('invites', {
  id: text().primaryKey(), email: text().notNull(), token: text().notNull(), expires_at: text().notNull(), accepted_at: text(),
});
export const categories = sqliteTable('categories', { id: text().primaryKey(), name: text().notNull(), sort: integer().notNull() });
export const paymentMethods = sqliteTable('payment_methods', {
  id: text().primaryKey(), name: text().notNull(), kind: text({ enum: ['card', 'account'] }).notNull(), owner: text().notNull(),
  notify_app: text(), notify_keyword: text(),
  billing_kind: text({ enum: ['credit', 'debit', 'transfer'] }).notNull().default('debit'),
  cutoff_day: integer().notNull().default(31),
});
export const monthLines = sqliteTable('month_lines', {
  id: text().primaryKey(), year: integer().notNull(), month: integer().notNull(), series_id: text().notNull(),
  section: text({ enum: ['fixed', 'variable', 'saving', 'income'] }).notNull(), name: text().notNull(),
  category_id: text().references(() => categories.id), payment_method_id: text().references(() => paymentMethods.id),
  pay_day: integer(), budget: integer().notNull(), input_mode: text({ enum: ['card', 'fixed', 'manual'] }).notNull(),
  saving_owner: text({ enum: ['a', 'b', 'extra'] }), one_off: integer({ mode: 'boolean' }).notNull(), sort: integer().notNull(),
  transfer_key: text(),
}, (t) => [uniqueIndex('month_series_unique').on(t.year, t.month, t.series_id)]);
// 이체 계좌 묶음: 그 달에 어느 계좌로 얼마를 옮기는지. 줄은 transfer_key(= series_id)로 묶음에 속한다.
export const transfers = sqliteTable('transfers', {
  id: text().primaryKey(), year: integer().notNull(), month: integer().notNull(), series_id: text().notNull(),
  account: text().notNull(), amount: integer().notNull(),
}, (t) => [uniqueIndex('transfer_series_unique').on(t.year, t.month, t.series_id)]);
export const specialExpenses = sqliteTable('special_expenses', {
  id: text().primaryKey(), year: integer().notNull(), month: integer().notNull(), name: text().notNull(), amount: integer().notNull(),
  funding: text({ enum: ['line', 'saving'] }).notNull(), from_line_id: text().references(() => monthLines.id), calendar_event_id: text(),
});
export const budgetAdjustments = sqliteTable('budget_adjustments', {
  id: text().primaryKey(), month_line_id: text().notNull().references(() => monthLines.id, { onDelete: 'cascade' }),
  amount: integer().notNull(), special_expense_id: text().references(() => specialExpenses.id, { onDelete: 'cascade' }),
});
export const entries = sqliteTable('entries', {
  id: text().primaryKey(), month_line_id: text().notNull().references(() => monthLines.id, { onDelete: 'cascade' }), amount: integer().notNull(),
  source: text({ enum: ['manual', 'quick', 'auto', 'paste', 'notification', 'capture'] }).notNull(), raw_text: text(), dedupe_key: text(),
  created_by: text().notNull().references(() => members.id), created_at: text().notNull(),
});
export const savingYears = sqliteTable('saving_years', { year: integer().primaryKey(), opening_balance: integer().notNull() });
export const savingUses = sqliteTable('saving_uses', {
  id: text().primaryKey(), year: integer().notNull(), month: integer().notNull(), amount: integer().notNull(), memo: text().notNull(),
  special_expense_id: text().references(() => specialExpenses.id, { onDelete: 'cascade' }),
});
export const matchRules = sqliteTable('match_rules', {
  id: text().primaryKey(), payment_method_id: text().references(() => paymentMethods.id), keyword: text(), series_id: text().notNull(),
});
// 줄을 모두 지운 달도 생성 여부와 질문 상태를 보존한다.
export const ledgerMonths = sqliteTable('ledger_months', {
  year: integer().notNull(), month: integer().notNull(), special_prompt_seen: integer({ mode: 'boolean' }).notNull().default(false),
  // 매달 같은 금액 줄의 자동 금액을 넣었는지 (migrations/0002)
  auto_filled: integer({ mode: 'boolean' }).notNull().default(true),
}, (t) => [uniqueIndex('ledger_month_unique').on(t.year, t.month)]);
// 자산 계좌(migrations/0007). kind: ready=저축(평가금액=원금), invest=투자(평가금액을 적음), reserved=묶인 돈(보증금 등).
// principal: 저축·투자는 기록 이전에 넣어 둔 시작 원금, 묶인 돈은 그 금액. series: 원금으로 더할 월별 표 저축 줄(series id JSON 배열).
export const accounts = sqliteTable('accounts', {
  id: text().primaryKey(), name: text().notNull(), kind: text({ enum: ['ready', 'reserved', 'invest'] }).notNull(),
  target: integer(), sort: integer().notNull(),
  principal: integer().notNull().default(0), due_on: text(), series: text().notNull().default('[]'),
  // 기록 시작 달(YYYY-MM, migrations/0008). 이 달부터 저축 줄 금액을 원금에 더한다. 비어 있으면 처음부터.
  start_month: text(),
});
export const accountBalances = sqliteTable('account_balances', {
  id: text().primaryKey(), account_id: text().notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  year: integer().notNull(), month: integer().notNull(), amount: integer().notNull(),
  // 평가금액을 확인한 날(YYYY-MM-DD). 한 달에 여러 번 적으면 마지막 값과 날짜가 남는다.
  checked_on: text(),
}, (t) => [uniqueIndex('account_balance_unique').on(t.account_id, t.year, t.month)]);

export type MonthLine = typeof monthLines.$inferSelect;
export type LedgerMonth = typeof ledgerMonths.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type AccountBalance = typeof accountBalances.$inferSelect;
export type Transfer = typeof transfers.$inferSelect;
export type Entry = typeof entries.$inferSelect;
export type MatchRule = typeof matchRules.$inferSelect;
export type Adjustment = typeof budgetAdjustments.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type SavingUse = typeof savingUses.$inferSelect;
export type SavingYear = typeof savingYears.$inferSelect;
export type SpecialExpense = typeof specialExpenses.$inferSelect;

// 표시만 병합한다. 원래 값과 거래의 계좌 연결은 보존한다.
export const cellMerges = sqliteTable('cell_merges', {
  id: text().primaryKey(), year: integer().notNull(), month: integer().notNull(),
  section: text({ enum: ['fixed', 'variable', 'saving', 'income'] }).notNull(),
  line_ids: text().notNull(), first_col: integer().notNull(), last_col: integer().notNull(),
});
export type CellMerge = typeof cellMerges.$inferSelect;

export const notificationEvents = sqliteTable('notification_events', {
  id: text().primaryKey(), payload: text().notNull(), transaction_json: text(),
  fingerprint: text().notNull(), approval_key: text(), received_at: integer().notNull(),
  payment_method_id: text(), billing_kind: text({ enum: ['credit', 'debit', 'transfer'] }).notNull(), cutoff_day: integer().notNull(),
  year: integer().notNull(), month: integer().notNull(), reason: text(),
  status: text({ enum: ['review', 'saved', 'undone', 'discarded'] }).notNull(),
  entry_id: text(), line_name: text(), created_at: text().notNull(),
}, t => [uniqueIndex('notification_approval_unique').on(t.approval_key)]);
export type NotificationEvent = typeof notificationEvents.$inferSelect;
