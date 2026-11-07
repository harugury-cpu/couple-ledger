import { InputError } from './input-error';
import type { Account, AccountBalance, Adjustment, Category, Entry, MonthLine, Transfer } from '../db/schema';
export function safeSum(values: number[]): number {
  const sum = values.reduce((acc, n) => acc + BigInt(n), 0n);
  if (sum > BigInt(Number.MAX_SAFE_INTEGER) || sum < BigInt(Number.MIN_SAFE_INTEGER)) throw new InputError('합계가 정수 계산의 안전 범위를 넘습니다.');
  return Number(sum);
}
export type ComputedLine = MonthLine & { actual: number; effectiveBudget: number; hasEntry: boolean; parts: number[] };
export function computeLines(lines: MonthLine[], entries: Entry[], adjustments: Adjustment[]): ComputedLine[] {
  const amounts = new Map<string, bigint>();
  const changes = new Map<string, bigint>();
  // parts: 금액 칸을 이루는 입력 기록들(넣은 순서). 칸을 누르면 = a + b + c 로 보여 준다.
  const parts = new Map<string, number[]>();
  for (const e of [...entries].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    amounts.set(e.month_line_id, (amounts.get(e.month_line_id) ?? 0n) + BigInt(e.amount));
    parts.set(e.month_line_id, [...(parts.get(e.month_line_id) ?? []), e.amount]);
  }
  for (const a of adjustments) changes.set(a.month_line_id, (changes.get(a.month_line_id) ?? 0n) + BigInt(a.amount));
  return lines.map(l => {
    const actual = amounts.get(l.id) ?? 0n; const budget = BigInt(l.budget) + (changes.get(l.id) ?? 0n);
    const checked = (n: bigint) => { if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new InputError('합계가 정수 계산의 안전 범위를 넘습니다.'); return Number(n); };
    return { ...l, actual: checked(actual), effectiveBudget: checked(budget), hasEntry: amounts.has(l.id), parts: parts.get(l.id) ?? [] };
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
    return { ...t, lineCount: own.length, budget: total(own).budget, spent, remaining: safeSum([t.amount, -spent]) };
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
// through: 자산 누적을 이 달까지만 센다. 자동 줄은 앞으로 올 달 금액도 미리 채워 두므로, 아직 하지 않은 저축이 자산에 들어가지 않게 한다.
export function savingsRows(year: number, lines: ComputedLine[], uses: { year: number; month: number; amount: number }[], opening: number, through?: { year: number; month: number }) {
  let assets = opening;
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1; const saving = lines.filter(l => l.year === year && l.month === month && l.section === 'saving');
    const a = total(saving.filter(l => l.saving_owner === 'a')).actual;
    const b = total(saving.filter(l => l.saving_owner === 'b')).actual;
    const extra = total(saving.filter(l => l.saving_owner === 'extra')).actual;
    const used = safeSum(uses.filter(u => u.year === year && u.month === month).map(u => u.amount));
    if (!through || year * 12 + month <= through.year * 12 + through.month) assets = safeSum([assets, a, b, extra, -used]);
    return { month, a, b, extra, used, assets };
  });
}

// 자산 탭: 저축·투자 계좌는 행, 달은 열. 원금은 계좌에 연결한 월별 표 저축 줄의 금액(인출은 마이너스로 적는다).
// 계좌마다 기록 시작 달(start_month)부터 센다: 시작 원금은 그 달 전까지 넣은 원금이고, 그 전 달 칸은 비운다.
// 표에는 그 해에 시작한 계좌 중 가장 이른 시작 달부터 12월까지 보인다. 금액이 적힌 달은 앞으로 올 달이어도 원금에 넣는다.
// 평가금액: 투자는 그 해 말까지 적은 마지막 값(없으면 원금으로 센다), 저축은 이자를 계산하지 않으므로 원금과 같다.
export function assetRows(accounts: Account[], lines: ComputedLine[], balances: AccountBalance[], carry: Record<string, number>, year: number) {
  const startOf = (a: Account) => a.start_month ? Number(a.start_month.slice(0, 4)) * 12 + Number(a.start_month.slice(5, 7)) : -Infinity;
  const tracked = accounts.filter(a => a.kind !== 'reserved' && startOf(a) <= year * 12 + 12);
  const first = Math.min(12, ...tracked.map(a => Math.max(1, startOf(a) - year * 12)));
  const visible = Array.from({ length: 13 - first }, (_, i) => first + i);
  const rows = tracked.map(account => {
    const series = new Set(JSON.parse(account.series) as string[]);
    const start = startOf(account);
    const months = visible.map(month => {
      const own = lines.filter(l => l.year === year && l.month === month && series.has(l.series_id));
      const counted = year * 12 + month >= start && own.some(l => l.hasEntry);
      return { month, amount: counted ? safeSum(own.map(l => l.actual)) : null };
    });
    const opening = safeSum([account.principal, carry[account.id] ?? 0]);
    const principal = safeSum([opening, ...months.map(m => m.amount ?? 0)]);
    const latest = account.kind === 'invest'
      ? balances.filter(b => b.account_id === account.id && b.year * 12 + b.month <= year * 12 + 12).sort((a, b) => (b.year * 12 + b.month) - (a.year * 12 + a.month))[0]
      : undefined;
    const value = account.kind === 'invest' ? latest?.amount ?? null : principal;
    return { account, months, opening, principal, value, checkedOn: latest?.checked_on ?? (latest ? `${latest.year}-${String(latest.month).padStart(2, '0')}` : null),
      // 증감은 평가금액을 적는 투자만 낸다. 저축은 이자를 계산하지 않으므로 비워 둔다.
      change: account.kind !== 'invest' || value === null ? null : safeSum([value, -principal]) };
  });
  const locked = accounts.filter(a => a.kind === 'reserved');
  const principal = safeSum(rows.map(r => r.principal));
  const value = safeSum(rows.map(r => r.value ?? r.principal));
  const lockedTotal = safeSum(locked.map(a => a.principal));
  // 그래프: 보이는 달마다 쌓인 원금 합계(금액이 적힌 마지막 달까지)
  const last = Math.max(0, ...rows.flatMap(r => r.months.filter(m => m.amount !== null).map(m => m.month)));
  const history = visible.filter(m => m <= last)
    .map(month => ({ month, assets: safeSum(rows.flatMap(r => [r.opening, ...r.months.filter(m => m.month <= month).map(m => m.amount ?? 0)])) }));
  return { rows, locked, visible, totals: { principal, value, locked: lockedTotal, total: safeSum([value, lockedTotal]), change: safeSum([value, -principal]) }, history };
}
