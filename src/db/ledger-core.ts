import { InputError } from '../lib/input-error';
// 가계부 저장 로직. 로컬(libSQL)과 배포(D1)가 함께 쓴다. node 전용 모듈을 가져오지 않는다.
//
// 저장 방식: 먼저 읽고 → JS에서 판단·계산하고 → 쓰기만 모아 store.batch()로 한 번에 보낸다.
// batch는 전부 반영되거나 전부 되돌려진다. "읽고-판단하고-쓰기"를 한 트랜잭션에 묶지 않으므로
// 읽은 뒤 쓰기 전에 다른 요청이 끼어들 수는 있다. 혼자 쓰는 앱이라 받아들이고, 금액 칸 저장처럼
// 겹치면 숫자가 틀어지는 곳은 SQL 한 문장 안에서 계산한다. 표 제약(CHECK·UNIQUE·FK)은 그대로 마지막 방어선이다.
//
// 달 보기는 읽기만 한다: 아직 없는 달은 이어받을 줄을 계산해 "가상 줄"로 보여 주고(id는 그 달을 실제로
// 만들 때와 같다), 그 달의 무언가를 고칠 때 비로소 만든다.
import { and, asc, eq, getTableColumns, inArray, sql, type SQL } from 'drizzle-orm';
import { SQLiteAsyncDialect, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import * as s from './schema';
import { categoryNames, paymentNames } from './seed';
import { autoEntries, autoEntryId, fromIndex, monthIndex, placeWithTransfer, planMonth, scopedMonth, type MonthBase, type MonthPlan } from './months';
import { toStatement, type LedgerStore, type Statement } from './store';
import { safeSum } from '../lib/calculations';
import { validateArchive, type Archive } from '../lib/archive';
import { accountKind, lineFields, money, signedMoney, yearValue, monthValue, nameValue, type CaptureConfirmItem, type LineInput } from '../lib/validation';
import { notificationSettingsSchema, type NotificationSettings } from '../lib/notification';
import { parseMoney } from '../lib/validation';
import { parsePayment } from '../lib/payment';
import { guardStatement } from './edit-history';
import { sheetColumns, type SheetChange } from '../lib/sheet-grid';

export type Today = () => { year: number; month: number };
// 한국 시간 기준 이번 달
export const seoulToday: Today = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  return { year: Number(parts.find(p => p.type === 'year')!.value), month: Number(parts.find(p => p.type === 'month')!.value) };
};
export type LedgerOptions = { today?: Today };
const dialect = new SQLiteAsyncDialect();
const raw = (query: SQL): Statement => { const { sql: text, params } = dialect.sqlToQuery(query); return { sql: text, params }; };
const sameMonth = (a: { year: number; month: number }, b: { year: number; month: number }) => a.year === b.year && a.month === b.month;

export class LedgerCore {
  readonly store: LedgerStore;
  private ready?: Promise<void>;
  private readonly today: Today;
  constructor(store: LedgerStore, options: LedgerOptions = {}) {
    this.store = store;
    this.today = options.today ?? seoulToday;
  }
  get db() { return this.store.db; }
  fork(store: LedgerStore) { return new LedgerCore(store, { today: this.today }); }

  async init() {
    this.ready ??= (async () => {
      await this.store.prepare();
      const existing = await this.db.select().from(s.members).limit(1);
      if (existing.length) return;
      await this.store.batch([
        ...this.insert(s.members, [{ id: 'local-owner', email: '', name: '사용자', role: 'owner' }], true),
        ...this.insert(s.categories, categoryNames.map((name, sort) => ({ id: `category-${sort}`, name, sort })), true),
        ...this.insert(s.paymentMethods, paymentNames.map((name, i) => ({ id: `payment-${i}`, name, kind: i === 0 ? 'card' as const : 'account' as const, owner: '공통' })), true),
      ]);
    })().catch(error => { this.ready = undefined; throw error; });
    return this.ready;
  }

  // ── 달 만들기 ─────────────────────────────────────────────
  private isDue(year: number, month: number) { const t = this.today(); return monthIndex(year, month) <= monthIndex(t.year, t.month); }
  private async memberId() {
    const [member] = await this.db.select().from(s.members).limit(1);
    if (!member) throw new Error('가계부 주인 정보가 없습니다.');
    return member.id;
  }
  private async monthRows(year: number, month: number) {
    return this.db.select().from(s.monthLines).where(and(eq(s.monthLines.year, year), eq(s.monthLines.month, month))).orderBy(asc(s.monthLines.sort));
  }
  private async monthTransfers(year: number, month: number) {
    return this.db.select().from(s.transfers).where(and(eq(s.transfers.year, year), eq(s.transfers.month, month)));
  }
  // 아직 없는 달(target)에 대해, 직전에 실제로 있는 달부터 target까지 만들 계획
  private async plansUpTo(year: number, month: number, months: s.LedgerMonth[], onlyTarget: boolean): Promise<MonthPlan[]> {
    const target = monthIndex(year, month);
    const prior = months.filter(m => monthIndex(m.year, m.month) < target).sort((a, b) => monthIndex(b.year, b.month) - monthIndex(a.year, a.month))[0];
    const base: MonthBase | null = prior ? { lines: await this.monthRows(prior.year, prior.month), transfers: await this.monthTransfers(prior.year, prior.month) } : null;
    const memberId = await this.memberId();
    const categoryIds = new Set((await this.db.select({ id: s.categories.id }).from(s.categories)).map(c => c.id));
    const methodIds = new Set((await this.db.select({ id: s.paymentMethods.id }).from(s.paymentMethods)).map(c => c.id));
    const start = prior && !onlyTarget ? monthIndex(prior.year, prior.month) + 1 : target;
    const plans: MonthPlan[] = [];
    for (let index = start; index <= target; index++) {
      const { year: y, month: m } = fromIndex(index);
      plans.push(planMonth(y, m, base, { due: this.isDue(y, m), memberId, categoryIds, methodIds }));
    }
    return plans;
  }
  // 그 달을 실제로 만든다(고치기 직전에 부른다). 직전 달과의 사이에 빈 달이 있으면 같이 만든다.
  // 이미 있는 달이면, 미리 만들어 두었던 달이 이제 이번 달·지난 달이 되었을 때 자동 금액만 채운다.
  // 같은 계획을 두 번 보내도 id가 같아 중복되지 않는다(INSERT OR IGNORE).
  async ensureMonth(year: number, month: number) {
    await this.store.batch((await this.planMonthWrites(year, month)).map(s => ({ ...s, history: false })));
  }
  // 알림 수신의 한 batch에 월 생성도 함께 넣도록 쓰기 계획만 돌려준다.
  async planMonthWrites(year: number, month: number): Promise<Statement[]> {
    yearValue.parse(year); monthValue.parse(month); await this.init();
    const months = await this.db.select().from(s.ledgerMonths);
    const existing = months.find(m => m.year === year && m.month === month);
    if (existing) {
      return !existing.auto_filled && this.isDue(year, month) ? this.planAutoWrites(year, month) : [];
    }
    const statements: Statement[] = [];
    for (const plan of await this.plansUpTo(year, month, months, false)) {
      statements.push(...this.insert(s.ledgerMonths, [plan.month], true), ...this.insert(s.monthLines, plan.lines, true),
        ...this.insert(s.transfers, plan.transfers, true), ...this.insert(s.entries, plan.entries, true));
    }
    return statements;
  }
  private async planAutoWrites(year: number, month: number) {
    const lines = await this.monthRows(year, month);
    const entered = new Set((await this.entriesWhere(and(eq(s.monthLines.year, year), eq(s.monthLines.month, month))!)).map(e => e.month_line_id));
    return [
      ...this.insert(s.entries, autoEntries(lines.filter(l => !entered.has(l.id)), await this.memberId()), true),
      toStatement(this.db.update(s.ledgerMonths).set({ auto_filled: true }).where(and(eq(s.ledgerMonths.year, year), eq(s.ledgerMonths.month, month)))),
    ];
  }
  private entriesWhere(where: SQL) {
    return this.db.select(getTableColumns(s.entries)).from(s.entries).innerJoin(s.monthLines, eq(s.entries.month_line_id, s.monthLines.id)).where(where);
  }
  private adjustmentsWhere(where: SQL) {
    return this.db.select(getTableColumns(s.budgetAdjustments)).from(s.budgetAdjustments).innerJoin(s.monthLines, eq(s.budgetAdjustments.month_line_id, s.monthLines.id)).where(where);
  }

