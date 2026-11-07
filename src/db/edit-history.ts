import { sql } from 'drizzle-orm';
import { InputError } from '../lib/input-error';
import { getTableColumns } from 'drizzle-orm';
import type { LedgerCore } from './ledger-core';
import type { LedgerStore, Statement } from './store';
import * as s from './schema';

const tables = {
  categories: s.categories, payment_methods: s.paymentMethods, month_lines: s.monthLines,
  entries: s.entries, budget_adjustments: s.budgetAdjustments, special_expenses: s.specialExpenses,
  saving_years: s.savingYears, saving_uses: s.savingUses, match_rules: s.matchRules,
  ledger_months: s.ledgerMonths, transfers: s.transfers, accounts: s.accounts,
  account_balances: s.accountBalances, account_deposits: s.accountDeposits, cell_merges: s.cellMerges,
};
type Row = Record<string, string | number | null>;
type Change = { seq: number; table_name: keyof typeof tables; before_json: string | null; after_json: string | null };
type Operation = { id: string; request_json: string; state: 'applied' | 'undone'; complete: number; result_json: string | null };
export class EditConflict extends Error {
  constructor() { super('이 작업 뒤에 같은 항목이 변경되었습니다. 최신 내용을 확인한 뒤 다시 시도하세요.'); }
}
export function guardStatement(condition: string, params: unknown[]): Statement[] {
  const id = crypto.randomUUID();
  return [
    { sql: `INSERT INTO edit_guards(id,okay) SELECT ?, CASE WHEN ${condition} THEN 1 ELSE 0 END`, params: [id, ...params] },
    { sql: 'DELETE FROM edit_guards WHERE id=?', params: [id] },
  ];
}
const keysOf = (table: string) => table === 'ledger_months' ? ['year', 'month'] : table === 'saving_years' ? ['year'] : ['id'];
const quoted = (name: string) => `"${name}"`;
const equal = (a: Row | null, b: Row | null) => JSON.stringify(a) === JSON.stringify(b);

// SQL 트리거가 기록한 해당 작업의 행만 역적용한다. 다른 거래·다른 필드는 건드리지 않는다.
export async function applyEditHistory(core: LedgerCore, id: string, direction: 'undo' | 'redo') {
  await core.init();
  const [op] = await core.db.all<Operation>(sql`SELECT * FROM edit_operations WHERE id=${id}`);
  const expected = direction === 'undo' ? 'applied' : 'undone';
  if (!op || op.state !== expected) throw new EditConflict();
  const changes = await core.db.all<Change>(sql`SELECT * FROM edit_changes WHERE operation_id=${id} ORDER BY seq`);
  const collapsed = new Map<string, { table: keyof typeof tables; before: Row | null; after: Row | null; first: number; last: number }>();
  for (const c of changes) {
    if (!(c.table_name in tables)) throw new EditConflict();
    const before = c.before_json ? JSON.parse(c.before_json) as Row : null;
    const after = c.after_json ? JSON.parse(c.after_json) as Row : null;
    const row = after ?? before!;
    const key = `${c.table_name}:${JSON.stringify(keysOf(c.table_name).map(k => row[k]))}`;
    const previous = collapsed.get(key);
    if (previous) { previous.after = after; previous.last = c.seq; }
    else collapsed.set(key, { table: c.table_name, before, after, first: c.seq, last: c.seq });
  }
  const ordered = [...collapsed.values()].filter(c => !equal(c.before, c.after)).sort((a, b) => (a.before === null ? a.first : a.last) - (b.before === null ? b.first : b.last));
  if (direction === 'undo') ordered.reverse();
  const writes: Statement[] = guardStatement('EXISTS(SELECT 1 FROM edit_operations WHERE id=? AND state=?)', [id, expected]);
  for (const change of ordered) {
    const from = direction === 'undo' ? change.after : change.before;
    const to = direction === 'undo' ? change.before : change.after;
    const row = from ?? to!;
    const columns = Object.keys(getTableColumns(tables[change.table]));
    if (Object.keys(row).some(k => !columns.includes(k))) throw new EditConflict();
    const keys = keysOf(change.table);
    const where = keys.map(k => `${quoted(k)} IS ?`).join(' AND ');
    const keyParams = keys.map(k => row[k]);
    if (from && to) {
      const fields = columns.filter(k => !keys.includes(k) && from[k] !== to[k]);
      if (!fields.length) continue;
      writes.push(...guardStatement(`EXISTS(SELECT 1 FROM ${quoted(change.table)} WHERE ${where} AND ${fields.map(k => `${quoted(k)} IS ?`).join(' AND ')})`, [...keyParams, ...fields.map(k => from[k])]));
      writes.push({ sql: `UPDATE ${quoted(change.table)} SET ${fields.map(k => `${quoted(k)}=?`).join(',')} WHERE ${where}`, params: [...fields.map(k => to[k]), ...keyParams] });
    } else if (to) {
      writes.push(...guardStatement(`NOT EXISTS(SELECT 1 FROM ${quoted(change.table)} WHERE ${where})`, keyParams));
      writes.push({ sql: `INSERT INTO ${quoted(change.table)}(${columns.map(quoted).join(',')}) VALUES(${columns.map(() => '?').join(',')})`, params: columns.map(k => to[k]) });
    } else if (from) {
      writes.push(...guardStatement(`EXISTS(SELECT 1 FROM ${quoted(change.table)} WHERE ${columns.map(k => `${quoted(k)} IS ?`).join(' AND ')})`, columns.map(k => from[k])));
      // CASCADE 부모를 지울 때 이후에 생긴 거래·특별 지출·잔액까지 지워지는 길을 막는다.
      const dependencies: Record<string, [string, string][]> = {
        month_lines: [['entries', 'month_line_id'], ['budget_adjustments', 'month_line_id'], ['special_expenses', 'from_line_id']],
        special_expenses: [['budget_adjustments', 'special_expense_id'], ['saving_uses', 'special_expense_id']],
        accounts: [['account_balances', 'account_id'], ['account_deposits', 'account_id']],
      };
      for (const [child, column] of dependencies[change.table] ?? []) writes.push(...guardStatement(`NOT EXISTS(SELECT 1 FROM ${quoted(child)} WHERE ${quoted(column)}=?)`, [from.id]));
      if (change.table === 'month_lines') writes.push(...guardStatement('NOT EXISTS(SELECT 1 FROM cell_merges,json_each(cell_merges.line_ids) WHERE json_each.value=?)', [from.id]));
      writes.push({ sql: `DELETE FROM ${quoted(change.table)} WHERE ${where}`, params: keyParams });
    }
  }
  writes.push({ sql: 'UPDATE edit_operations SET state=? WHERE id=?', params: [direction === 'undo' ? 'undone' : 'applied', id] });
  try { await core.store.batch(writes); } catch { throw new EditConflict(); }
}

