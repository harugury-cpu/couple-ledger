'use client';
import { useRef, useState } from 'react';
import { moneyFormula, parseMoney } from '../lib/validation';
import { won } from '../lib/labels';
// parts: 이 칸을 이루는 기록이 둘 이상이면 누를 때 =a+b+c 식으로 열고, 좁은 칸 아래에 같은 식을 크게 띄운다.
export function MoneyCell({ value, label, disabled, signed = false, parts, onSave, onError }: { value: number | null; label: string; disabled?: boolean; signed?: boolean; parts?: number[]; onSave: (n: number | null) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [tip, setTip] = useState<{ right: number; top: number } | null>(null);
  const formula = parts && parts.length > 1 ? moneyFormula(parts) : null;
  const cancelled = useRef(false);
  const display = value === null ? '' : won(value);
  return <><input className={`money-input${value ? '' : ' is-empty'}`} aria-label={label} title={formula ?? undefined} inputMode={signed || formula ? 'text' : 'numeric'} value={draft ?? display} placeholder="—" disabled={disabled}
    onFocus={e => {
      setDraft(formula ?? (value === null ? '' : String(value)));
      if (formula) { const box = e.currentTarget.getBoundingClientRect(); setTip({ right: Math.max(8, document.documentElement.clientWidth - box.right), top: box.bottom + 4 }); }
    }} onChange={e => setDraft(e.target.value)}
    onBlur={() => { setTip(null);
      if (cancelled.current || draft === null) { cancelled.current = false; setDraft(null); return; }
      try { const next = parseMoney(draft, signed); if (next !== value) onSave(next); } catch (e) { onError(e instanceof Error ? e.message : '금액을 확인하세요.'); }
      setDraft(null);
    }} onKeyDown={e => { if (e.key === 'Enter') { const table = e.currentTarget.closest('table'); e.currentTarget.blur(); table?.focus({ preventScroll: true }); } if (e.key === 'Escape') { cancelled.current = true; const table = e.currentTarget.closest('table'); e.currentTarget.blur(); table?.focus({ preventScroll: true }); } }} />
    {tip && formula && <span className="money-parts" role="status" style={{ right: tip.right, top: tip.top }}>{formula.replace('=', '= ')}</span>}</>;
}