  // ── 읽기 (DB에 쓰지 않는다) ─────────────────────────────────
  async month(year: number, month: number) {
    yearValue.parse(year); monthValue.parse(month); await this.init();
    const months = await this.db.select().from(s.ledgerMonths);
    if (months.some(m => m.year === year && m.month === month)) return this.monthRows(year, month);
    const [plan] = await this.plansUpTo(year, month, months, true);
    return plan.lines;
  }
  async snapshot(year: number, month: number) {
    yearValue.parse(year); monthValue.parse(month); await this.init();
    const allMonths = await this.db.select().from(s.ledgerMonths);
    const virtual = allMonths.some(m => m.year === year && m.month === month) ? null : (await this.plansUpTo(year, month, allMonths, true))[0];
    const [lines, categories, paymentMethods, entries, adjustments, uses, years, specials, transfers, accounts, balances, matchRules, cellMerges] = await Promise.all([
      this.db.select().from(s.monthLines).where(eq(s.monthLines.year, year)).orderBy(asc(s.monthLines.sort)),
      this.db.select().from(s.categories).orderBy(asc(s.categories.sort)), this.db.select().from(s.paymentMethods),
      this.entriesWhere(eq(s.monthLines.year, year)),
      this.adjustmentsWhere(eq(s.monthLines.year, year)),
      this.db.select().from(s.savingUses).where(eq(s.savingUses.year, year)), this.db.select().from(s.savingYears),
      this.db.select().from(s.specialExpenses).where(eq(s.specialExpenses.year, year)),
      this.db.select().from(s.transfers).where(eq(s.transfers.year, year)),
      // 잔액은 지난 기록과 비교하므로 연도와 상관없이 모두 보낸다.
      this.db.select().from(s.accounts).orderBy(asc(s.accounts.sort)), this.db.select().from(s.accountBalances),
      this.db.select().from(s.matchRules),
      this.db.select().from(s.cellMerges).where(eq(s.cellMerges.year, year)),
    ]);
    // 미리 만들어 둔 달이 이번 달·지난 달이 되었으면, 아직 넣지 않은 자동 금액을 넣은 것처럼 보여 준다(고칠 때 실제로 넣는다).
    const entered = new Set(entries.map(e => e.month_line_id));
    const pending = allMonths.filter(m => m.year === year && !m.auto_filled && this.isDue(m.year, m.month));
    const memberId = pending.length ? await this.memberId() : '';
    const fills = pending.flatMap(m => autoEntries(lines.filter(l => sameMonth(l, m) && !entered.has(l.id)), memberId));
    const future = await this.db.select({ series_id: s.monthLines.series_id }).from(s.monthLines).where(sql`${s.monthLines.year} * 12 + ${s.monthLines.month} > ${year * 12 + month}`);
    const [notificationCount] = await this.db.select({ count: sql<number>`count(*)` }).from(s.notificationEvents).where(eq(s.notificationEvents.status, 'review'));
    return {
      year, month,
      notificationCount: Number(notificationCount.count),
      lines: virtual ? [...lines, ...virtual.lines] : lines,
      categories, paymentMethods,
      entries: [...entries, ...(virtual?.entries ?? []), ...fills],
      adjustments,
      months: [...allMonths.filter(m => m.year === year), ...(virtual ? [virtual.month] : [])],
      uses, years, specials,
      matchRules, cellMerges,
      transfers: virtual ? [...transfers, ...virtual.transfers] : transfers,
      accounts, balances, futureSeries: [...new Set(future.map(l => l.series_id))],
    };
  }

