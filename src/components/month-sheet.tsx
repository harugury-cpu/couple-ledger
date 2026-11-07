'use client';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Category, PaymentMethod, CellMerge } from '../db/schema';
import { monthTotals, total, transferRows, type ComputedLine } from '../lib/calculations';
import { sections, won } from '../lib/labels';
import type { LineInput } from '../lib/validation';
import { parsePayment } from '../lib/payment';
import { MoneyCell } from './money-cell';
import { TextCell } from './text-cell';
import { NewLineRow, type NewLine } from './new-line-row';
import { moneyFormula } from '../lib/validation';
import { useSheetTools, type SheetValue } from './use-sheet-tools';
import { sheetOrder, sheetSections, type SheetArea } from '../lib/sheet-grid';

type Section = ComputedLine['section'];
type TransferRow = ReturnType<typeof transferRows>[number];
type Props = {
  year: number; month: number; merges: CellMerge[];
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
  lines: ComputedLine[]; transfers: TransferRow[]; categories: Category[]; methods: PaymentMethod[];
  disabled: boolean; editId: string | null;
  perform: (command: object) => Promise<unknown>; onEdit: (id: string) => void; onError: (message: string) => void;
  applyFuture: (series: string | string[]) => boolean;
  // 이후 달이 이미 만들어진 줄 묶음(series_id). [이후 달에도 반영] 버튼을 켤지 정한다.
  futureSeries: string[];
  // 구역 맨 아래 빈 줄에 적은 내용으로 그 구역에 새 줄을 만든다. 만들어지면 true.
  onCreate: (section: Section, line: NewLine) => Promise<boolean>;
};

// 표 안에서는 입력 방식을 짧게 표시한다 (기본값인 직접 입력은 표시하지 않음)
const shortMode = { card: '카드', fixed: '자동', manual: '' };

// 이어진 줄을 한 칸으로 병합한다: 묶음 시작 줄에 묶음 길이, 나머지 줄에 0.
function mergeSpans<T>(items: T[], continues: (anchor: T, item: T) => boolean) {
  const spans = items.map(() => 1);
  let start = 0;
  for (let i = 1; i < items.length; i++) {
    if (continues(items[start], items[i])) { spans[start] += 1; spans[i] = 0; } else start = i;
  }
  return spans;
}
// 수단 칸: 같은 수단이고 따로 결제일을 적지 않은 줄은 윗줄 칸에 합친다.
const samePayment = (anchor: ComputedLine, line: ComputedLine) =>
  line.payment_method_id !== null && line.payment_method_id === anchor.payment_method_id && (line.pay_day === null || line.pay_day === anchor.pay_day);

// 칸 하나만 고칠 때 보내는 줄 내용: 지금 값 그대로에 바뀐 칸만 덮어쓴다.
const fieldsOf = (l: ComputedLine): LineInput => ({ name: l.name, section: l.section, category_id: l.category_id, payment_method_id: l.payment_method_id,
  pay_day: l.pay_day, budget: l.budget, input_mode: l.input_mode, saving_owner: l.saving_owner, one_off: l.one_off });

const sum = (rows: TransferRow[], field: 'amount' | 'remaining') => rows.reduce((acc, r) => acc + r[field], 0);

// 화면 배치와 누르는 방식은 따로 판정한다. 폴드 펼친 화면처럼 폭은 넓어도 손가락으로 누르는 기기가 있다.
// phone: 폰 폭(globals.css의 폰 구간과 같은 값). 표는 PC와 같은 8열이지만, 폰은 금액을 고치는 곳이라 금액 칸만 입력 칸이다.
// touch: 마우스를 올려 볼 수 없는 기기. 올려야 보이는 버튼(분리)을 두지 않고, 칸 선택은 [셀 선택]을 켰을 때만 한다.
const useMedia = (query: string) => useSyncExternalStore(
  (change: () => void) => { const m = matchMedia(query); m.addEventListener('change', change); return () => m.removeEventListener('change', change); },
  () => matchMedia(query).matches, () => false);
const usePhone = () => useMedia('(max-width: 700px)');
const useTouch = () => useMedia('(hover: none)');

