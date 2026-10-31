'use client';
import type { Snapshot } from './ledger-app';
import { won } from '../lib/labels';
// 특별 지출은 이제 표에 바로 줄을 적어 기록한다. 예전에 만든 특별 지출이 있는 달만 목록을 보여 주고, 취소하면 재원을 되돌린다.
export function SpecialPanel({ data, month, busy, perform }: { data: Snapshot; month: number; busy: boolean; perform: (command: object) => Promise<unknown> }) {
  const expenses = data.specials.filter(e => e.month === month);
  if (!expenses.length) return null;
  return <section className="special-panel">
    <div className="special-list">{expenses.map(e => <div key={e.id}><span>{e.name} · {won(e.amount)}원 <small>{e.funding === 'saving' ? '저축에서 사용' : '항목 예산에서 가져옴'}</small></span><button className="danger" disabled={busy} onClick={() => { if (confirm(`“${e.name}” 특별 지출을 취소하고 재원을 복원할까요?`)) void perform({ type: 'special-delete', id: e.id }); }}>특별 지출 취소</button></div>)}</div>
  </section>;
}