  // ── 줄 찾기 ──────────────────────────────────────────────
  // 여러 칸은 먼저 모두 검증하고, 월 준비·새 수단·값 변경을 한 batch로 저장한다.
  async editCells(year: number, month: number, changes: SheetChange[]) {
    yearValue.parse(year); monthValue.parse(month); await this.init();
    if (!changes.length || changes.length > 512) throw new InputError('한 번에 1~512칸을 붙여넣을 수 있습니다.');
    const snapshot = await this.snapshot(year, month);
    const rows = snapshot.lines.filter(l => l.month === month);
    const originals = new Map(rows.map(l => [l.id, l]));
    const patches = new Map<string, Partial<s.MonthLine>>();
    const amounts = new Map<string, number | null>();
    const transferAmounts: { id: string; amount: number }[] = [];
    const explicitBudget = new Set(changes.filter(c => c.col === 3).map(c => c.id));
    const methods = [...snapshot.paymentMethods]; const newMethods: s.PaymentMethod[] = [];
    const transfers = snapshot.transfers.filter(t => t.month === month); const newTransfers: s.Transfer[] = [];
    const seen = new Set<string>();
    for (const change of changes) {
      const line = originals.get(change.id);
      if (!line || line.series_id.startsWith('special:')) throw new InputError('붙여넣을 항목을 찾을 수 없거나 특별 지출 항목입니다.');
      const key = `${change.id}:${change.col}`;
      if (seen.has(key)) throw new InputError('같은 칸이 두 번 포함되었습니다.');
      seen.add(key);
      const patch = patches.get(line.id) ?? {};
      try {
        switch (change.col) {
          case 0: {
            const payment = parsePayment(change.value, methods);
            if (payment.payment_name) {
              nameValue.parse(payment.payment_name);
              const method: s.PaymentMethod = { id: crypto.randomUUID(), name: payment.payment_name, kind: payment.payment_name.includes('카드') ? 'card' : 'account', owner: '공통', notify_app: null, notify_keyword: null, billing_kind: payment.payment_name.includes('카드') ? 'debit' : 'transfer', cutoff_day: 31 };
              methods.push(method); newMethods.push(method); payment.payment_method_id = method.id;
            }
            patch.pay_day = payment.pay_day; patch.payment_method_id = payment.payment_method_id; break;
          }
          case 1: patch.name = nameValue.parse(change.value); break;
          case 2: {
            const name = change.value.trim(); const category = snapshot.categories.find(c => c.name === name);
            if (name && !category) throw new InputError('설정에 등록된 카테고리 이름을 적으세요.');
            patch.category_id = category?.id ?? null; break;
          }
          case 3: patch.budget = parseMoney(change.value) ?? 0; break;
          case 4: amounts.set(line.id, parseMoney(change.value, true)); break;
          case 5: {
            const name = change.value.trim();
            if (!name) { patch.transfer_key = null; break; }
            nameValue.parse(name);
            let transfer = [...transfers, ...newTransfers].find(t => t.account === name);
            if (!transfer) { transfer = { id: crypto.randomUUID(), year, month, series_id: crypto.randomUUID(), account: name, amount: 0 }; newTransfers.push(transfer); }
            patch.transfer_key = transfer.series_id; break;
          }
          case 6: transferAmounts.push({ id: line.id, amount: parseMoney(change.value) ?? 0 }); break;
          default: throw new InputError('남음은 자동 계산되는 칸입니다.');
        }
      } catch (error) {
        if (!(error instanceof InputError) && !(error instanceof Error && 'issues' in error)) throw error;
        throw new InputError(`${line.name} ${sheetColumns[change.col] ?? ''}: ${error instanceof Error && !('issues' in error) ? error.message : '입력값을 확인하세요.'}`);
      }
      patches.set(line.id, patch);
    }
    const writes: Statement[] = (await this.planMonthWrites(year, month)).map(s => ({ ...s, history: false }));
    writes.push(...this.insert(s.paymentMethods, newMethods), ...this.insert(s.transfers, newTransfers));
    const updated = rows.map(line => {
      const patch = patches.get(line.id);
      if (!patch) return line;
      const amount = amounts.get(line.id);
      if (line.input_mode === 'fixed' && amount !== undefined && amount !== null && amount >= 0 && !explicitBudget.has(line.id)) patch.budget = amount;
      if (patch.budget !== undefined && patch.budget + safeSum(snapshot.adjustments.filter(a => a.month_line_id === line.id).map(a => a.amount)) < 0) throw new InputError('특별 지출로 옮긴 예산보다 기본 예산이 작습니다.');
      const fields = Object.keys(patch) as (keyof s.MonthLine)[];
      if (fields.length) {
        writes.push(...guardStatement(`EXISTS(SELECT 1 FROM month_lines WHERE id=? AND ${fields.map(k => `"${k}" IS ?`).join(' AND ')})`, [line.id, ...fields.map(k => line[k])]));
        writes.push(toStatement(this.db.update(s.monthLines).set(patch).where(eq(s.monthLines.id, line.id))));
      }
      return { ...line, ...patch };
    });
    const transferValues = new Map<string, number>();
    for (const { id, amount } of transferAmounts) {
      const line = updated.find(l => l.id === id)!;
      if (!line.transfer_key) { if (amount === 0) continue; throw new InputError(`${line.name}: 이체 계좌를 먼저 적으세요.`); }
      const previous = transferValues.get(line.transfer_key);
      if (previous !== undefined && previous !== amount) throw new InputError('같은 이체 계좌에는 한 가지 이체 금액을 넣으세요.');
      transferValues.set(line.transfer_key, amount);
    }
    for (const [key, amount] of transferValues) {
      const transfer = [...transfers, ...newTransfers].find(t => t.series_id === key)!;
      writes.push(...guardStatement('EXISTS(SELECT 1 FROM transfers WHERE id=? AND amount=?)', [transfer.id, transfer.amount]));
      writes.push(toStatement(this.db.update(s.transfers).set({ amount }).where(eq(s.transfers.id, transfer.id))));
    }
    const memberId = await this.memberId();
    for (const [id, amount] of amounts) {
      if (amount === null) {
        const entries = snapshot.entries.filter(e => e.month_line_id === id);
        const expected = JSON.stringify(entries.map(e => ({ id: e.id, amount: e.amount })));
        writes.push(...guardStatement('NOT EXISTS(SELECT 1 FROM entries e WHERE e.month_line_id=? AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,\'$.id\')=e.id AND json_extract(j.value,\'$.amount\')=e.amount))', [id, expected]));
        writes.push(toStatement(this.db.delete(s.entries).where(eq(s.entries.month_line_id, id))));
      } else writes.push(raw(sql`INSERT INTO entries(id,month_line_id,amount,source,raw_text,created_by,created_at)
        SELECT ${crypto.randomUUID()},${id},${amount} - total,'paste',NULL,${memberId},${new Date().toISOString()}
        FROM (SELECT COALESCE(SUM(amount),0) AS total,COUNT(*) AS n FROM entries WHERE month_line_id=${id})
        WHERE ${amount} - total <> 0 OR n=0`));
    }
    writes.push(...this.reorder(updated, [], changes.filter(c => c.col === 5).map(c => c.id)), ...this.dropUnused([...transfers, ...newTransfers], updated));
    await this.store.batch(writes);
  }

  async mergeCells(year: number, month: number, ids: string[], first: number, last: number) {
    if (first < 0 || last > 7 || first > last || ids.length * (last - first + 1) < 2 || new Set(ids).size !== ids.length) throw new InputError('이어진 두 칸 이상을 사각형으로 선택하세요.');
    const rows = await this.month(year, month);
    const at = ids.map(id => rows.findIndex(l => l.id === id));
    if (at.some((n, i) => n < 0 || (i > 0 && n !== at[i - 1] + 1)) || at.some(n => rows[n].section !== rows[at[0]].section)) throw new InputError('같은 구역에서 이어진 칸을 선택하세요.');
    const existing = await this.db.select().from(s.cellMerges).where(and(eq(s.cellMerges.year, year), eq(s.cellMerges.month, month)));
    const selected = new Set(ids); const replaced: string[] = [];
    for (const merge of existing) {
      const own = JSON.parse(merge.line_ids) as string[];
      if (own.some(id => selected.has(id)) && merge.first_col <= last && merge.last_col >= first) {
        if (own.some(id => !selected.has(id)) || merge.first_col < first || merge.last_col > last) throw new InputError('기존 병합 칸을 전체 선택하세요.');
        replaced.push(merge.id);
      }
    }
    await this.store.batch([
      ...(await this.planMonthWrites(year, month)).map(s => ({ ...s, history: false })),
      ...replaced.map(id => toStatement(this.db.delete(s.cellMerges).where(eq(s.cellMerges.id, id)))),
      ...this.insert(s.cellMerges, [{ id: crypto.randomUUID(), year, month, section: rows[at[0]].section, line_ids: JSON.stringify(ids), first_col: first, last_col: last }]),
    ]);
  }
  async unmergeCells(ids: string[]) {
    await this.init();
    await this.store.batch(ids.map(id => toStatement(this.db.delete(s.cellMerges).where(eq(s.cellMerges.id, id)))));
  }

  // 가상 줄의 id로 고치면 그 달을 먼저 만든다. 실제 줄이면 그 달의 밀린 자동 금액을 먼저 채운다.
  private async resolveLine(id: string) {
    let [line] = await this.db.select().from(s.monthLines).where(eq(s.monthLines.id, id));
    const scope = line ?? scopedMonth(id, 'l');
    if (scope) await this.ensureMonth(scope.year, scope.month);
    if (!line && scope) [line] = await this.db.select().from(s.monthLines).where(eq(s.monthLines.id, id));
    if (!line) throw new InputError('항목을 찾을 수 없습니다.');
    return line;
  }
  private async editableLine(id: string) {
    const line = await this.resolveLine(id);
    if (line.series_id.startsWith('special:')) throw new InputError('이 줄은 특별 지출에서 취소한 뒤 다시 입력하세요.');
    return line;
  }
  private target(line: s.MonthLine, future: boolean): SQL {
    return future
      ? and(eq(s.monthLines.series_id, line.series_id), sql`${s.monthLines.year} * 12 + ${s.monthLines.month} >= ${line.year * 12 + line.month}`)!
      : eq(s.monthLines.id, line.id);
  }
  private async budgetChanges(line: s.MonthLine, future: boolean) {
    const rows = await this.adjustmentsWhere(this.target(line, future));
    const byLine = new Map<string, number>();
    for (const a of rows) byLine.set(a.month_line_id, (byLine.get(a.month_line_id) ?? 0) + a.amount);
    return byLine;
  }

