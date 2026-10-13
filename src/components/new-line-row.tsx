'use client';
import { useRef, useState } from 'react';
import type { Category, MonthLine, PaymentMethod } from '../db/schema';
import { parsePayment } from '../lib/payment';
import { sections } from '../lib/labels';
import { MoneyCell } from './money-cell';
import { TextCell } from './text-cell';

export type NewLine = { name: string; pay_day: number | null; payment_method_id: string | null; category_id: string | null; budget: number; amount: number | null; transfer: string };
type Draft = { payment: string; name: string; category_id: string; budget: number | null; amount: number | null; transfer: string };
const blank: Draft = { payment: '', name: '', category_id: '', budget: null, amount: null, transfer: '' };

// 구역 맨 아래의 빈 줄: 엑셀처럼 어느 칸에나 적고, 줄을 벗어나거나 Enter 를 누르면 그 구역에 줄이 생긴다.
// 이름이 없으면 적은 값을 그대로 두고 이름을 기다린다. Enter 로 만들면 다음 빈 줄의 이름 칸에 남는다.
export function NewLineRow({ section, odd, disabled, categories, methods, onCreate, onError }: {
  section: MonthLine['section']; odd: boolean; disabled: boolean; categories: Category[]; methods: PaymentMethod[];
  onCreate: (line: NewLine) => Promise<boolean>; onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(blank);
  const [needsName, setNeedsName] = useState(false);
  // 칸의 저장과 줄을 벗어나는 일이 같은 순간에 일어나므로, 최신 값은 ref 로도 들고 있는다.
  const latest = useRef(blank);
  const viaEnter = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const set = (change: Partial<Draft>) => { latest.current = { ...latest.current, ...change }; setDraft(latest.current); if (change.name) setNeedsName(false); };

  async function commit() {
    const d = latest.current; const stay = viaEnter.current; viaEnter.current = false;
    if (disabled) return;
    if (!d.name) { setNeedsName(Object.values(d).some(v => v !== '' && v !== null)); return; }
    let payment;
    try { payment = parsePayment(d.payment, methods); } catch (e) { onError(e instanceof Error ? e.message : '수단을 확인하세요.'); return; }
    if (!await onCreate({ name: d.name, ...payment, category_id: d.category_id || null, budget: d.budget ?? 0, amount: d.amount, transfer: d.transfer })) return;
    latest.current = blank; setDraft(blank);
    if (stay) setTimeout(() => nameInput.current?.focus(), 50);
  }
  const title = sections[section];
  return <tr className={`line add-row ${section} ${odd ? 'odd' : ''} ${needsName ? 'needs-name' : ''}`}
    onKeyDownCapture={e => { if (e.key === 'Enter') viaEnter.current = true; }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) void commit(); }}>
    <td className="d"><TextCell value={draft.payment} label={`${title} 새 줄 수단`} list="sheet-methods" disabled={disabled} onSave={payment => set({ payment })} /></td>
    <th scope="row" className="name"><TextCell className="new-line" inputRef={nameInput} value={draft.name} label={`${title} 새 줄 이름`} placeholder={needsName ? '이름을 적으면 줄이 생깁니다' : '+ 행'} disabled={disabled} onSave={name => set({ name })} /></th>
    <td className="d">
      <select className={`cell-select${draft.category_id ? '' : ' is-empty'}`} aria-label={`${title} 새 줄 카테고리`} value={draft.category_id} disabled={disabled} onChange={e => set({ category_id: e.target.value })}>
        <option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </td>
    <td className="num"><MoneyCell value={draft.budget} label={`${title} 새 줄 기본 예산`} disabled={disabled} onError={onError} onSave={budget => set({ budget })} /></td>
    <td className="num"><MoneyCell value={draft.amount} signed label={`${title} 새 줄 금액`} disabled={disabled} onError={onError} onSave={amount => set({ amount })} /></td>
    <td className="d"><TextCell value={draft.transfer} label={`${title} 새 줄 이체 계좌`} list="sheet-accounts" disabled={disabled} onSave={transfer => set({ transfer })} /></td>
    <td className="d" /><td className="d" />
  </tr>;
}
