'use client';
import { useRef, useState } from 'react';
import { parseMoney } from '../lib/validation';
import { won } from '../lib/labels';
export function MoneyCell({ value, label, disabled, signed = false, onSave, onError }: { value: number | null; label: string; disabled?: boolean; signed?: boolean; onSave: (n: number | null) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const display = value === null ? '' : won(value);
  return <input className={`money-input${value ? '' : ' is-empty'}`} aria-label={label} inputMode={signed ? 'text' : 'numeric'} value={draft ?? display} placeholder="—" disabled={disabled}
    onFocus={() => setDraft(value === null ? '' : String(value))} onChange={e => setDraft(e.target.value)}
    onBlur={() => {
      if (cancelled.current || draft === null) { cancelled.current = false; setDraft(null); return; }
      try { const next = parseMoney(draft, signed); if (next !== value) onSave(next); } catch (e) { onError(e instanceof Error ? e.message : '금액을 확인하세요.'); }
      setDraft(null);
    }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } }} />;
}