  // ── 금액·예산 ────────────────────────────────────────────
  // 자동(매달 같은 금액) 줄은 금액이 곧 다음 달에 이어질 금액이다: 예산을 같이 맞추고, future면 이미 만든 이후 달의 예산·자동 금액도 바꾼다.
  async setAmount(id: string, amount: number | null, future = false) {
    if (amount !== null) signedMoney.parse(amount);
    await this.init();
    const line = await this.editableLine(id);
    if (amount === null) { await this.store.batch([toStatement(this.db.delete(s.entries).where(eq(s.entries.month_line_id, line.id)))]); return; }
    const carry: Statement[] = [];
    if (line.input_mode === 'fixed' && amount >= 0) {
      for (const change of (await this.budgetChanges(line, future)).values()) {
        if (amount + change < 0) throw new InputError('특별 지출로 옮긴 예산보다 금액이 작습니다. 특별 지출을 먼저 취소하세요.');
      }
      carry.push(toStatement(this.db.update(s.monthLines).set({ budget: amount }).where(this.target(line, future))));
      if (future) {
        const later = (await this.db.select({ id: s.monthLines.id }).from(s.monthLines).where(this.target(line, true))).filter(r => r.id !== line.id);
        if (later.length) carry.push(toStatement(this.db.update(s.entries).set({ amount }).where(inArray(s.entries.id, later.map(r => autoEntryId(r.id))))));
      }
    }
    // 최종 금액과 지금까지 기록 합계의 차이를 한 문장 안에서 계산한다. 같은 칸을 동시에 저장해도 합계가 틀어지지 않는다.
    // 차이가 0이고 기록이 이미 있으면 아무것도 넣지 않는다.
    const memberId = await this.memberId();
    await this.store.batch([raw(sql`INSERT INTO entries (id, month_line_id, amount, source, raw_text, created_by, created_at)
      SELECT ${crypto.randomUUID()}, ${line.id}, ${amount} - total, 'manual', NULL, ${memberId}, ${new Date().toISOString()}
      FROM (SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS n FROM entries WHERE month_line_id = ${line.id})
      WHERE ${amount} - total <> 0 OR n = 0`), ...carry]);
  }
  async setBudget(id: string, amount: number, future = false) {
    money.parse(amount); await this.init();
    const line = await this.editableLine(id);
    for (const change of (await this.budgetChanges(line, future)).values()) {
      if (amount + change < 0) throw new InputError('특별 지출로 옮긴 예산보다 기본 예산이 작습니다. 특별 지출을 먼저 취소하세요.');
    }
    await this.store.batch([toStatement(this.db.update(s.monthLines).set({ budget: amount }).where(this.target(line, future)))]);
  }

  // ── 줄 추가·수정·삭제 ─────────────────────────────────────
  // future: 이미 만들어진 이후 달에도 같은 줄(같은 series)을 넣는다. 금액 기록은 이번 달에만 남는다.
  async createLine(year: number, month: number, fields: LineInput, amount?: number, transferAccount?: string | null, future = false) {
    if (amount !== undefined) signedMoney.parse(amount);
    const valid = lineFields.parse(fields); await this.ensureMonth(year, month);
    const statements: Statement[] = [];
    const rows = await this.monthRows(year, month);
    const id = crypto.randomUUID(); const series_id = crypto.randomUUID();
    let created: s.Transfer | undefined;
    if (transferAccount !== undefined) ({ key: valid.transfer_key, created } = await this.transferKey(year, month, transferAccount, statements));
    const line: s.MonthLine = { ...valid, id, year, month, series_id, sort: Math.max(-1, ...rows.map(l => l.sort)) + 1 };
    statements.push(...this.insert(s.monthLines, [line]));
    if (amount !== undefined) statements.push(...this.insert(s.entries, [{ id: crypto.randomUUID(), month_line_id: id, amount, source: 'quick', raw_text: valid.name, created_by: await this.memberId(), created_at: new Date().toISOString() }]));
    statements.push(...this.reorder(rows, [line], [id]));
    if (future && !valid.one_off) {
      const own = valid.transfer_key ? created ?? (await this.monthTransfers(year, month)).find(t => t.series_id === valid.transfer_key) : undefined;
      const later = (await this.db.select().from(s.ledgerMonths)).filter(m => monthIndex(m.year, m.month) > monthIndex(year, month));
      for (const m of later) {
        const monthRows = await this.monthRows(m.year, m.month);
        // 그 달에 같은 이름의 이체 계좌가 있으면 그 묶음에, 없으면 이번 달 묶음을 그대로 옮겨 넣는다.
        let transfer_key = valid.transfer_key;
        if (own) {
          const same = (await this.monthTransfers(m.year, m.month)).find(t => t.account === own.account);
          if (same) transfer_key = same.series_id;
          else statements.push(...this.insert(s.transfers, [{ ...own, id: crypto.randomUUID(), year: m.year, month: m.month }]));
        }
        const copy: s.MonthLine = { ...valid, transfer_key, id: crypto.randomUUID(), year: m.year, month: m.month, series_id, sort: Math.max(-1, ...monthRows.map(l => l.sort)) + 1 };
        statements.push(...this.insert(s.monthLines, [copy]), ...this.reorder(monthRows, [copy], [copy.id]));
      }
    }
    await this.store.batch(statements);
    return id;
  }
  async updateLine(id: string, fields: LineInput, future = false, transferAccount?: string | null) {
    const valid = lineFields.parse(fields); await this.init();
    const line = await this.editableLine(id);
    const where = this.target(line, future);
    const affected = await this.db.select().from(s.monthLines).where(where);
    const changes = await this.budgetChanges(line, future);
    const linked = new Set((await this.db.select({ from: s.specialExpenses.from_line_id }).from(s.specialExpenses).innerJoin(s.monthLines, eq(s.specialExpenses.from_line_id, s.monthLines.id)).where(where)).map(r => r.from));
    for (const row of affected) {
      if (valid.budget + (changes.get(row.id) ?? 0) < 0 || (linked.has(row.id) && !['fixed', 'variable'].includes(valid.section))) throw new InputError('연결된 특별 지출의 재원을 유지할 수 없습니다. 특별 지출을 먼저 취소하세요.');
    }
    const statements: Statement[] = [];
    let created: s.Transfer | undefined;
    if (transferAccount === undefined) valid.transfer_key = line.transfer_key;
    else ({ key: valid.transfer_key, created } = await this.transferKey(line.year, line.month, transferAccount, statements));
    statements.push(toStatement(this.db.update(s.monthLines).set(valid).where(where)));
    const own = valid.transfer_key ? created ?? (await this.monthTransfers(line.year, line.month)).find(t => t.series_id === valid.transfer_key) : undefined;
    // 바뀐 줄이 있는 달마다: 이후 달에도 같은 묶음이 있게 하고, 줄 순서를 맞추고, 줄이 없는 묶음을 지운다.
    const affectedIds = new Set(affected.map(r => r.id));
    const months = [...new Map(affected.map(r => [`${r.year}-${r.month}`, { year: r.year, month: r.month }])).values()];
    for (const m of months) {
      const rows = (await this.monthRows(m.year, m.month)).map(r => affectedIds.has(r.id) ? { ...r, ...valid } : r);
      const transfers = await this.monthTransfers(m.year, m.month);
      if (created && sameMonth(m, line)) transfers.push(created);
      if (own && !sameMonth(m, line) && !transfers.some(t => t.series_id === own.series_id)) {
        const copy = { ...own, id: crypto.randomUUID(), year: m.year, month: m.month };
        statements.push(...this.insert(s.transfers, [copy], true)); transfers.push(copy);
      }
      statements.push(...this.reorder(rows, [], affected.filter(r => sameMonth(r, m)).map(r => r.id)));
      statements.push(...this.dropUnused(transfers, rows));
    }
    await this.store.batch(statements);
  }
  // 수단 칸(병합된 칸이면 묶인 줄 전부)의 결제일과 결제수단을 한 번에 바꾼다.
  async setPayment(ids: string[], payDay: number | null, methodId: string | null, future = false) {
    await this.init();
    if (methodId && !(await this.db.select().from(s.paymentMethods).where(eq(s.paymentMethods.id, methodId))).length) throw new InputError('결제수단을 찾을 수 없습니다.');
    const statements: Statement[] = [];
    for (const id of ids) {
      const line = await this.editableLine(id);
      statements.push(toStatement(this.db.update(s.monthLines).set({ pay_day: payDay, payment_method_id: methodId }).where(this.target(line, future))));
    }
    await this.store.batch(statements);
  }
  // 같은 구역 안에서 줄을 index 자리(그 줄을 뺀 구역 안 순서)로 옮긴다. 다른 구역 줄의 자리는 그대로다.
  async moveLine(id: string, index: number) {
    await this.init();
    const line = await this.resolveLine(id);
    const rows = await this.monthRows(line.year, line.month);
    const section = rows.filter(r => r.section === line.section && r.id !== line.id);
    section.splice(Math.max(0, Math.min(index, section.length)), 0, rows.find(r => r.id === line.id)!);
    let next = 0;
    await this.store.batch([...this.resequence(rows.map(r => r.section === line.section ? section[next++] : r)), ...this.pruneMerges(line.year, line.month)]);
  }
  async deleteLine(id: string, future = false) {
    await this.init();
    const line = await this.editableLine(id);
    const where = this.target(line, future);
    const affected = await this.db.select().from(s.monthLines).where(where);
    if ((await this.db.select({ id: s.specialExpenses.id }).from(s.specialExpenses).innerJoin(s.monthLines, eq(s.specialExpenses.from_line_id, s.monthLines.id)).where(where).limit(1)).length) throw new InputError('재원으로 연결된 특별 지출을 먼저 취소한 뒤 줄을 삭제하세요.');
    const removed = new Set(affected.map(r => r.id));
    // 입력 기록·예산 조정은 FK의 ON DELETE CASCADE로 같이 지워진다.
    const statements: Statement[] = [toStatement(this.db.delete(s.monthLines).where(where))];
    const months = [...new Map(affected.map(r => [`${r.year}-${r.month}`, { year: r.year, month: r.month }])).values()];
    for (const m of months) statements.push(...this.dropUnused(await this.monthTransfers(m.year, m.month), (await this.monthRows(m.year, m.month)).filter(r => !removed.has(r.id))), ...this.pruneMerges(m.year, m.month));
    const series = await this.db.select({ id: s.monthLines.id }).from(s.monthLines).where(eq(s.monthLines.series_id, line.series_id));
    if (series.every(r => removed.has(r.id))) statements.push(toStatement(this.db.delete(s.matchRules).where(eq(s.matchRules.series_id, line.series_id))));
    await this.store.batch(statements);
  }

