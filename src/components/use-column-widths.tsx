'use client';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

// 표 머리줄 칸의 오른쪽 끝을 끌어 열 너비를 바꾼다(월별 표·자산 표 공용).
// 이 기기 브라우저에만 key별로 저장하고, 끝을 두 번 누르면 원래 너비로 돌아간다. 열 수가 바뀌면 저장한 값은 버린다.
export function useColumnWidths(key: string, count: number) {
  const [widths, setWidths] = useState<number[] | null>(null);
  const head = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); setWidths(Array.isArray(saved) && saved.length === count && saved.every(n => typeof n === 'number' && n > 0) ? saved : null); }
    catch { setWidths(null); }
  }, [key, count]);
  const resize = (col: number) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0 || !head.current) return;
    e.preventDefault(); e.stopPropagation();
    // 처음 끌 때 지금 보이는 너비를 모두 고정해야 한 열만 바뀌고 나머지는 그대로 있다.
    const start = widths ?? [...head.current.children].map(th => Math.round(th.getBoundingClientRect().width));
    const handle = e.currentTarget; const x = e.clientX; let next = start;
    handle.setPointerCapture(e.pointerId); handle.classList.add('active');
    const move = (m: PointerEvent) => { next = start.map((w, i) => i === col ? Math.max(40, Math.round(w + m.clientX - x)) : w); setWidths(next); };
    const end = () => {
      handle.classList.remove('active');
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 저장이 막힌 브라우저에서는 이번 화면에서만 유지된다. */ }
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  const reset = () => { setWidths(null); try { localStorage.removeItem(key); } catch { /* 위와 같다. */ } };
  return {
    widths, head,
    tableStyle: (widths ? { width: widths.reduce((a, b) => a + b, 0) } : undefined) as CSSProperties | undefined,
    width: (col: number): CSSProperties | undefined => widths ? { width: widths[col], minWidth: widths[col], maxWidth: widths[col] } : undefined,
    handle: (col: number): ReactNode => <span className="col-resize" aria-hidden="true" title="끌어서 열 너비 조절 · 두 번 누르면 원래 너비" onPointerDown={resize(col)} onDoubleClick={reset} />,
  };
}
