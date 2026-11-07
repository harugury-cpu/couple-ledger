'use client';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Account } from '../db/schema';
import type { Snapshot } from './ledger-app';
import { assetRows, computeLines } from '../lib/calculations';
import { accountKinds, won } from '../lib/labels';
import { accountKind, parseMoney } from '../lib/validation';
import { MoneyCell } from './money-cell';
import { SavingsChart } from './summary-charts';
import { useSheetTools, type SheetValue } from './use-sheet-tools';
import { useColumnWidths } from './use-column-widths';

type Props = {
  data: Snapshot; busy: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void;
  history: { canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void };
};
const signed = (n: number) => `${n > 0 ? '+' : ''}${won(n)}`;
const rate = (change: number, base: number) => base > 0 ? ` (${change > 0 ? '+' : ''}${(change / base * 100).toFixed(1)}%)` : '';
function seoulToday() {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return { iso, year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}
// 확인한 날(YYYY-MM-DD) 또는 날짜 없이 달만 있는 예전 기록(YYYY-MM)
const checked = (value: string | null, year: number) => {
  if (!value) return null;
  const prefix = Number(value.slice(0, 4)) === year ? '' : `${value.slice(2, 4)}년 `;
  return value.length > 7 ? `${prefix}${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))} 확인` : `${prefix}${Number(value.slice(5, 7))}월 기록`;
};
const usePhone = () => useSyncExternalStore(
  (change: () => void) => { const m = matchMedia('(max-width: 700px)'); m.addEventListener('change', change); return () => m.removeEventListener('change', change); },
  () => matchMedia('(max-width: 700px)').matches, () => false);
const useTouch = () => useSyncExternalStore(
  (change: () => void) => { const m = matchMedia('(hover: none)'); m.addEventListener('change', change); return () => m.removeEventListener('change', change); },
  () => matchMedia('(hover: none)').matches, () => false);

// 자산: 저축·투자 계좌마다 달별로 넣은 원금(월별 표 저축 줄), 총 원금·평가금액·증감, 그리고 묶인 돈.
// 표 조작(칸 선택·두 번 눌러 편집·복사·열 너비 끌기·실행 취소)은 월별 표와 같다. 직접 적는 칸은 평가금액뿐이다.
export function AssetsView({ data, busy, perform, onError, history }: Props) {
  const [edit, setEdit] = useState<string | null>(null);
  const today = seoulToday();
  const phone = usePhone(); const touch = useTouch();
  const { rows, locked, visible, totals, history: chart } = assetRows(data.accounts, computeLines(data.lines, data.entries, data.adjustments), data.balances, data.assetCarry, data.year);
  const editing = edit && edit !== 'new' ? data.accounts.find(a => a.id === edit) : undefined;
  const thisYear = data.year === today.year;
  // 열: 계좌 · 이월 원금 · 보이는 달들 · 총 원금 · 평가금액 · 증감
  const V = visible.length; const totalCol = 2 + V; const valueCol = totalCol + 1; const count = totalCol + 3;
  const values: SheetValue[][] = rows.map(r => [
    { text: r.account.name }, { text: String(r.opening), number: r.opening },
    ...r.months.map(m => ({ text: m.amount === null ? '' : String(m.amount), number: m.amount ?? undefined })),
    { text: String(r.principal), number: r.principal },
    { text: r.value === null ? '' : String(r.value), number: r.value ?? undefined },
    { text: r.change === null ? '' : String(r.change), number: r.change ?? undefined },
  ]);
  const tools = useSheetTools({ year: data.year, month: today.month, lines: rows.map(r => ({ id: r.account.id, section: 'saving' as const })), values, merges: [], automatic: [],
    disabled: busy, touch, perform, onError, columns: count, mergeable: false,
    // 붙여넣기는 투자 계좌의 평가금액 칸에만 된다(오늘 확인한 값으로 남는다).
    paste: async changes => {
      const writes = changes.map(c => {
        const row = rows.find(r => r.account.id === c.id)!;
        if (c.col !== valueCol || row.account.kind !== 'invest' || !thisYear) throw new Error('올해 투자 계좌의 평가금액 칸에만 붙여넣을 수 있습니다.');
        return { type: 'balance', id: c.id, year: today.year, month: today.month, amount: parseMoney(c.value, true), checked_on: today.iso };
      });
      for (const command of writes) if (!await perform(command)) return false;
      return true;
    } });
  const columns = useColumnWidths(`asset-columns:${phone ? 'phone' : 'wide'}`, count);
  // 넓은 화면에서 오른쪽에 붙는 합계 열: 너비를 바꿨으면 그 너비로 오른쪽 자리를 다시 계산한다.
  const pin = (col: number): CSSProperties | undefined => columns.widths ? { ...columns.width(col), right: columns.widths.slice(col + 1).reduce((a, b) => a + b, 0) } : undefined;
  const scroller = useRef<HTMLDivElement>(null);
  // 처음 열 때: 넓은 화면은 이번 달이 오른쪽(붙어 있는 합계 열 앞)에 오게, 폰은 합계 열이 보이게 오른쪽 끝으로 민다.
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    if (phone) { el.scrollLeft = el.scrollWidth; return; }
    const col = el.querySelector<HTMLElement>(`thead [data-month="${thisYear ? today.month : 12}"]`) ?? el.querySelector<HTMLElement>('thead [data-month]:last-of-type');
    const pinned = [...el.querySelectorAll<HTMLElement>('thead .stick-r')].reduce((sum, th) => sum + th.offsetWidth, 0);
    if (col) el.scrollLeft = Math.max(0, col.offsetLeft + col.offsetWidth - (el.clientWidth - pinned));
  }, [data.year, thisYear, today.month, rows.length, V, phone]);
  const monthSum = (i: number) => rows.some(r => r.months[i].amount !== null) ? rows.reduce((sum, r) => sum + (r.months[i].amount ?? 0), 0) : null;
  const heads: [string, React.ReactNode, number?][] = [
    ['', '계좌'], ['numeric', '이월 원금'], ...visible.map(m => ['numeric', `${m}월`, m] as [string, string, number]),
    ['numeric asset-total stick-r r2', '총 원금'], ['numeric stick-r r1', '평가금액'], ['numeric stick-r r0', '증감'],
  ];

  return <>
    <div className="section-heading"><div>
      <h2>자산</h2>
      <p className="muted">달마다 넣은 원금은 월별 표의 저축 줄에서 가져옵니다. 평가금액은 증권 앱에서 본 값을 확인한 날 적습니다.</p>
    </div></div>
    <div className="month-bar">
      <dl className="month-summary asset-summary" aria-label="자산 요약">
        <div><dt>넣은 원금</dt><dd>{won(totals.principal)}</dd></div>
        <div><dt>평가금액</dt><dd>{won(totals.value)}</dd></div>
        <div className="lead"><dt>총 자산</dt><dd>{won(totals.total)}{totals.locked > 0 && <span> 묶인 돈 {won(totals.locked)} 포함</span>}</dd></div>
        <div><dt>증감</dt><dd className={totals.change < 0 ? 'minus' : ''}>{signed(totals.change)}<span>{rate(totals.change, totals.principal)}</span></dd></div>
      </dl>
      <button disabled={busy} onClick={() => setEdit(edit === 'new' ? null : 'new')}>+ 계좌 추가</button>
    </div>
    {(edit === 'new' || editing) && <div className="edit-panel balance-panel"><h3>{editing ? `${editing.name} 수정` : '새 계좌'}</h3>
      <AccountForm key={edit} account={editing} data={data} today={today.iso.slice(0, 7)} busy={busy} onError={onError} onCancel={() => setEdit(null)}
        onSave={async fields => { if (await perform({ type: 'account-save', id: editing?.id, ...fields })) setEdit(null); }}
        onDelete={editing && (async () => {
          if (confirm(`“${editing.name}” 계좌와 지금까지 적은 평가금액 기록을 삭제할까요? 월별 표의 저축 줄은 그대로입니다.`) && await perform({ type: 'account-delete', id: editing.id })) setEdit(null);
        })} />
    </div>}

    {rows.length > 0 && <div className="sheet-tools" ref={tools.toolbar} role="toolbar" aria-label="셀 작업" onPointerDown={e => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); }}>
      <button type="button" disabled={busy || !history.canUndo} title="실행 취소 (Ctrl/⌘+Z)" onClick={() => tools.runHistory('undo', history.undo)}>실행 취소</button>
      <button type="button" disabled={busy || !history.canRedo} title="다시 실행 (Ctrl/⌘+Shift+Z)" onClick={() => tools.runHistory('redo', history.redo)}>다시 실행</button>
      <span className="tool-divider" />
      <button type="button" disabled={!tools.picked.size} title="선택한 셀 복사 (Ctrl/⌘+C)" onClick={() => { void tools.copy(); }}>복사</button>
      <button type="button" disabled={busy || !tools.picked.size} title="평가금액 칸에 붙여넣기 (Ctrl/⌘+V)" onClick={() => { void tools.paste(); }}>붙여넣기</button>
      {touch && <button type="button" aria-pressed={tools.touchSelection} onClick={() => tools.setTouchSelection(!tools.touchSelection)}>셀 선택</button>}
      <span className="selection-info" role="status">{tools.picked.size ? `${tools.picked.size}칸 선택${tools.numericCount ? ` · 합계 ${won(tools.total)}` : ''}` : touch ? '셀 선택을 켜고 범위의 양 끝을 누르세요' : '클릭 선택 · 두 번 클릭 편집'}</span>
    </div>}
    {rows.length ? <div className="table-scroll asset-scroll" ref={scroller} tabIndex={-1} role="region" aria-label="계좌별 원금·평가금액 표">
      <table className={`balance-table asset-table sheet-like${tools.touchSelection ? ' selecting' : ''}`} ref={tools.table} {...tools.tableProps} style={columns.tableStyle}>
      <thead><tr ref={columns.head}>
        {heads.map(([className, label, month], col) => <th key={col} scope="col" className={className || undefined} data-month={month}
          style={className.includes('stick-r') ? pin(col) : columns.width(col)}>{label}{columns.handle(col)}</th>)}
      </tr></thead>
      <tbody>{rows.map((r, row) => <tr key={r.account.id} className={edit === r.account.id ? 'editing' : undefined}>
        {[
          <th scope="row"><button className="line-name" disabled={busy} aria-label={`${r.account.name} 계좌 수정`} onClick={() => setEdit(edit === r.account.id ? null : r.account.id)}>{r.account.name}</button>
            <small>{accountKinds[r.account.kind]}</small></th>,
          <td className="numeric">{r.opening ? won(r.opening) : ''}</td>,
          ...r.months.map(m => <td className={`numeric${m.amount !== null && m.amount < 0 ? ' minus' : ''}`}>{m.amount === null ? '' : won(m.amount)}</td>),
          <td className="numeric asset-total stick-r r2" style={pin(totalCol)}>{won(r.principal)}</td>,
          <td className="numeric asset-value stick-r r1" style={pin(valueCol)}>{r.account.kind === 'invest'
            ? <><MoneyCell value={r.value} label={`${r.account.name} 평가금액`} disabled={busy || !thisYear} onError={onError}
                onSave={amount => { void perform({ type: 'balance', id: r.account.id, year: today.year, month: today.month, amount, checked_on: amount === null ? null : today.iso }); }} />
              <small>{checked(r.checkedOn, data.year) ?? '적은 값 없음'}</small></>
            : <span className="muted">{won(r.principal)}<small>원금과 같음</small></span>}</td>,
          <td className={`numeric stick-r r0${r.change !== null && r.change < 0 ? ' minus' : ''}`} style={pin(count - 1)}>
            {r.change === null ? <span className="muted">—</span> : <>{signed(r.change)}<small>{rate(r.change, r.principal).trim()}</small></>}</td>,
        ].map((cell, col) => tools.cell(row, col, cell))}
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row">합계</th><td className="numeric">{won(rows.reduce((sum, r) => sum + r.opening, 0))}</td>
        {visible.map((m, i) => { const sum = monthSum(i); return <td key={m} className="numeric">{sum === null ? '' : won(sum)}</td>; })}
        <td className="numeric asset-total stick-r r2" style={pin(totalCol)}>{won(totals.principal)}</td><td className="numeric stick-r r1" style={pin(valueCol)}>{won(totals.value)}</td>
        <td className={`numeric stick-r r0${totals.change < 0 ? ' minus' : ''}`} style={pin(count - 1)}>{signed(totals.change)}</td>
      </tr></tfoot>
    </table></div>
      : <p className="muted empty-chart">토스·ISA·적금처럼 돈을 넣는 계좌를 추가하고 월별 표의 저축 줄을 연결하면, 달마다 넣은 원금과 평가금액·증감이 여기에 보입니다.</p>}
    {rows.length > 0 && <p className="table-note">단위: 원 · 돈을 뺐으면 그 달 저축 줄에 마이너스로 적습니다. 계좌마다 기록 시작 달부터 원금을 더하고, 시작 원금은 그 전까지 넣은 돈입니다. 저축은 이자를 계산하지 않아 평가금액이 원금과 같습니다. 계좌 이름을 누르면 연결한 저축 줄·시작 달·시작 원금을 고칩니다.</p>}

    <h3 className="asset-subhead">묶인 돈</h3>
    {locked.length ? <div className="table-scroll"><table className="balance-table locked-table">
      <thead><tr><th scope="col">이름</th><th scope="col" className="numeric">금액</th><th scope="col" className="numeric">돌려받는 날</th></tr></thead>
      <tbody>{locked.map(a => <tr key={a.id} className={edit === a.id ? 'editing' : undefined}>
        <th scope="row"><button className="line-name" disabled={busy} aria-label={`${a.name} 수정`} onClick={() => setEdit(edit === a.id ? null : a.id)}>{a.name}</button></th>
        <td className="numeric">{won(a.principal)}</td><td className="numeric">{a.due_on ?? <span className="muted">—</span>}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">합계</th><td className="numeric">{won(totals.locked)}</td><td /></tr></tfoot>
    </table></div>
      : <p className="muted">보증금처럼 당장 꺼낼 수 없는 돈은 [+ 계좌 추가]에서 종류를 ‘묶인 돈’으로 고르면 여기에 모이고 총 자산에 더해집니다.</p>}
    {chart.length > 1 && <SavingsChart rows={chart} title="넣은 원금 누적" label="월별 넣은 원금 누적 그래프" name="원금" />}
  </>;
}

const kinds = Object.keys(accountKinds) as Account['kind'][];
function AccountForm({ account, data, today, busy, onSave, onCancel, onDelete, onError }: {
  account?: Account; data: Snapshot; today: string; busy: boolean;
  onSave: (fields: { name: string; kind: Account['kind']; principal: number; due_on: string | null; series: string[]; start_month: string | null }) => void;
  onCancel: () => void; onDelete?: () => void; onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<Account['kind']>(account?.kind ?? 'invest');
  const mine = new Set(account ? JSON.parse(account.series) as string[] : []);
  const owner = new Map(data.accounts.filter(a => a.id !== account?.id).flatMap(a => (JSON.parse(a.series) as string[]).map(s => [s, a.name] as const)));
  // 올해 저축 줄(같은 이름이 둘이면 예산으로 구분한다). 마지막 달의 이름을 쓴다.
  const saving = [...new Map(data.lines.filter(l => l.section === 'saving' && !l.series_id.startsWith('special:')).sort((a, b) => a.month - b.month).map(l => [l.series_id, l])).values()];
  const twice = (name: string) => saving.filter(l => l.name === name).length > 1;
  return <form onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    try {
      onSave({ name: String(form.get('name')).trim(), kind: accountKind.parse(form.get('kind')), principal: parseMoney(String(form.get('principal') ?? '')) ?? 0,
        due_on: kind === 'reserved' ? String(form.get('due_on') ?? '') || null : null, series: kind === 'reserved' ? [] : form.getAll('series').map(String),
        start_month: kind === 'reserved' ? null : String(form.get('start_month') ?? '') || null });
    } catch (error) { onError(error instanceof Error && !('issues' in error) ? error.message : '이름과 금액을 확인하세요.'); }
  }}>
    <div className="form-grid">
      <label>이름<input name="name" defaultValue={account?.name} maxLength={120} required placeholder={kind === 'reserved' ? '월세 보증금' : '토스'} /></label>
      <label>종류<select name="kind" value={kind} onChange={e => setKind(accountKind.parse(e.target.value))}>{kinds.map(k => <option key={k} value={k}>{accountKinds[k]}</option>)}</select></label>
      <label>{kind === 'reserved' ? '금액' : '시작 원금'}<input name="principal" inputMode="numeric" defaultValue={account?.principal || ''} placeholder="0" /></label>
      {kind !== 'reserved' && <label>기록 시작 달<input name="start_month" type="month" defaultValue={account ? account.start_month ?? '' : today} /></label>}
      {kind === 'reserved' && <label>돌려받는 날<input name="due_on" type="date" defaultValue={account?.due_on ?? ''} /></label>}
    </div>
    {kind !== 'reserved' && <fieldset className="series-pick"><legend>원금으로 더할 월별 표 저축 줄</legend>
      {saving.length ? saving.map(l => <label key={l.series_id}>
        <input type="checkbox" name="series" value={l.series_id} defaultChecked={mine.has(l.series_id)} disabled={owner.has(l.series_id)} />
        {l.name}{twice(l.name) && <small> · 예산 {won(l.budget)}</small>}{owner.has(l.series_id) && <small> · {owner.get(l.series_id)}에 연결됨</small>}
      </label>) : <p className="muted">{data.year}년 월별 표에 저축 줄이 없습니다.</p>}
      <small className="muted">기록 시작 달부터 이 줄들의 금액을 원금에 더합니다. 시작 원금은 그 달 전까지 넣어 둔 원금입니다(시작 달을 비우면 처음부터 셉니다).</small>
    </fieldset>}
    <div className="actions"><button className="primary" disabled={busy}>저장</button><button type="button" onClick={onCancel}>취소</button>{onDelete && <button className="danger" type="button" disabled={busy} onClick={onDelete}>삭제</button>}</div>
  </form>;
}