  // ── 빠른 입력 ────────────────────────────────────────────
  async quickEntry(id: string, amount: number, rawText: string) {
    signedMoney.parse(amount); await this.init();
    const line = await this.editableLine(id);
    const history = await this.db.select({ amount: s.entries.amount }).from(s.entries).where(eq(s.entries.month_line_id, line.id));
    signedMoney.parse(safeSum([...history.map(e => e.amount), amount]));
    const entry_id = crypto.randomUUID();
    await this.store.batch(this.insert(s.entries, [{ id: entry_id, month_line_id: line.id, amount, source: 'quick', raw_text: rawText, created_by: await this.memberId(), created_at: new Date().toISOString() }]));
    return entry_id;
  }
  async undoQuick(entryId: string) {
    await this.init();
    const where = and(eq(s.entries.id, entryId), eq(s.entries.source, 'quick'));
    if (!(await this.db.select({ id: s.entries.id }).from(s.entries).where(where)).length) throw new InputError('이미 되돌렸거나 빠른 입력 기록이 아닙니다.');
    await this.store.batch([toStatement(this.db.delete(s.entries).where(where))]);
  }

  // 명세서에서 확인한 항목을 한 번에 저장한다. dedupe_key 충돌은 이미 넣은 거래로 보고 건너뛴다.
  async addCaptured(year: number, month: number, items: CaptureConfirmItem[]) {
    yearValue.parse(year); monthValue.parse(month); await this.init();
    const selected = items.filter(item => item.lineId !== null);
    if (!selected.length) return 0;
    for (const item of selected) {
      if (!item.key.startsWith('capture:')) throw new InputError('명세서 항목 식별자를 확인하세요.');
      signedMoney.parse(item.amount); nameValue.parse(item.merchant);
    }

    const currentLines = await this.monthRows(year, month);
    if (selected.some(item => !currentLines.some(line => line.id === item.lineId))) await this.ensureMonth(year, month);
    const lines = await this.monthRows(year, month);
    const lineById = new Map(lines.map(line => [line.id, line]));
    for (const item of selected) {
      const line = item.lineId ? lineById.get(item.lineId) : undefined;
      if (!line || line.year !== year || line.month !== month) throw new InputError('확정할 항목의 줄을 찾을 수 없습니다.');
    }

    const keys = [...new Set(selected.map(item => item.key))];
    const existing = new Set<string>();
    // D1은 문장당 값 100개까지라 IN 목록을 나눠 읽는다.
    for (let i = 0; i < keys.length; i += this.store.maxParams) {
      const rows = await this.db.select({ dedupe_key: s.entries.dedupe_key }).from(s.entries).where(inArray(s.entries.dedupe_key, keys.slice(i, i + this.store.maxParams)));
      rows.forEach(row => { if (row.dedupe_key) existing.add(row.dedupe_key); });
    }
    const memberId = await this.memberId();
    const now = new Date().toISOString();
    const entryRows: typeof s.entries.$inferInsert[] = selected.map(item => ({
      id: crypto.randomUUID(), month_line_id: item.lineId!, amount: item.amount, source: 'capture' as const,
      raw_text: item.raw, dedupe_key: item.key, created_by: memberId, created_at: now,
    }));
    const statements: Statement[] = [];
    const columns = Object.keys(getTableColumns(s.entries)).length;
    const size = Math.max(1, Math.floor(this.store.maxParams / columns));
    for (let i = 0; i < entryRows.length; i += size) {
      const query = this.db.insert(s.entries).values(entryRows.slice(i, i + size)).onConflictDoNothing({ target: s.entries.dedupe_key });
      statements.push(toStatement(query));
    }

    const remembered = new Map<string, CaptureConfirmItem>();
    selected.filter(item => item.remember).forEach(item => remembered.set(item.merchant.trim(), item));
    if (remembered.size) {
      const keywords = [...remembered.keys()];
      const oldRules: s.MatchRule[] = [];
      for (let i = 0; i < keywords.length; i += this.store.maxParams)
        oldRules.push(...await this.db.select().from(s.matchRules).where(inArray(s.matchRules.keyword, keywords.slice(i, i + this.store.maxParams))));
      const oldByKeyword = new Map(oldRules.map(rule => [rule.keyword!, rule]));
      for (const [keyword, item] of remembered) {
        const line = lineById.get(item.lineId!);
        const old = oldByKeyword.get(keyword);
        if (old) statements.push(toStatement(this.db.update(s.matchRules).set({ payment_method_id: null, series_id: line!.series_id }).where(eq(s.matchRules.keyword, keyword))));
        else statements.push(...this.insert(s.matchRules, [{ id: crypto.randomUUID(), payment_method_id: null, keyword, series_id: line!.series_id }]));
      }
    }
    await this.store.batch(statements);
    return new Set(selected.map(item => item.key).filter(key => !existing.has(key))).size;
  }

