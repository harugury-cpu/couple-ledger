'use client';
import type { Snapshot } from './ledger-app';
import { annualCategories, computeLines, monthTotals } from '../lib/calculations';
import { won } from '../lib/labels';
import { BudgetCharts } from './summary-charts';

// Numbers '예산' 시트와 같은 구성: 위에 도넛과 막대 차트, 아래에 카테고리별 요약 표
export function BudgetView({ data, month }: { data: Snapshot; month: number }) {
  const lines = computeLines(data.lines, data.entries, data.adjustments);
  const rows = annualCategories(lines, data.categories, month);
  const monthly = Array.from({ length: 12 }, (_, i) => monthTotals(lines.filter(l => l.month === i + 1)));
  const selected = monthly[month - 1];
  const activeMonths = new Set(data.months.map(m => m.month));
  return <>
    <div className="section-heading"><div><h2>월별 예산</h2><p className="muted">{data.year}년 실사용 · 예산 열은 {month}월 기준입니다.</p></div></div>
    <BudgetCharts rows={rows} activeMonths={[...activeMonths].sort((a, b) => a - b)} />
    <p className="table-title">카테고리별 요약</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="카테고리별 연간 요약 표">
      <table className="annual-table">
        <thead><tr>
          <th scope="col">카테고리</th><th scope="col" className="numeric budget-col">예산</th>
          {monthly.map((_, i) => <th key={i} className={`numeric ${i + 1 === month ? 'selected-month' : ''}`} scope="col">{i + 1}월</th>)}
        </tr></thead>
        <tbody>{rows.map(r => <tr key={r.id}>
          <th scope="row">{r.name}</th><td className="numeric budget-col">{won(r.budget)}</td>
          {r.months.map((value, i) => <td key={i} className="numeric">{activeMonths.has(i + 1) ? won(value) : ''}</td>)}
        </tr>)}</tbody>
        <tfoot>{(['expense', 'income', 'balance'] as const).map((key, i) => <tr key={key}>
          <th scope="row">{['총계', '수입', '수입-지출'][i]}</th><td className="numeric budget-col">{won(selected[key].budget)}</td>
          {monthly.map((m, j) => <td key={j} className={`numeric ${activeMonths.has(j + 1) && m[key].actual < 0 ? 'minus' : ''}`}>{activeMonths.has(j + 1) ? won(m[key].actual) : ''}</td>)}
        </tr>)}</tfoot>
      </table>
    </div>
    <p className="table-note">단위: 원 · 아직 열지 않은 달은 비워 둡니다.</p>
  </>;
}