// 월별 표 머리줄: [칸 class, 제목]. 열 너비 조절도 이 순서(0~7열)를 쓴다.
const headings: [string, React.ReactNode][] = [
  ['d c-pay', <><span className="pc">고정생활비</span><span className="m">수단</span></>], ['name', <span className="m">고정생활비</span>], ['d c-cat', '카테고리'],
  ['num c-num', '예산'], ['num c-num', '금액'], ['d c-acc', null], ['d num c-num', '이체 계좌'], ['d num c-num', '남음'],
];

// Numbers 시트와 같은 순서: 고정생활비 → 가변생활비 → 저축 → 총 지출 → 수입 → 총 수입 → 수입-지출
export function MonthSheet({ year, month, merges, history, lines: sourceLines, transfers, categories, methods, disabled, editId, perform, onEdit, onError, applyFuture, futureSeries, onCreate }: Props) {
  // 아래의 모든 행 번호(병합·선택·붙여넣기)는 화면에 그리는 구역 순서를 기준으로 한다.
  const lines = sheetOrder(sourceLines);
  const methodName = new Map(methods.map(m => [m.id, m.name]));
  const transferOf = new Map(transfers.map(t => [t.series_id, t]));
  const totals = monthTotals(lines);
  const used = transfers.filter(t => t.lineCount > 0);
  const phone = usePhone();
  const touch = useTouch();
  const categoryName = new Map(categories.map(c => [c.id, c.name]));
  // 폰에서는 처음에 수단 열만큼 밀어 두어 항목 · 카테고리 · 예산 · 금액이 한 화면에 들어오게 한다. 수단은 오른쪽으로 밀면 보인다.
  const scroller = useRef<HTMLDivElement>(null);
  // 줄 끌어 옮기기: 끌고 있는 줄과, 놓으면 들어갈 자리(그 구역 안에서 몇 번째 줄 앞인지).
  const [drag, setDrag] = useState<{ id: string; section: Section } | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const endDrag = () => { setDrag(null); setDrop(null); };
  // 구역 안 from 번째 줄을 at 번째 줄 앞 자리로 옮긴다. 제자리면 보내지 않는다.
  const moveTo = (group: ComputedLine[], from: number, at: number) => {
    const index = at > from ? at - 1 : at;
    if (index !== from && index >= 0 && index < group.length) void perform({ type: 'move', id: group[from].id, index });
  };
  useLayoutEffect(() => {
    const el = scroller.current;
    if (phone && el) el.scrollLeft = el.querySelector<HTMLElement>('thead .c-pay')?.offsetWidth ?? 0;
  }, [phone]);

  // 열 너비: 머리줄 칸의 오른쪽 끝을 끌어 바꾼다. 이 기기 브라우저에만 폰·넓은 화면 따로 저장하고, 끝을 두 번 누르면 원래 너비로 돌아간다.
  const widthKey = `sheet-columns:${phone ? 'phone' : 'wide'}`;
  const [widths, setWidths] = useState<number[] | null>(null);
  const head = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem(widthKey) ?? 'null'); setWidths(Array.isArray(saved) && saved.length === headings.length && saved.every(n => typeof n === 'number' && n > 0) ? saved : null); }
    catch { setWidths(null); }
  }, [widthKey]);
  const resize = (col: number) => (e: React.PointerEvent<HTMLSpanElement>) => {
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
      try { localStorage.setItem(widthKey, JSON.stringify(next)); } catch { /* 저장이 막힌 브라우저에서는 이번 화면에서만 유지된다. */ }
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  };
  const resetWidths = () => { setWidths(null); try { localStorage.removeItem(widthKey); } catch { /* 위와 같다. */ } };

  // 병합 해제: 맨 윗줄은 값을 그대로 두고, 아랫줄들은 칸을 비워 따로 적을 수 있게 한다(스프레드시트의 병합 해제와 같다).
  const splitButton = (label: string, rows: ComputedLine[], split: (rest: ComputedLine[]) => Promise<unknown>) => rows.length > 1 && !touch &&
    <button type="button" className="merge-split" disabled={disabled} title="병합 해제: 맨 윗줄만 남기고 아랫줄 칸을 비웁니다" aria-label={`${label} 병합 해제`}
      onClick={() => { void split(rows.slice(1)); }}>분리</button>;

  const paymentLabel = (l: ComputedLine) => {
    const method = l.payment_method_id ? methodName.get(l.payment_method_id) : undefined;
    if (l.pay_day && method) return `${l.pay_day}일(${method})`;
    return method ?? (l.pay_day ? `${l.pay_day}일` : '');
  };

  // 양식 칸(수단·항목·카테고리·예산·이체)은 PC에서 고친다. 폰에서는 같은 자리에 값만 보인다.
  const form = (text: React.ReactNode, editor: React.ReactNode) => phone ? <span className="cell-text">{text}</span> : editor;

  const indexOf = new Map(lines.map((line, index) => [line.id, index]));
  const automatic: SheetArea[] = [];
  for (const section of sheetSections) {
    const group = lines.filter(l => l.section === section);
    const payments = mergeSpans(group, samePayment);
    const accounts = mergeSpans(group, (anchor, l) => !!l.transfer_key && transferOf.has(l.transfer_key) && l.transfer_key === anchor.transfer_key);
    group.forEach((line, i) => {
      const row = indexOf.get(line.id)!;
      if (payments[i] > 1) automatic.push({ row, col: 0, rows: payments[i], cols: 1 });
      if (accounts[i] > 1) for (const col of [5, 6, 7]) automatic.push({ row, col, rows: accounts[i], cols: 1 });
    });
  }
  const values: SheetValue[][] = lines.map(line => {
    const transfer = line.transfer_key ? transferOf.get(line.transfer_key) : undefined;
    return [
      { text: paymentLabel(line) }, { text: line.name }, { text: line.category_id ? categoryName.get(line.category_id) ?? '' : '' },
      { text: String(line.budget), number: line.budget },
      { text: line.hasEntry ? String(line.actual) : '', number: line.hasEntry ? line.actual : undefined },
      { text: transfer?.account ?? '' },
      { text: transfer ? String(transfer.amount) : '', number: transfer?.amount, identity: transfer ? `${transfer.id}:t` : undefined },
      { text: transfer ? String(transfer.remaining) : '', number: transfer?.remaining, identity: transfer ? `${transfer.id}:r` : undefined },
    ];
  });
  const tools = useSheetTools({ year, month, lines, values, merges: merges.filter(m => m.month === month), automatic, disabled, touch, perform, onError });
  // [이후 달에도 반영]: 고른 칸이 있는 줄과, 이체 칸(5·6·7열)을 고른 이체 묶음. 이후 달이 만들어진 것만 대상이다.
  const pickedCells = [...tools.picked].map(key => key.split(':').map(Number));
  // PC는 한 번 클릭이 칸 선택이라, 여러 기록의 합인 금액 칸 하나를 고르면 도구줄에 = a + b + c 를 보여 준다.
  const pickedLine = pickedCells.length === 1 && pickedCells[0][1] === 4 ? lines[pickedCells[0][0]] : undefined;
  const pickedFormula = pickedLine && pickedLine.parts.length > 1 ? ` ${moneyFormula(pickedLine.parts).replace('=', '= ')}` : '';
  const laterLines = [...new Set(pickedCells.map(([row]) => lines[row]))]
    .filter(l => l && !l.series_id.startsWith('special:') && futureSeries.includes(l.series_id));
  const laterTransfers = [...new Set(pickedCells.filter(([, col]) => col >= 5).map(([row]) => lines[row]?.transfer_key))]
    .flatMap(key => { const t = key ? transferOf.get(key) : undefined; return t && lines.some(l => l.transfer_key === key && futureSeries.includes(l.series_id)) ? [t] : []; });
  const propagate = () => {
    const parts = [laterLines.length && `${laterLines.length}줄`, laterTransfers.length && `이체 ${laterTransfers.length}건`].filter(Boolean).join('과 ');
    if (confirm(`고른 ${parts}의 지금 내용을 이미 만들어진 이후 달에도 똑같이 맞출까요?\n(수단·항목·카테고리·예산·이체 계좌·이체 금액. 실제로 쓴 금액은 바꾸지 않습니다.)`))
      void perform({ type: 'propagate', ids: laterLines.map(l => l.id), transfer_ids: laterTransfers.map(t => t.id) });
  };

  function sectionRows(key: Section) {
    const group = lines.filter(l => l.section === key);
    const paySpans = mergeSpans(group, samePayment);
    const transferSpans = mergeSpans(group, (anchor, l) => !!l.transfer_key && transferOf.has(l.transfer_key) && l.transfer_key === anchor.transfer_key);
    const dragging = drag?.section === key ? group.findIndex(g => g.id === drag.id) : -1;
    return group.map((l, i) => {
      const special = l.series_id.startsWith('special:');
      const movable = !phone && !special && !disabled;
      const transfer = l.transfer_key ? transferOf.get(l.transfer_key) : undefined;
      const meta = [l.one_off ? '이번 달만' : null, special ? '특별 지출' : shortMode[l.input_mode] || null].filter(Boolean).join(' · ');
      const dropClass = dragging >= 0 && drop === i ? 'drop-before' : dragging >= 0 && drop === group.length && i === group.length - 1 ? 'drop-after' : '';
      const paymentRows = group.slice(i, i + (paySpans[i] || 1));
      const accountRows = group.slice(i, i + (transferSpans[i] || 1));
      const cells = [
        <td className="d merged">
          {form(paymentLabel(l), <TextCell value={paymentLabel(l)} label={`${l.name} 수단`} list="sheet-methods" disabled={disabled || special} onSave={text => {
            try { void perform({ type: 'payment', ids: paymentRows.filter(g => !g.series_id.startsWith('special:')).map(g => g.id), ...parsePayment(text, methods) }); }
            catch (e) { onError(e instanceof Error ? e.message : '수단을 확인하세요.'); }
          }} />)}
          {splitButton(`${l.name} 수단`, paymentRows, async rest => {
            await perform({ type: 'payment', ids: rest.filter(g => !g.series_id.startsWith('special:')).map(g => g.id), pay_day: null, payment_method_id: null });
          })}
        </td>,
        <th scope="row" className="name" title={l.name}>
          {movable && <span className="line-grip" role="button" tabIndex={0} draggable aria-label={`${l.name} 순서 옮기기 (끌거나 위·아래 화살표)`} title="끌어서 순서 옮기기"
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id);
              const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2);
              setDrag({ id: l.id, section: key });
            }} onDragEnd={endDrag}
            onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(group, i, i - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(group, i, i + 2); } }}>⠿</span>}
          {form(l.name, <button className="line-name" disabled={disabled || special} aria-label={`${l.name} 항목 수정`} onClick={() => onEdit(l.id)}>{l.name}</button>)}
          {meta && <span className="line-meta">{meta}</span>}
          {!special && !phone && <button className="line-delete" disabled={disabled} aria-label={`${l.name} 줄 삭제`} title="줄 삭제" onClick={() => {
            if (confirm(`“${l.name}” 줄과 이 달 입력 기록을 삭제할까요?`)) void perform({ type: 'delete', id: l.id, future: applyFuture(l.series_id) });
          }}>×</button>}
        </th>,
        <td className="d">
          {form(l.category_id ? categoryName.get(l.category_id) : '', <select className={`cell-select${l.category_id ? '' : ' is-empty'}`} aria-label={`${l.name} 카테고리`} value={l.category_id ?? ''} disabled={disabled || special}
            onChange={e => { void perform({ type: 'update', id: l.id, fields: { ...fieldsOf(l), category_id: e.target.value || null } }); }}>
            <option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>)}
        </td>,
        <td className="num" title={l.effectiveBudget !== l.budget ? `특별 지출 조정 후 ${won(l.effectiveBudget)}` : undefined}>
          {form(won(l.budget), <MoneyCell value={l.budget} label={`${l.name} 기본 예산`} disabled={disabled || special} onError={onError}
            onSave={amount => { void perform({ type: 'budget', id: l.id, amount: amount ?? 0 }); }} />)}
          {l.effectiveBudget !== l.budget && <small className="adjusted">조정 후 {won(l.effectiveBudget)}</small>}
        </td>,
        <td className="num"><MoneyCell value={l.hasEntry ? l.actual : null} signed parts={l.parts} label={`${l.name} 금액`} disabled={disabled || special} onError={onError}
          onSave={amount => { void perform({ type: 'amount', id: l.id, amount }); }} /></td>,
        ...(transfer ? [
          <td className="d merged">
            {form(transfer.account, <TextCell value={transfer.account} label={`${transfer.account} 이체 계좌 이름`} disabled={disabled}
              onSave={account => { if (account) void perform({ type: 'transfer', id: transfer.id, account }); }} />)}
            {splitButton(`${transfer.account} 이체 계좌`, accountRows, async rest => {
              for (const r of rest) if (!await perform({ type: 'update', id: r.id, fields: fieldsOf(r), transfer_account: '' })) return;
            })}
          </td>,
          <td className={`d num merged${transfer.amount !== transfer.budget ? ' transfer-mismatch' : ''}`}
            title={`예산 합계 ${won(transfer.budget)}원 · 이체 금액 ${won(transfer.amount)}원${transfer.amount !== transfer.budget ? ' (불일치)' : ''}`}>
            {form(won(transfer.amount), <MoneyCell value={transfer.amount} label={`${transfer.account} 이체 금액`} disabled={disabled} onError={onError}
              onSave={amount => { void perform({ type: 'transfer', id: transfer.id, amount: amount ?? 0 }); }} />)}
          </td>,
          <td className={`d num merged remaining ${transfer.remaining < 0 ? 'minus' : transfer.remaining === 0 ? 'zero' : ''}`} title={`이체 ${won(transfer.amount)} − 쓴 돈 ${won(transfer.spent)}`}>{won(transfer.remaining)}</td>,
        ] : [
          <td className="d">{form('', <TextCell value="" label={`${l.name} 이체 계좌`} disabled={disabled || special}
            onSave={account => { void perform({ type: 'update', id: l.id, fields: fieldsOf(l), transfer_account: account }); }} />)}</td>,
          <td className="d" />, <td className="d" />,
        ]),
      ];
      return <tr key={l.id} className={`line ${key} ${i % 2 ? 'odd' : ''} ${editId === l.id ? 'editing' : ''} ${dragging === i ? 'dragging' : ''} ${dropClass}`}
        onDragOver={dragging < 0 ? undefined : e => {
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const box = e.currentTarget.getBoundingClientRect();
          const at = e.clientY > box.top + box.height / 2 ? i + 1 : i; setDrop(at === dragging || at === dragging + 1 ? null : at);
        }} onDrop={dragging < 0 ? undefined : e => { e.preventDefault(); if (drop !== null) moveTo(group, dragging, drop); endDrag(); }}>
        {cells.map((cell, col) => tools.cell(indexOf.get(l.id)!, col, cell))}
      </tr>;
    });
  }
  // 구역 맨 아래(소계 위)의 빈 줄. 줄무늬 순서를 그대로 잇는다.
  function addRow(key: Section) {
    if (phone) return null;
    return <NewLineRow key={`${key}-add`} section={key} odd={lines.filter(l => l.section === key).length % 2 === 1} disabled={disabled}
      categories={categories} methods={methods} onCreate={line => onCreate(key, line)} onError={onError} />;
  }
  function subtotalRow(key: Section) {
    const group = lines.filter(l => l.section === key);
    const subtotal = total(group);
    const groupTransfers = transfers.filter(t => group.some(l => l.transfer_key === t.series_id));
    return <tr key={`${key}-subtotal`} className="total">
      <th className="d" /><th scope="row" className="name">{sections[key]} 소계</th><td className="d" />
      <td className="num">{won(subtotal.budget)}</td><td className="num">{won(subtotal.actual)}</td>
      <td className="d" />
      <td className="d num">{groupTransfers.length ? won(sum(groupTransfers, 'amount')) : ''}</td>
      <td className={`d num ${sum(groupTransfers, 'remaining') < 0 ? 'minus' : ''}`}>{groupTransfers.length ? won(sum(groupTransfers, 'remaining')) : ''}</td>
    </tr>;
  }
  const band = (key: Section) => <tr key={`${key}-band`} className={`band ${key}`}><th colSpan={3}>{sections[key]}</th><td className="d" colSpan={5} /></tr>;
  const totalRow = (label: string, value: { budget: number; actual: number }, transfersCell?: React.ReactNode) => <tr key={label} className="total grand">
    <th className="d" /><th scope="row" className="name">{label}</th><td className="d" />
    <td className="num">{won(value.budget)}</td><td className={`num ${value.actual < 0 ? 'minus' : ''}`}>{won(value.actual)}</td>
    {transfersCell ?? <><td className="d" /><td className="d" /><td className="d" /></>}
  </tr>;

  return <>
    <div className="sheet-tools" ref={tools.toolbar} role="toolbar" aria-label="셀 작업" onPointerDown={e => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); }}>
      <button type="button" disabled={disabled || !history.canUndo} title="실행 취소 (Ctrl/⌘+Z)" onClick={() => tools.runHistory('undo', history.undo)}>실행 취소</button>
      <button type="button" disabled={disabled || !history.canRedo} title="다시 실행 (Ctrl/⌘+Shift+Z)" onClick={() => tools.runHistory('redo', history.redo)}>다시 실행</button>
      <span className="tool-divider" />
      <button type="button" disabled={!tools.picked.size} title="선택한 셀 복사 (Ctrl/⌘+C)" onClick={() => { void tools.copy(); }}>복사</button>
      <button type="button" disabled={disabled || !tools.picked.size} title="선택한 셀부터 붙여넣기 (Ctrl/⌘+V)" onClick={() => { void tools.paste(); }}>붙여넣기</button>
      <button type="button" disabled={disabled || !tools.canMerge} title={tools.bounds && tools.bounds.left >= 5 ? "아랫줄을 맨 윗줄 이체 계좌로 묶어 합계와 남음을 함께 셉니다" : "왼쪽 위 값을 표시하고 나머지 값은 보존합니다"} onClick={() => { void tools.merge(); }}>셀 병합</button>
      <button type="button" disabled={disabled || tools.editing || !tools.selectedMerges.length} onClick={() => { void tools.unmerge(); }}>병합 해제</button>
      <span className="tool-divider" />
      <button type="button" disabled={disabled || tools.editing || (!laterLines.length && !laterTransfers.length)} title="고른 줄의 지금 내용을 이미 만들어진 이후 달에도 맞춥니다" onClick={propagate}>이후 달에도 반영</button>
      {touch && <button type="button" aria-pressed={tools.touchSelection} onClick={() => tools.setTouchSelection(!tools.touchSelection)}>셀 선택</button>}
      <span className="selection-info" role="status">{tools.picked.size ? `${tools.picked.size}칸 선택${tools.numericCount ? ` · 합계 ${won(tools.total)}${pickedFormula}` : ''}` : touch ? '셀 선택을 켜고 범위의 양 끝을 누르세요' : '클릭 선택 · 두 번 클릭 편집'}</span>
    </div>
    {used.length > 0 && <ul className="account-list" aria-label="계좌별 남은 돈">
      {used.map(t => <li key={t.id}><span>{t.account}</span><strong className={t.remaining < 0 ? 'minus' : ''}>{won(t.remaining)}</strong><small className={t.amount !== t.budget ? 'transfer-mismatch' : undefined}
        title={`예산 합계 ${won(t.budget)}원 · 이체 금액 ${won(t.amount)}원${t.amount !== t.budget ? ' (불일치)' : ''}`}>/ {won(t.amount)}</small></li>)}
    </ul>}
    <datalist id="sheet-methods">{methods.map(m => <option key={m.id} value={m.name} />)}</datalist>
    <datalist id="sheet-accounts">{transfers.map(t => <option key={t.id} value={t.account} />)}</datalist>
    <div className="sheet-scroll" ref={scroller}><table className={`sheet${tools.touchSelection ? " selecting" : ""}`} ref={tools.table} {...tools.tableProps}
      style={widths ? { width: widths.reduce((a, b) => a + b, 0) } : undefined}>
      <thead><tr ref={head}>
        {headings.map(([className, label], col) => <th key={col} className={className} style={widths ? { width: widths[col] } : undefined}>{label}
          <span className="col-resize" aria-hidden="true" title="끌어서 열 너비 조절 · 두 번 누르면 원래 너비" onPointerDown={resize(col)} onDoubleClick={resetWidths} /></th>)}
      </tr></thead>
      <tbody>
        {sectionRows('fixed')}{addRow('fixed')}{subtotalRow('fixed')}
        {band('variable')}{sectionRows('variable')}{addRow('variable')}{subtotalRow('variable')}
        {band('saving')}{sectionRows('saving')}{addRow('saving')}{subtotalRow('saving')}
        {totalRow('총 지출', totals.expense, <><th className="d">이체 합계</th><td className="d num">{won(sum(used, 'amount'))}</td><td className={`d num ${sum(used, 'remaining') < 0 ? 'minus' : ''}`}>{won(sum(used, 'remaining'))}</td></>)}
        {sectionRows('income')}{addRow('income')}
        {totalRow('총 수입', totals.income)}
        {totalRow('수입-지출', totals.balance)}
      </tbody>
    </table></div>

  </>;
}