  // ── 저축 ─────────────────────────────────────────────────
  async setOpening(year: number, amount: number) {
    yearValue.parse(year); signedMoney.parse(amount); await this.init();
    await this.store.batch([toStatement(this.db.insert(s.savingYears).values({ year, opening_balance: amount }).onConflictDoUpdate({ target: s.savingYears.year, set: { opening_balance: amount } }))]);
  }
  async setUse(year: number, month: number, amount: number) {
    yearValue.parse(year); monthValue.parse(month); money.parse(amount); await this.init();
    const predicate = and(eq(s.savingUses.year, year), eq(s.savingUses.month, month));
    const existing = await this.db.select().from(s.savingUses).where(predicate);
    const special = existing.filter(u => u.special_expense_id).reduce((sum, u) => sum + u.amount, 0);
    if (amount < special) throw new InputError(`특별 지출 ${special.toLocaleString('ko-KR')}원보다 사용 총액을 작게 입력할 수 없습니다. 특별 지출에서 수정하세요.`);
    const statements = [toStatement(this.db.delete(s.savingUses).where(and(predicate, sql`${s.savingUses.special_expense_id} IS NULL`)))];
    if (amount > special) statements.push(...this.insert(s.savingUses, [{ id: crypto.randomUUID(), year, month, amount: amount - special, memo: '직접 입력', special_expense_id: null }]));
    await this.store.batch(statements);
  }

  // ── 특별 지출 ────────────────────────────────────────────
  async markPrompt(year: number, month: number) {
    await this.ensureMonth(year, month);
    await this.store.batch([toStatement(this.db.update(s.ledgerMonths).set({ special_prompt_seen: true }).where(and(eq(s.ledgerMonths.year, year), eq(s.ledgerMonths.month, month))))]);
  }
  async addSpecial(year: number, month: number, name: string, amount: number, funding: 'line' | 'saving', fromLineId: string | null) {
    name = nameValue.parse(name); money.min(1).parse(amount); await this.ensureMonth(year, month);
    const id = crypto.randomUUID();
    const statements: Statement[] = [];
    if (funding === 'line') {
      const [donor] = fromLineId ? await this.db.select().from(s.monthLines).where(eq(s.monthLines.id, fromLineId)) : [];
      if (!donor || donor.year !== year || donor.month !== month || !['fixed', 'variable'].includes(donor.section) || donor.series_id.startsWith('special:')) throw new InputError('이번 달 생활비 항목을 재원으로 선택하세요.');
      const changes = await this.db.select({ amount: s.budgetAdjustments.amount }).from(s.budgetAdjustments).where(eq(s.budgetAdjustments.month_line_id, donor.id));
      if (donor.budget + changes.reduce((sum, a) => sum + a.amount, 0) < amount) throw new InputError('가져올 항목의 예산이 부족합니다.');
      const rows = await this.monthRows(year, month);
      const lineId = crypto.randomUUID();
      statements.push(
        ...this.insert(s.specialExpenses, [{ id, year, month, name, amount, funding, from_line_id: donor.id, calendar_event_id: null }]),
        ...this.insert(s.budgetAdjustments, [{ id: crypto.randomUUID(), month_line_id: donor.id, amount: -amount, special_expense_id: id }]),
        ...this.insert(s.monthLines, [{ id: lineId, year, month, series_id: `special:${id}`, section: 'variable', name, category_id: donor.category_id, payment_method_id: donor.payment_method_id, pay_day: null, budget: amount, input_mode: 'manual', saving_owner: null, one_off: true, sort: Math.max(-1, ...rows.map(l => l.sort)) + 1, transfer_key: donor.transfer_key }]),
        ...this.insert(s.entries, [{ id: crypto.randomUUID(), month_line_id: lineId, amount, source: 'manual', raw_text: null, created_by: await this.memberId(), created_at: new Date().toISOString() }]),
      );
    } else {
      statements.push(
        ...this.insert(s.specialExpenses, [{ id, year, month, name, amount, funding, from_line_id: null, calendar_event_id: null }]),
        ...this.insert(s.savingUses, [{ id: crypto.randomUUID(), year, month, amount, memo: name, special_expense_id: id }]),
      );
    }
    statements.push(toStatement(this.db.update(s.ledgerMonths).set({ special_prompt_seen: true }).where(and(eq(s.ledgerMonths.year, year), eq(s.ledgerMonths.month, month)))));
    await this.store.batch(statements);
    return id;
  }
  async deleteSpecial(id: string) {
    await this.init();
    if (!(await this.db.select({ id: s.specialExpenses.id }).from(s.specialExpenses).where(eq(s.specialExpenses.id, id))).length) throw new InputError('특별 지출을 찾을 수 없습니다.');
    // 예산 조정·저축 사용 기록은 FK의 ON DELETE CASCADE로 같이 지워진다.
    await this.store.batch([
      toStatement(this.db.delete(s.matchRules).where(eq(s.matchRules.series_id, `special:${id}`))),
      toStatement(this.db.delete(s.monthLines).where(eq(s.monthLines.series_id, `special:${id}`))),
      toStatement(this.db.delete(s.specialExpenses).where(eq(s.specialExpenses.id, id))),
    ]);
  }

