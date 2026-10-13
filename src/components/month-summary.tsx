import type { monthTotals } from '../lib/calculations';
import { won } from '../lib/labels';
// 표 위 한 줄 요약: 남은 돈을 먼저, 쓴 돈·들어온 돈·미입력을 옆에 둔다.
export function MonthSummary({ totals, pending }: { totals: ReturnType<typeof monthTotals>; pending: number }) {
  const { expense, income, balance } = totals;
  return <dl className="month-summary" aria-label="이번 달 요약">
    <div className="lead"><dt>수입-지출</dt><dd className={balance.actual < 0 ? 'minus' : ''}>{won(balance.actual)}</dd></div>
    <div><dt>쓴 돈</dt><dd>{won(expense.actual)}<span> / 예산 {won(expense.budget)}</span></dd></div>
    <div><dt>들어온 돈</dt><dd>{won(income.actual)}</dd></div>
    <div><dt>미입력</dt><dd>{pending}<span>건</span></dd></div>
  </dl>;
}
