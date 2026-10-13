'use client';
import type { Snapshot } from './ledger-app';
import { computeLines, savingsRows } from '../lib/calculations';
import { won } from '../lib/labels';
import { MoneyCell } from './money-cell';
import { SavingsChart } from './summary-charts';
import { useOwnerNames } from './owner-names';
export function SavingsView({ data, busy, perform, onError }: { data: Snapshot; busy: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void }) {
  const owners = useOwnerNames();
  const opening = data.years.find(y => y.year === data.year)?.opening_balance ?? 0;
  const rows = savingsRows(data.year, computeLines(data.lines, data.entries, data.adjustments), data.uses, opening);
  const totals = { a: 0, b: 0, extra: 0, used: 0, assets: rows[11].assets };
  rows.forEach(r => { totals.a += r.a; totals.b += r.b; totals.extra += r.extra; totals.used += r.used; });
  return <><div className="section-heading"><div><h2>자산 변동</h2><p className="muted">저축 기록이 명의별로 합산됩니다. 사용액과 이월 잔액은 직접 입력합니다.</p></div></div>
    <div className="opening-row"><label htmlFor="opening">{data.year - 1}년 이월 잔액</label><MoneyCell value={opening} label="이월 잔액" signed disabled={busy} onSave={amount => { void perform({ type: 'opening', year: data.year, amount: amount ?? 0 }); }} onError={onError}/><span className="muted">원</span></div>
    <div className="table-scroll savings-scroll" tabIndex={0} role="region" aria-label="월별 자산 변동 표"><table className="savings-table"><thead><tr>{['월', `${owners.a} 저축`, `${owners.b} 저축`, '추가저축', '사용', '자산(누적)'].map(t => <th key={t} scope="col" className={t === '월' ? '' : 'numeric'}>{t}</th>)}</tr></thead>
      <tbody><tr className="subtotal"><th scope="row">이월</th><td/><td/><td/><td/><td className="numeric">{won(opening)}</td></tr>{rows.map(r => <tr key={r.month}><th scope="row">{r.month}월</th><td className="numeric">{won(r.a)}</td><td className="numeric">{won(r.b)}</td><td className="numeric">{won(r.extra)}</td><td className="numeric use-col"><MoneyCell value={r.used} label={`${r.month}월 사용`} disabled={busy} onSave={amount => { void perform({ type: 'use', year: data.year, month: r.month, amount: amount ?? 0 }); }} onError={onError}/>{data.uses.some(u => u.month === r.month && u.special_expense_id) && <small>특별 지출 포함</small>}</td><td className="numeric">{won(r.assets)}</td></tr>)}</tbody>
      <tfoot><tr><th scope="row">연간</th>{Object.entries(totals).map(([key, value]) => <td key={key} className="numeric">{won(value)}</td>)}</tr></tfoot></table></div>
    <p className="table-note">단위: 원 · 연간 자산은 12월 잔액입니다. 사용 총액에는 저축에서 낸 특별 지출이 포함됩니다.</p><SavingsChart rows={rows}/>
  </>;
}