  // ── 이체 계좌 ────────────────────────────────────────────
  // future: 이미 만든 이후 달의 같은 묶음(같은 series)에도 계좌 이름·금액을 반영한다.
  async saveTransfer(id: string, changes: { account?: string; amount?: number }, future = false) {
    if (changes.amount !== undefined) money.parse(changes.amount);
    const account = changes.account === undefined ? undefined : nameValue.parse(changes.account);
    await this.init();
    const transfer = await this.resolveTransfer(id);
    const targets = future
      ? await this.db.select().from(s.transfers).where(and(eq(s.transfers.series_id, transfer.series_id), sql`${s.transfers.year} * 12 + ${s.transfers.month} >= ${transfer.year * 12 + transfer.month}`))
      : [transfer];
    if (account !== undefined) {
      for (const t of targets) {
        if (account !== t.account && (await this.monthTransfers(t.year, t.month)).some(o => o.account === account)) throw new InputError(`${t.month}월에 같은 이름의 이체 계좌가 있습니다.`);
      }
    }
    await this.store.batch(targets.map(t => toStatement(this.db.update(s.transfers).set({ ...(account !== undefined && { account }), ...(changes.amount !== undefined && { amount: changes.amount }) }).where(eq(s.transfers.id, t.id)))));
  }
  private async resolveTransfer(id: string) {
    let [transfer] = await this.db.select().from(s.transfers).where(eq(s.transfers.id, id));
    const scope = transfer ?? scopedMonth(id, 't');
    if (scope) await this.ensureMonth(scope.year, scope.month);
    if (!transfer && scope) [transfer] = await this.db.select().from(s.transfers).where(eq(s.transfers.id, id));
    if (!transfer) throw new InputError('이체 계좌를 찾을 수 없습니다.');
    return transfer;
  }
  // 계좌 이름으로 그 달의 묶음을 찾고, 없으면 새로 만드는 쓰기를 statements에 더한다. 빈 이름은 묶음 없음.
  private async transferKey(year: number, month: number, account: string | null, statements: Statement[]): Promise<{ key: string | null; created?: s.Transfer }> {
    const name = account?.trim();
    if (!name) return { key: null };
    nameValue.parse(name);
    const found = (await this.monthTransfers(year, month)).find(t => t.account === name);
    if (found) return { key: found.series_id };
    const created: s.Transfer = { id: crypto.randomUUID(), year, month, series_id: crypto.randomUUID(), account: name, amount: 0 };
    statements.push(...this.insert(s.transfers, [created]));
    return { key: created.series_id, created };
  }
  // rows(그 달의 현재 줄, sort 순) + added(새 줄)에서 placeIds 줄을 차례로 묶음 아래로 옮기고, 바뀐 순서를 쓰기로 돌려준다.
  private reorder(rows: s.MonthLine[], added: s.MonthLine[], placeIds: string[]): Statement[] {
    const start = [...rows, ...added];
    let order = start;
    for (const id of placeIds) order = placeWithTransfer(order, id);
    const moved = order.every((r, i) => r === start[i]) ? [] : this.resequence(order);
    const scope = order[0];
    return [...moved, ...(scope ? this.pruneMerges(scope.year, scope.month) : [])];
  }
  private pruneMerges(year: number, month: number): Statement[] {
    return [{ sql: `DELETE FROM cell_merges AS m WHERE m.year=? AND m.month=? AND (
      EXISTS(SELECT 1 FROM json_each(m.line_ids) j LEFT JOIN month_lines l ON l.id=j.value
        WHERE l.id IS NULL OR l.year<>m.year OR l.month<>m.month OR l.section<>m.section)
      OR EXISTS(SELECT 1 FROM json_each(m.line_ids) a JOIN json_each(m.line_ids) b ON CAST(b.key AS INTEGER)=CAST(a.key AS INTEGER)+1
        JOIN month_lines la ON la.id=a.value JOIN month_lines lb ON lb.id=b.value
        WHERE la.sort>=lb.sort OR EXISTS(SELECT 1 FROM month_lines other WHERE other.year=m.year AND other.month=m.month AND other.sort>la.sort AND other.sort<lb.sort))
    )`, params: [year, month] }];
  }
  private resequence(order: { id: string; sort: number }[]): Statement[] {
    return order.flatMap((row, index) => row.sort === index ? [] : [toStatement(this.db.update(s.monthLines).set({ sort: index }).where(eq(s.monthLines.id, row.id)))]);
  }
  private dropUnused(transfers: s.Transfer[], rows: { transfer_key: string | null }[]): Statement[] {
    const used = new Set(rows.map(l => l.transfer_key));
    return transfers.filter(t => !used.has(t.series_id)).map(t => toStatement(this.db.delete(s.transfers).where(eq(s.transfers.id, t.id))));
  }