export async function recordEdit(core: LedgerCore, id: string, request: unknown, action: (tracked: LedgerCore) => Promise<string | undefined>) {
  await core.init();
  const requestJson = JSON.stringify(request);
  const [existing] = await core.db.all<Operation>(sql`SELECT * FROM edit_operations WHERE id=${id}`);
  if (existing) {
    if (existing.request_json !== requestJson || !existing.complete || existing.state !== 'applied') throw new EditConflict();
    return { ...JSON.parse(existing.result_json ?? '{}'), history_id: id } as { entry_id?: string; history_id?: string };
  }
  await core.store.batch([{ sql: 'INSERT INTO edit_operations(id,request_json) VALUES(?,?)', params: [id, requestJson] }]);
  const base = core.store;
  const store: LedgerStore = {
    db: base.db, maxParams: base.maxParams, prepare: async () => {},
    saveBackup: json => base.saveBackup(json), close: () => {},
    batch: async statements => {
      if (!statements.length) return;
      const writes: Statement[] = []; let enabled = false;
      for (const statement of statements) {
        const capture = statement.history !== false;
        if (capture !== enabled) {
          writes.push({ sql: 'UPDATE edit_context SET operation_id=? WHERE slot=1', params: [capture ? id : null] });
          enabled = capture;
        }
        writes.push(statement);
      }
      if (enabled) writes.push({ sql: 'UPDATE edit_context SET operation_id=NULL WHERE slot=1', params: [] });
      await base.batch(writes);
    },
  };
  try {
    const entry_id = await action(core.fork(store));
    await base.batch([{ sql: 'UPDATE edit_operations SET complete=1,result_json=? WHERE id=?', params: [JSON.stringify({ entry_id }), id] }]);
    const [count] = await core.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM edit_changes WHERE operation_id=${id}`);
    return { entry_id, history_id: Number(count.n) ? id : undefined };
  } catch (error) {
    try {
      await applyEditHistory(core, id, 'undo');
      await base.batch([{ sql: 'DELETE FROM edit_operations WHERE id=?', params: [id] }]);
    } catch { throw new InputError('저장 중 충돌이 발생했습니다. 최신 내용을 다시 불러와 확인하세요.'); }
    throw error;
  }
}
