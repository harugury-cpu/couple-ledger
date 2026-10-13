import type { Account, AccountBalance, Adjustment, Category, Entry, MonthLine, Transfer } from '../db/schema';
export function safeSum(values: number[]): number {
  const sum = values.reduce((acc, n) => acc + BigInt(n), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('합계가 정수 계산의 안전 범위를 넘습니다.');
  return Number(sum);
}
export type ComputedLine = MonthLine & { actual: number; effectiveBudget: number; hasEntry: boolean };
export function computeLines(lines: MonthLine[], entries: Entry[], adjustments: Adjustment[]): ComputedLine[] {
  const amounts = new Map<string, bigint>();
  const changes = new Map<string, bigint>();
  for (const e of entries) amounts.set(e.month_line_id, (amounts.get(e.month_line_id) ?? 0n) + BigInt(e.amount));
  for (const a of adjustments) changes.set(a.month_line_id, (changes.get(a.month_line_id) ?? 0n) + BigInt(a.amount));
  return lines.map(l => {
    const actual = amounts.get(l.id) ?? 0n; const budget = BigInt(l.budget) + (changes.get(l.id) ?? 0n);
    const checked = (n: bigint) => { if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error('합계가 정수 계산의 안전 범위를 넘습니다.'); return Number(n); };
    return { ...l, actual: checked(actual), effectiveBudget: checked(budget), hasEntry: amounts.has(l.id) };
  });
}
export function total(lines: ComputedLine[]) {
  return { budget: safeSum(lines.map(l => l.effectiveBudget)), actual: safeSum(lines.map(l => l.actual)) };
}
// 이체 계좌 묶음마다 옮긴 돈에서 그 묶음 줄들이 쓴 돈을 뺀 남은 돈을 계산한다.
export function transferRows(lines: ComputedLine[], transfers: Transfer[]) {
  return transfers.map(t => {
    const own = lines.filter(l => l.year === t.year && l.month === t.month && l.transfer_key === t.series_id);
    const spent = safeSum(own.map(l => l.actual));
    return { ...t, lineCount: own.length, spent, remaining: safeSum([t.amount, -spent]) };
  });
}
export function monthTotals(lines: ComputedLine[]) {
  const expense = total(lines.filter(l => l.section !== 'income'));
  const income = total(lines.filter(l => l.section === 'income'));
  return { expense, income, balance: { budget: safeSum([income.budget, -expense.budget]), actual: safeSum([income.actual, -expense.actual]) } };
}
export function categoryTotals(lines: ComputedLine[], categories: Category[]) {
  return categories.map(c => ({ ...c, ...total(lines.filter(l => l.section !== 'income' && l.category_id === c.id)) }));
}
export function annualCategories(lines: ComputedLine[], categories: Category[], selectedMonth: number) {
  const rows = [...categories];
  if (lines.some(l => l.section !== 'income' && !l.category_id)) rows.push({ id: 'uncategorized', name: '미분류', sort: rows.length });
  return rows.map(c => {
    const matching = lines.filter(l => l.section !== 'income' && (c.id === 'uncategorized' ? !l.category_id : l.category_id === c.id));
    return { ...c, budget: total(matching.filter(l => l.month === selectedMonth)).budget,
      months: Array.from({ length: 12 }, (_, i) => total(matching.filter(l => l.month === i + 1)).actual) };
  });
}
// 계좌 잔액: 고른 달에 적은 값이 없으면 그 전에 마지막으로 적은 값으로 센다.
// 증감은 고른 달에 적은 값이 있을 때만, 바로 앞 기록과 비교한다.
const monthIndex = (r: { year: number; month: number }) => r.year * 12 + r.month;
export function accountRows(accounts: Account[], balances: AccountBalance[], year: number, month: number) {
  const at = monthIndex({ year, month });
  return accounts.map(a => {
    const [latest, before] = balances.filter(b => b.account_id === a.id && monthIndex(b) <= at).sort((x, y) => monthIndex(y) - monthIndex(x));
    const entered = latest && monthIndex(latest) === at ? latest : null;
    return { ...a, entered: entered?.amount ?? null, latest: latest ?? null, previous: entered ? before ?? null : null,
      change: entered && before ? safeSum([entered.amount, -before.amount]) : null };
  });
}
export function accountTotals(rows: ReturnType<typeof accountRows>) {
  const sum = (kind?: Account['kind']) => safeSum(rows.filter(r => !kind || r.kind === kind).map(r => r.latest?.amount ?? 0));
  return { ready: sum('ready'), reserved: sum('reserved'), invest: sum('invest'), total: sum() };
}
// 그래프용 월별 합계: 기록이 하나라도 있는 달부터, 그 해에 잔액을 적은 마지막 달까지 만든다.
// 아직 아무것도 적지 않은 달을 0으로 그리면 갑자기 늘어난 것처럼 보이므로 뺀다.
export function balanceHistory(accounts: Account[], balances: AccountBalance[], year: number) {
  const known = new Set(accounts.map(a => a.id));
  const last = Math.max(0, ...balances.filter(b => b.year === year && known.has(b.account_id)).map(b => b.month));
  return Array.from({ length: last }, (_, i) => accountRows(accounts, balances, year, i + 1))
    .flatMap((rows, i) => rows.some(r => r.latest) ? [{ month: i + 1, assets: accountTotals(rows).total }] : []);
}
export function savingsRows(year: number, lines: ComputedLine[], uses: { year: number; month: number; amount: number }[], opening: number) {
  let assets = opening;
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1; const saving = lines.filter(l => l.year === year && l.month === month && l.section === 'saving');
    const a = total(saving.filter(l => l.saving_owner === 'a')).actual;
    const b = total(saving.filter(l => l.saving_owner === 'b')).actual;
    const extra = total(saving.filter(l => l.saving_owner === 'extra')).actual;
    const used = safeSum(uses.filter(u => u.year === year && u.month === month).map(u => u.amount));
    assets = safeSum([assets, a, b, extra, -used]);
    return { month, a, b, extra, used, assets };
  });
}