  // ── 설정: 카테고리·결제수단·계좌 ───────────────────────────
  async saveCategory(name: string, id?: string) {
    name = nameValue.parse(name); await this.init();
    const rows = await this.db.select().from(s.categories);
    if (rows.some(c => c.name === name && c.id !== id)) throw new InputError('같은 이름의 카테고리가 있습니다.');
    if (id) {
      if (!rows.some(c => c.id === id)) throw new InputError('카테고리를 찾을 수 없습니다.');
      await this.store.batch([toStatement(this.db.update(s.categories).set({ name }).where(eq(s.categories.id, id)))]);
    } else await this.store.batch(this.insert(s.categories, [{ id: crypto.randomUUID(), name, sort: Math.max(-1, ...rows.map(c => c.sort)) + 1 }]));
  }
  async deleteCategory(id: string) {
    await this.init();
    if ((await this.db.select({ id: s.monthLines.id }).from(s.monthLines).where(eq(s.monthLines.category_id, id)).limit(1)).length) throw new InputError('사용 중인 카테고리입니다. 모든 달의 해당 항목에서 카테고리를 바꾼 뒤 삭제하세요.');
    if (!(await this.db.select({ id: s.categories.id }).from(s.categories).where(eq(s.categories.id, id))).length) throw new InputError('카테고리를 찾을 수 없습니다.');
    await this.store.batch([toStatement(this.db.delete(s.categories).where(eq(s.categories.id, id)))]);
  }
  async savePayment(name: string, kind: 'card' | 'account', owner: string, id?: string, settings: Partial<NotificationSettings> = {}) {
    name = nameValue.parse(name); owner = nameValue.parse(owner); await this.init();
    const rows = await this.db.select().from(s.paymentMethods);
    const previous = rows.find(m => m.id === id);
    const notification = notificationSettingsSchema.parse({ ...(previous ?? { billing_kind: kind === 'account' ? 'transfer' : 'debit' }), ...settings });
    notification.notify_app = notification.notify_app || null;
    notification.notify_keyword = notification.notify_keyword || null;
    if (rows.some(m => m.name === name && m.id !== id)) throw new InputError('같은 이름의 결제수단이 있습니다.');
    if (id) {
      if (!rows.some(m => m.id === id)) throw new InputError('결제수단을 찾을 수 없습니다.');
      await this.store.batch([toStatement(this.db.update(s.paymentMethods).set({ name, kind, owner, ...notification }).where(eq(s.paymentMethods.id, id)))]);
    } else await this.store.batch(this.insert(s.paymentMethods, [{ id: crypto.randomUUID(), name, kind, owner, ...notification }]));
  }
  // 이름으로 결제수단을 찾고, 없으면 그 이름으로 만든다. 종류는 이름에 '카드'가 있으면 카드, 아니면 계좌로 두고 설정에서 고친다.
  async ensurePayment(name: string): Promise<string> {
    name = nameValue.parse(name); await this.init();
    const find = async () => (await this.db.select({ id: s.paymentMethods.id }).from(s.paymentMethods).where(eq(s.paymentMethods.name, name)))[0]?.id;
    const found = await find();
    if (found) return found;
    await this.savePayment(name, name.includes('카드') ? 'card' : 'account', '공통');
    return (await find())!;
  }
  async deletePayment(id: string) {
    await this.init();
    if ((await this.db.select({ id: s.monthLines.id }).from(s.monthLines).where(eq(s.monthLines.payment_method_id, id)).limit(1)).length || (await this.db.select({ id: s.matchRules.id }).from(s.matchRules).where(eq(s.matchRules.payment_method_id, id)).limit(1)).length) throw new InputError('사용 중인 결제수단입니다. 항목과 매칭 규칙에서 연결을 바꾼 뒤 삭제하세요.');
    if (!(await this.db.select({ id: s.paymentMethods.id }).from(s.paymentMethods).where(eq(s.paymentMethods.id, id))).length) throw new InputError('결제수단을 찾을 수 없습니다.');
    await this.store.batch([toStatement(this.db.delete(s.paymentMethods).where(eq(s.paymentMethods.id, id)))]);
  }
  async saveAccount(name: string, kind: s.Account['kind'], target: number | null, id?: string) {
    name = nameValue.parse(name); accountKind.parse(kind); if (target !== null) money.parse(target); await this.init();
    const rows = await this.db.select().from(s.accounts);
    if (rows.some(a => a.name === name && a.id !== id)) throw new InputError('같은 이름의 계좌가 있습니다.');
    if (id) {
      if (!rows.some(a => a.id === id)) throw new InputError('계좌를 찾을 수 없습니다.');
      await this.store.batch([toStatement(this.db.update(s.accounts).set({ name, kind, target }).where(eq(s.accounts.id, id)))]);
    } else await this.store.batch(this.insert(s.accounts, [{ id: crypto.randomUUID(), name, kind, target, sort: Math.max(-1, ...rows.map(a => a.sort)) + 1 }]));
  }
  async deleteAccount(id: string) {
    await this.init();
    if (!(await this.db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.id, id))).length) throw new InputError('계좌를 찾을 수 없습니다.');
    // 잔액 기록은 계좌와 함께 지워진다(ON DELETE CASCADE).
    await this.store.batch([toStatement(this.db.delete(s.accounts).where(eq(s.accounts.id, id)))]);
  }
  async setBalance(id: string, year: number, month: number, amount: number | null) {
    yearValue.parse(year); monthValue.parse(month); if (amount !== null) signedMoney.parse(amount); await this.init();
    if (!(await this.db.select({ id: s.accounts.id }).from(s.accounts).where(eq(s.accounts.id, id))).length) throw new InputError('계좌를 찾을 수 없습니다.');
    const at = and(eq(s.accountBalances.account_id, id), eq(s.accountBalances.year, year), eq(s.accountBalances.month, month));
    if (amount === null) { await this.store.batch([toStatement(this.db.delete(s.accountBalances).where(at))]); return; }
    await this.store.batch([toStatement(this.db.insert(s.accountBalances).values({ id: crypto.randomUUID(), account_id: id, year, month, amount })
      .onConflictDoUpdate({ target: [s.accountBalances.account_id, s.accountBalances.year, s.accountBalances.month], set: { amount } }))]);
  }

  // ── JSON 내보내기·가져오기 ─────────────────────────────────
  private async archiveFrom(): Promise<Archive> {
    const tables = {
      members: s.members, invites: s.invites, categories: s.categories, payment_methods: s.paymentMethods,
      ledger_months: s.ledgerMonths, month_lines: s.monthLines, special_expenses: s.specialExpenses,
      entries: s.entries, budget_adjustments: s.budgetAdjustments, saving_years: s.savingYears,
      saving_uses: s.savingUses, match_rules: s.matchRules, transfers: s.transfers,
      accounts: s.accounts, account_balances: s.accountBalances, notification_events: s.notificationEvents,
      cell_merges: s.cellMerges,
    };
    // UNION ALL 한 조회는 모든 표를 같은 SQLite 읽기 시점으로 본다.
    // 알림 수신 batch가 중간에 끼어 거래만 빠지거나 중복 방지 기록만 남는 백업을 만들지 않는다.
    // 이름은 위의 고정 스키마에서만 오고, 바인딩 값 없이 실행해 D1의 100개 제한도 지킨다.
    const literal = (name: string) => sql.raw(`'${name.replaceAll("'", "''")}'`);
    const queries = Object.entries(tables).map(([name, table]) => {
      const fields = Object.entries(getTableColumns(table)).flatMap(([key, column]) => [literal(key), sql`${column}`]);
      return sql`SELECT ${literal(name)} AS table_name, json_object(${sql.join(fields, sql`,`)}) AS row_json FROM ${table}`;
    });
    const rows = await this.db.all<{ table_name: keyof typeof tables; row_json: string }>(sql.join(queries, sql` UNION ALL `));
    const data: Record<string, Record<string, unknown>[]> = Object.fromEntries(Object.keys(tables).map(name => [name, []]));
    for (const row of rows) {
      const parsed = JSON.parse(row.row_json) as Record<string, unknown>;
      const columns: Record<string, { mapFromDriverValue(value: unknown): unknown }> = getTableColumns(tables[row.table_name]);
      data[row.table_name].push(Object.fromEntries(Object.entries(parsed).map(([key, value]) =>
        [key, value === null ? null : columns[key].mapFromDriverValue(value)])));
    }
    return { app: 'couple-ledger', version: 1, exported_at: new Date().toISOString(), data: data as unknown as Archive['data'] };
  }
  async exportArchive() {
    await this.init();
    return this.archiveFrom();
  }
  // 바꾸기 전 내용은 store.saveBackup으로 보관한다(로컬: data/backups/ 파일, D1: 없음 → null).
  async importArchive(input: unknown) {
    const archive = validateArchive(input); await this.init();
    const backupPath = await this.store.saveBackup(JSON.stringify(await this.archiveFrom(), null, 2));
    const d = archive.data;
    await this.store.batch([
      { sql: 'DELETE FROM edit_operations', params: [] },
      toStatement(this.db.delete(s.cellMerges)),
      ...[s.notificationEvents, s.accountBalances, s.accounts, s.matchRules, s.transfers, s.entries, s.budgetAdjustments, s.savingUses, s.specialExpenses,
        s.monthLines, s.ledgerMonths, s.savingYears, s.invites, s.paymentMethods, s.categories, s.members].map(table => toStatement(this.db.delete(table))),
      ...this.insert(s.members, d.members), ...this.insert(s.invites, d.invites), ...this.insert(s.categories, d.categories),
      ...this.insert(s.paymentMethods, d.payment_methods), ...this.insert(s.ledgerMonths, d.ledger_months), ...this.insert(s.monthLines, d.month_lines),
      ...this.insert(s.specialExpenses, d.special_expenses), ...this.insert(s.entries, d.entries), ...this.insert(s.budgetAdjustments, d.budget_adjustments),
      ...this.insert(s.savingYears, d.saving_years), ...this.insert(s.savingUses, d.saving_uses), ...this.insert(s.matchRules, d.match_rules),
      ...this.insert(s.transfers, d.transfers), ...this.insert(s.accounts, d.accounts), ...this.insert(s.accountBalances, d.account_balances),
      ...this.insert(s.notificationEvents, d.notification_events),
      ...this.insert(s.cellMerges, d.cell_merges),
    ]);
    return backupPath;
  }

  // 여러 줄 INSERT를 store가 받는 값 개수(D1은 100개)에 맞게 나눈다. ignore: 이미 있으면 건너뜀.
  private insert<T extends SQLiteTable>(table: T, rows: T['$inferInsert'][], ignore = false): Statement[] {
    if (!rows.length) return [];
    const size = Math.max(1, Math.floor(this.store.maxParams / Object.keys(getTableColumns(table)).length));
    const statements: Statement[] = [];
    for (let i = 0; i < rows.length; i += size) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const query = (this.db.insert(table) as any).values(rows.slice(i, i + size));
      statements.push(toStatement(ignore ? query.onConflictDoNothing() : query));
    }
    return statements;
  }
}
