'use client';
import { useState } from 'react';
import type { Snapshot } from './ledger-app';
import type { ComputedLine } from '../lib/calculations';
import { parseMoney } from '../lib/validation';
import { won } from '../lib/labels';
export function SpecialPanel({ data, month, lines, busy, perform, onError }: { data: Snapshot; month: number; lines: ComputedLine[]; busy: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false); const [funding, setFunding] = useState('line');
  const asked = data.months.find(m => m.month === month)?.special_prompt_seen;
  const expenses = data.specials.filter(e => e.month === month);
  const donors = lines.filter(l => ['fixed', 'variable'].includes(l.section) && !l.series_id.startsWith('special:'));
  return <section className="special-panel">
    {!asked && <div className="special-question"><p>이번 달 특별 지출이 있나요?</p><div className="actions"><button disabled={busy} onClick={async () => { if (await perform({ type: 'prompt', year: data.year, month })) setOpen(true); }}>있어요</button><button disabled={busy} onClick={() => { void perform({ type: 'prompt', year: data.year, month }); }}>지금은 없어요</button></div></div>}
    <button disabled={busy} onClick={() => setOpen(!open)}>{open ? '특별 지출 입력 닫기' : '+ 특별 지출 추가'}</button>
    {open && <form className="line-form" onSubmit={async e => {
      e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form);
      try {
        const amount = parseMoney(String(fields.get('amount'))) ?? 0;
        if (await perform({ type: 'special', year: data.year, month, name: fields.get('name'), amount, funding, from_line_id: funding === 'line' ? fields.get('donor') : null })) { form.reset(); setOpen(false); }
      } catch (error) { onError(error instanceof Error ? error.message : '금액을 확인하세요.'); }
    }}><div className="form-grid">
      <label>특별 지출 이름<input name="name" placeholder="경조사" required maxLength={120}/></label><label>특별 지출 금액<input name="amount" inputMode="numeric" required placeholder="100000"/></label>
      <label>재원<select aria-label="특별 지출 재원" value={funding} onChange={e => setFunding(e.target.value)}><option value="line">항목 예산에서 빼기</option><option value="saving">저축에서 사용</option></select></label>
      {funding === 'line' && <label>가져올 항목<select name="donor" required aria-label="재원 항목">{donors.map(l => <option key={l.id} value={l.id}>{l.name} · 예산 {won(l.effectiveBudget)}원</option>)}</select></label>}
    </div><p className="muted">{funding === 'line' ? '이번 달 항목 예산을 옮겨 일회성 지출 줄을 만듭니다. 다음 달에는 기본 예산을 이어받습니다.' : '저축 화면의 사용과 자산에 반영합니다. 월별 표의 예산은 그대로입니다.'}</p><div className="actions"><button className="primary" disabled={busy}>특별 지출 저장</button><button type="button" onClick={() => setOpen(false)}>취소</button></div></form>}
    {expenses.length > 0 && <div className="special-list">{expenses.map(e => <div key={e.id}><span>{e.name} · {won(e.amount)}원 <small>{e.funding === 'saving' ? '저축에서 사용' : '항목 예산에서 가져옴'}</small></span><button className="danger" disabled={busy} onClick={() => { if (confirm(`“${e.name}” 특별 지출을 취소하고 재원을 복원할까요?`)) void perform({ type: 'special-delete', id: e.id }); }}>특별 지출 취소</button></div>)}</div>}
  </section>;
}
