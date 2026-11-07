'use client';
import { cloneElement, isValidElement, Children, useEffect, useRef, useState, type ReactElement, type TdHTMLAttributes, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import type { CellMerge, MonthLine } from '../db/schema';
import { cellKey, formatClipboard, layoutAreas, manualAreas, parseClipboard, rectangle, selectionBounds, type SheetArea, type SheetChange } from '../lib/sheet-grid';

export type SheetValue = { text: string; number?: number; identity?: string };
// 표 칸 선택·복사·붙여넣기·키보드 이동·편집 시작(월별 표·자산 표 공용).
// 월별 표는 기본값(8열, 붙여넣기는 가계부 'cells' 명령, 병합 가능)을 쓰고, 다른 표는 columns·paste·mergeable로 바꾼다.
type Options = {
  year: number; month: number; lines: Pick<MonthLine, 'id' | 'section'>[]; values: SheetValue[][]; merges: CellMerge[]; automatic: SheetArea[];
  disabled: boolean; touch: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void;
  columns?: number; paste?: (changes: SheetChange[]) => Promise<unknown>; mergeable?: boolean;
  // 직접 고칠 수 없는 칸을 편집하려 할 때 보여 줄 안내(어디서 고치는지). 없으면 일반 안내.
  readOnly?: (row: number, col: number) => string;
};
let copiedText = '';
const isEditor = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"]');

export function useSheetTools({ year, month, lines, values, merges, automatic, disabled, touch, perform, onError, columns = 8, paste: pasteChanges, mergeable = true, readOnly }: Options) {
  const lastCol = columns - 1;
  const table = useRef<HTMLTableElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [touchSelection, setTouchSelection] = useState(false);
  const [editing, setEditing] = useState(false);
  const anchor = useRef({ row: 0, col: 0 }); const sweeping = useRef(false);
  const manual = manualAreas(lines as MonthLine[], merges);
  const layout = layoutAreas(lines.length, manual, automatic, columns);
  const ids = lines.map(l => l.id).join('|');
  useEffect(() => { setPicked(new Set()); }, [ids]);
  useEffect(() => {
    const stop = () => { sweeping.current = false; };
    const clear = (e: globalThis.PointerEvent) => {
      const target = e.target as Node;
      if (!table.current?.contains(target) && !toolbar.current?.contains(target)) setPicked(new Set());
    };
    window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop); window.addEventListener('pointerdown', clear);
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop); window.removeEventListener('pointerdown', clear); };
  }, []);
  const expand = (keys: Set<string>) => {
    let result = new Set(keys); let changed = true;
    while (changed) {
      changed = false;
      for (const key of [...result]) {
        const area = layout.get(key); if (!area) continue;
        for (const part of rectangle(area.row, area.row + area.rows - 1, area.col, area.col + area.cols - 1)) if (!result.has(part)) { result.add(part); changed = true; }
      }
    }
    return result;
  };
  const rangeTo = (row: number, col: number) => {
    const a = anchor.current;
    return expand(rectangle(Math.min(a.row, row), Math.max(a.row, row), Math.min(a.col, col), Math.max(a.col, col)));
  };
  const coordinate = (target: EventTarget | null) => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[data-pick]') : null;
    return cell ? { row: Number(cell.dataset.row), col: Number(cell.dataset.col) } : null;
  };
  const bounds = selectionBounds(picked);
  const rectangular = !!bounds && picked.size === (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1);
  const canMerge = mergeable && !editing && rectangular && picked.size > 1 && !!bounds && lines[bounds.top]?.section === lines[bounds.bottom]?.section;
  const selectedMerges = manual.filter(a => [...rectangle(a.row, a.row + a.rows - 1, a.col, a.col + a.cols - 1)].some(k => picked.has(k))).map(a => a.manual!);
  const matrix = () => bounds ? Array.from({ length: bounds.bottom - bounds.top + 1 }, (_, r) => Array.from({ length: bounds.right - bounds.left + 1 }, (_, c) => {
    const row = bounds.top + r; const col = bounds.left + c;
    if (!picked.has(cellKey(row, col))) return '';
    const active = document.activeElement;
    const at = coordinate(active);
    return picked.size === 1 && active instanceof HTMLInputElement && at?.row === row && at.col === col ? active.value : values[row]?.[col]?.text ?? '';
  })) : [];
  const text = () => formatClipboard(matrix());
  const copy = async () => {
    if (!picked.size) return;
    copiedText = text();
    try { await navigator.clipboard?.writeText(copiedText); } catch { /* 같은 표 안에서는 메모리의 복사본으로 붙인다. */ }
    table.current?.focus({ preventScroll: true });
  };
  const pasteText = async (raw: string) => {
    if (disabled || !picked.size) return;
    try {
      const active = document.activeElement;
      if (active instanceof HTMLElement && table.current?.contains(active) && isEditor(active)) active.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const parsed = parseClipboard(raw); const start = selectionBounds(picked)!;
      const changes: { id: string; col: number; value: string }[] = [];
      if (parsed.length === 1 && parsed[0].length === 1 && picked.size > 1) {
        for (const key of picked) { const [row, col] = key.split(':').map(Number); changes.push({ id: lines[row].id, col, value: parsed[0][0] }); }
      } else for (let r = 0; r < parsed.length; r++) for (let c = 0; c < parsed[r].length; c++) {
        const row = start.top + r; const col = start.left + c;
        if (!lines[row] || col > lastCol) throw new Error('붙여넣을 범위가 표를 벗어납니다. 필요한 행을 먼저 추가하세요.');
        changes.push({ id: lines[row].id, col, value: parsed[r][c] });
      }
      if (!pasteChanges && changes.some(c => c.col === 7)) throw new Error('남음은 자동 계산되는 칸입니다. 다른 칸을 선택하세요.');
      if (changes.length > 512) throw new Error('한 번에 512칸까지 붙여넣을 수 있습니다.');
      if (await (pasteChanges ? pasteChanges(changes) : perform({ type: 'cells', year, month, changes }))) {
        const selected = parsed.length === 1 && parsed[0].length === 1 ? picked : rectangle(start.top, start.top + parsed.length - 1, start.left, start.left + parsed[0].length - 1);
        setPicked(expand(selected)); table.current?.focus({ preventScroll: true });
      }
    } catch (e) { onError(e instanceof Error ? e.message : '붙여넣을 값을 확인하세요.'); }
  };
  const paste = async () => {
    let value = copiedText;
    try { if (navigator.clipboard?.readText) value = await navigator.clipboard.readText(); } catch { /* 권한이 없으면 표에서 복사한 값을 쓴다. */ }
    if (!value && !copiedText) { onError('붙여넣을 칸을 고른 뒤 Ctrl/⌘+V로 붙여넣으세요.'); return; }
    await pasteText(value);
  };
  const merge = async () => {
    if (!canMerge || !bounds || disabled) return;
    if (await perform({ type: 'cell-merge', year, month, ids: lines.slice(bounds.top, bounds.bottom + 1).map(l => l.id), first_col: bounds.left, last_col: bounds.right })) table.current?.focus({ preventScroll: true });
  };
  const unmerge = async () => {
    if (selectedMerges.length && !disabled) await perform({ type: 'cell-unmerge', ids: selectedMerges });
    table.current?.focus({ preventScroll: true });
  };
  const startEdit = (row: number, col: number, first?: string) => {
    const el = table.current?.querySelector<HTMLElement>(`[data-row="${row}"][data-col="${col}"]`);
    const input = el?.querySelector<HTMLInputElement>('input'); const select = el?.querySelector<HTMLSelectElement>('select');
    if (input && !input.disabled) {
      input.focus();
      requestAnimationFrame(() => {
        input.select();
        if (first !== undefined) {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, first);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    } else if (select && !select.disabled) { select.focus(); try { select.showPicker?.(); } catch { /* 키보드로 고를 수 있다. */ } }
    else {
      const name = el?.querySelector<HTMLButtonElement>('.line-name');
      // 고칠 수 있는 것이 없는 칸은 아무 반응 없이 넘어가지 않고, 왜 못 고치는지와 고칠 곳을 알려 준다.
      if (name && !name.disabled) name.click(); else if (el && !disabled) onError(readOnly?.(row, col) ?? '이 칸은 자동으로 계산되어 직접 고칠 수 없습니다.');
    }
  };
  const onPointerDown = (e: PointerEvent<HTMLTableElement>) => {
    // 손가락·펜으로 누르면 [셀 선택]을 켰을 때만 칸을 고른다. 아니면 기본 동작대로 입력 칸에 커서가 들어가고 키보드가 뜬다.
    const finger = e.pointerType !== 'mouse';
    if (disabled || e.button !== 0 || (finger && !touchSelection)) return;
    if (e.target instanceof Element && e.target.closest('.line-grip,.line-delete,.merge-split,.manual-split')) return;
    if (isEditor(e.target) && document.activeElement === e.target) return;
    const at = coordinate(e.target); if (!at) return;
    e.preventDefault(); table.current?.focus({ preventScroll: true });
    if (e.shiftKey || (finger && touchSelection && picked.size)) setPicked(rangeTo(at.row, at.col));
    else if (e.metaKey || e.ctrlKey) {
      const next = new Set(picked); for (const key of expand(new Set([cellKey(at.row, at.col)]))) { if (next.has(key)) next.delete(key); else next.add(key); } setPicked(next);
    } else { anchor.current = at; setPicked(expand(new Set([cellKey(at.row, at.col)]))); }
    sweeping.current = !finger;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.nativeEvent.isComposing || isEditor(e.target)) return;
    if (e.key === 'Escape') { setPicked(new Set()); return; }
    if (disabled || e.metaKey || e.ctrlKey || e.altKey) return;
    const selected = bounds ?? { top: 0, bottom: 0, left: 0, right: 0 };
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) {
      e.preventDefault();
      const current = layout.get(cellKey(selected.top, selected.left))!;
      let row = selected.top; let col = selected.left;
      if (e.key === 'ArrowDown') row = current.row + current.rows;
      if (e.key === 'ArrowUp') row--;
      if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) col = current.col + current.cols;
      if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) col--;
      if (col > lastCol) { col = 0; row++; } if (col < 0) { col = lastCol; row--; }
      row = Math.max(0, Math.min(lines.length - 1, row)); col = Math.max(0, Math.min(lastCol, col));
      if (e.shiftKey && e.key !== 'Tab') setPicked(rangeTo(row, col));
      else { anchor.current = { row, col }; setPicked(expand(new Set([cellKey(row, col)]))); }
    } else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(selected.top, selected.left); }
    else if (e.key.length === 1 && picked.size) { e.preventDefault(); startEdit(selected.top, selected.left, e.key); }
  };
  const onCopy = (e: ClipboardEvent<HTMLTableElement>) => {
    if (isEditor(e.target) || !picked.size) return;
    e.preventDefault(); copiedText = text(); e.clipboardData.setData('text/plain', copiedText);
  };
  const onPaste = (e: ClipboardEvent<HTMLTableElement>) => {
    const value = e.clipboardData.getData('text/plain');
    if (isEditor(e.target) && !/[\t\r\n]/.test(value)) return;
    if (!picked.size) return;
    e.preventDefault();
    if (isEditor(e.target) && e.target instanceof HTMLElement) {
      e.target.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    void pasteText(value);
  };
  const cell = (row: number, col: number, node: ReactElement<TdHTMLAttributes<HTMLTableCellElement>>) => {
    const area = layout.get(cellKey(row, col))!;
    if (area.row !== row || area.col !== col) return null;
    const selected = [...rectangle(row, row + area.rows - 1, col, col + area.cols - 1)].some(k => picked.has(k));
    const original = node.props;
    let children = original.children;
    if (area.manual && !touch) children = <>{Children.toArray(children).filter(child => !(isValidElement<{ className?: string }>(child) && child.props.className === 'merge-split'))}<button type="button" className="manual-split" disabled={disabled || editing} aria-label="셀 병합 해제" title="원래 값을 유지한 채 병합을 해제합니다" onClick={() => { void perform({ type: 'cell-unmerge', ids: [area.manual] }); }}>분리</button></>;
    const descriptions = area.manual ? [...rectangle(row, row + area.rows - 1, col, col + area.cols - 1)].map(k => { const [r, c] = k.split(':').map(Number); return values[r][c].text; }).join(' · ') : '';
    return cloneElement(node, {
      key: cellKey(row, col), className: `${original.className ?? ''}${area.manual ? ' manual-merged' : ''}`,
      rowSpan: area.rows, colSpan: area.cols, 'data-pick': cellKey(row, col), 'data-row': row, 'data-col': col,
      'data-picked': selected || undefined, title: area.manual ? `병합한 ${area.rows * area.cols}칸: ${descriptions}\n원래 값은 병합을 해제하면 다시 보입니다.` : original.title,
      children,
    } as TdHTMLAttributes<HTMLTableCellElement>);
  };
  const distinct = new Set<string>(); const numbers: number[] = [];
  for (const key of picked) {
    const [r, c] = key.split(':').map(Number); const value = values[r]?.[c];
    if (value?.number === undefined) continue;
    const identity = value.identity ?? key;
    if (distinct.has(identity)) continue;
    distinct.add(identity); numbers.push(value.number);
  }
  return {
    table, toolbar, picked, bounds, canMerge, selectedMerges, cell, copy, paste, merge, unmerge, touchSelection, setTouchSelection, editing,
    runHistory: (direction: 'undo' | 'redo', action: () => void) => {
      const active = document.activeElement;
      if (table.current?.contains(active) && isEditor(active)) { document.execCommand(direction); return; }
      action();
    },
    total: numbers.reduce((sum, n) => sum + n, 0), numericCount: numbers.length,
    tableProps: { tabIndex: 0, onPointerDown, onPointerOver: (e: PointerEvent<HTMLTableElement>) => { if (sweeping.current && e.buttons === 1) { const at = coordinate(e.target); if (at) setPicked(rangeTo(at.row, at.col)); } }, onKeyDown, onCopy, onPaste,
      onFocusCapture: (e: React.FocusEvent<HTMLTableElement>) => setEditing(isEditor(e.target)),
      onBlurCapture: (e: React.FocusEvent<HTMLTableElement>) => { if (!isEditor(e.relatedTarget)) setEditing(false); },
      onDoubleClick: (e: React.MouseEvent<HTMLTableElement>) => { if (touch || disabled) return; const at = coordinate(e.target); if (at) startEdit(at.row, at.col); },
      onClickCapture: (e: React.MouseEvent<HTMLTableElement>) => { if (e.detail > 0 && e.target instanceof Element && e.target.closest('.line-name') && (!touch || touchSelection)) { e.preventDefault(); e.stopPropagation(); } },
    },
  };
}
