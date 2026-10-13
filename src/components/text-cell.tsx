'use client';
import { useRef, useState, type Ref } from 'react';
// 글자 칸: 금액 칸처럼 칸 안에서 고치고, 칸을 벗어나거나 Enter를 누르면 저장한다. Esc는 되돌린다.
export function TextCell({ value, label, disabled, onSave, placeholder, className = '', list, inputRef }: {
  value: string; label: string; disabled?: boolean; onSave: (text: string) => void;
  placeholder?: string; className?: string; list?: string; inputRef?: Ref<HTMLInputElement>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return <input ref={inputRef} className={`text-input ${className}`} aria-label={label} value={draft ?? value} maxLength={120} disabled={disabled} placeholder={placeholder} list={list}
    onFocus={() => setDraft(value)} onChange={e => setDraft(e.target.value)}
    onBlur={() => { if (!cancelled.current && draft !== null && draft.trim() !== value) onSave(draft.trim()); cancelled.current = false; setDraft(null); }}
    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; e.currentTarget.blur(); } }} />;
}
