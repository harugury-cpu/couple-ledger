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
// 자산의 손익 색: 오르면 빨강, 내리면 파랑(증권 앱과 같은 관례). 자산 탭에서만 쓴다.
const trend = (n: number | null) => n === null || n === 0 ? '' : n > 0 ? ' rise' : ' fall';
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
  const { rows, locked, visible, isDirect, totals, history: chart } = assetRows(data.accounts, computeLines(data.lines, data.entries, data.adjustments), data.balances, data.assetCarry, data.year,
    data.deposits, data.lastMonth || Infinity, today.year * 12 + today.month);
  const editing = edit && edit !== 'new' ? data.accounts.find(a => a.id === edit) : undefined;
  const thisYear = data.year === today.year;
  // 이월 원금 칸을 고치면 그 값이 되도록 시작 원금을 맞춘다(지난해까지 쌓인 금액은 그대로).
  const saveOpening = (row: (typeof rows)[number], opening: number) => perform({ type: 'account-save', id: row.account.id, name: row.account.name, kind: row.account.kind, target: row.account.target,
    principal: opening - (row.opening - row.account.principal), due_on: row.account.due_on, series: JSON.parse(row.account.series), start_month: row.account.start_month });
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
    readOnly: (row, col) => {
      const r = rows[row];
      if (r.closed) return `${r.account.name}은(는) ${shortDate(r.closed.on)}에 해지한 계좌입니다. 계좌 이름을 눌러 해지를 취소할 수 있습니다.`;
      if (col >= 2 && col < totalCol && r.months[col - 2].before) return `${r.account.name}은(는) 기록 시작 달이 ${Number(r.account.start_month!.slice(5, 7))}월이라 그 전 달은 적지 않습니다. 계좌 이름을 눌러 시작 달을 바꾸세요.`;
      if (col >= 2 && col < totalCol) return `${r.account.name}에는 월별 표 저축 줄이 둘 이상 연결돼 있어 ${visible[col - 2]}월 원금은 월별 표에서 고칩니다.`;
      if (col === valueCol) return thisYear ? '저축은 이자를 계산하지 않아 평가금액이 원금과 같습니다. 원금은 이월 원금·달 칸에서 고칩니다.' : '평가금액은 올해 화면에서 적습니다.';
      return '총 원금과 증감은 자동으로 계산됩니다.';
    },
    // 붙여넣기는 직접 적는 칸에만 된다: 투자 계좌의 평가금액(오늘 확인한 값), 직접 입력 계좌의 달 칸.
    paste: async changes => {
      // 값 확인을 먼저 모두 끝낸 뒤(틀린 칸이 있으면 아무것도 쓰지 않는다) 차례로 저장한다.
      const writes = changes.map((c): () => Promise<unknown> => {
        const row = rows.find(r => r.account.id === c.id)!;
        if (row.closed) throw new Error(`${row.account.name}은(는) 해지한 계좌라 고칠 수 없습니다.`);
        if (c.col === 1) { const amount = parseMoney(c.value) ?? 0; return () => saveOpening(row, amount); }
        if (c.col >= 2 && c.col < totalCol && row.months[c.col - 2].before) throw new Error(`${row.account.name}은(는) 기록 시작 달 전 달에는 적을 수 없습니다.`);
        if (c.col >= 2 && c.col < totalCol && isDirect(row.account)) { const command = { type: 'deposit', id: c.id, year: data.year, month: visible[c.col - 2], amount: parseMoney(c.value, true) }; return () => perform(command); }
        const line = c.col >= 2 && c.col < totalCol ? row.months[c.col - 2].lineId : null;
        if (line) { const command = { type: 'amount', id: line, amount: parseMoney(c.value, true) }; return () => perform(command); }
        if (c.col !== valueCol || row.account.kind !== 'invest' || !thisYear) throw new Error('이 칸은 붙여넣을 수 없습니다. 저축 줄이 둘 이상인 달은 월별 표에서 고치세요.');
        const command = { type: 'balance', id: c.id, year: today.year, month: today.month, amount: parseMoney(c.value, true), checked_on: today.iso };
        return () => perform(command);
      });
      for (const write of writes) if (!await write()) return false;
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
  const openRows = rows.filter(r => !r.closed);
  // 계좌 줄 끌어 옮기기(월별 표와 같은 손잡이 ⠿): from 번째 줄을 at 번째 줄 앞 자리로. 해지한 계좌는 늘 맨 아래라 옮기지 않는다.
  const [drag, setDrag] = useState<number | null>(null);
  const [drop, setDrop] = useState<number | null>(null);
  const endDrag = () => { setDrag(null); setDrop(null); };
  const moveTo = (from: number, at: number) => {
    if (at === from || at === from + 1 || at < 0 || at > openRows.length) return;
    void perform({ type: 'account-move', id: openRows[from].account.id, before: at < openRows.length ? openRows[at].account.id : null });
  };
  const monthSum = (i: number) => openRows.some(r => r.months[i].amount !== null) ? openRows.reduce((sum, r) => sum + (r.months[i].amount ?? 0), 0) : null;
  const heads: [string, React.ReactNode, number?][] = [
    ['', '계좌'], ['numeric', '이월 원금'], ...visible.map(m => ['numeric', `${m}월`, m] as [string, string, number]),
    // 총 원금에 넣은 마지막 달(올해는 이번 달, 지난해는 12월). 앞으로 올 해는 이월 원금뿐이다.
    ['numeric stick-r r2', thisYear ? `총 원금(~${today.month}월)` : data.year < today.year ? '총 원금(~12월)' : '총 원금'], ['numeric asset-key stick-r r1', '평가금액'], ['numeric stick-r r0', '증감'],
  ];

  return <>
    <div className="section-heading"><div>
      <h2>자산</h2>
      <p className="muted">달마다 넣은 원금은 월별 표의 저축 줄에서 가져옵니다. 평가금액은 증권 앱에서 본 값을 확인한 날 적습니다.</p>
    </div></div>
    {/* 맨 위 큰 숫자는 지금 쓸 수 있는 돈(저축·투자 계좌 평가금액 합계). 보증금 같은 묶인 돈을 더한 총 자산과 원금·증감은 그 아래 작게 */}
    <section className="asset-hero" aria-label="자산 요약">
      <div className="asset-hero-head"><p>지금 쓸 수 있는 돈 <span>{today.year}년 {today.month}월 {Number(today.iso.slice(8, 10))}일 기준</span></p></div>
      <p className="asset-hero-total">{won(totals.value)}<span>원</span></p>
      <dl className="asset-hero-parts">
        <div><dt>총 자산(묶인 돈 포함)</dt><dd>{won(totals.total)}</dd></div>
        <div><dt>묶인 돈</dt><dd>{won(totals.locked)}</dd></div>
        <div><dt>넣은 원금</dt><dd>{won(totals.principal)}</dd></div>
        <div><dt>증감</dt><dd className={trend(totals.change).trim()}>{signed(totals.change)}<span>{rate(totals.change, totals.principal)}</span></dd></div>
      </dl>
    </section>
    {(edit === 'new' || editing) && <div className="edit-panel balance-panel"><h3>{editing ? `${editing.name} 수정` : '새 계좌'}</h3>
      <AccountForm key={edit} account={editing} data={data} today={today.iso.slice(0, 7)} busy={busy} onError={onError} onCancel={() => setEdit(null)}
        onCloseAccount={editing && (async fields => { if (await perform({ type: 'account-close', id: editing.id, ...fields })) setEdit(null); })}
        onSave={async fields => { if (await perform({ type: 'account-save', id: editing?.id, ...fields })) setEdit(null); }}
        onDelete={editing && (async () => {
          if (confirm(`“${editing.name}” 계좌와 지금까지 적은 평가금액 기록을 삭제할까요? 월별 표의 저축 줄은 그대로입니다.`) && await perform({ type: 'account-delete', id: editing.id })) setEdit(null);
        })} />
    </div>}

    <div className="sheet-tools" ref={tools.toolbar} role="toolbar" aria-label="셀 작업" onPointerDown={e => { if (e.target instanceof Element && e.target.closest('button')) e.preventDefault(); }}>
      <button type="button" disabled={busy} onClick={() => setEdit(edit === 'new' ? null : 'new')}>+ 계좌 추가</button>
      {rows.length > 0 && <><span className="tool-divider" />
      <button type="button" disabled={busy || !history.canUndo} title="실행 취소 (Ctrl/⌘+Z)" onClick={() => tools.runHistory('undo', history.undo)}>실행 취소</button>
      <button type="button" disabled={busy || !history.canRedo} title="다시 실행 (Ctrl/⌘+Shift+Z)" onClick={() => tools.runHistory('redo', history.redo)}>다시 실행</button>
      <span className="tool-divider" />
      <button type="button" disabled={!tools.picked.size} title="선택한 셀 복사 (Ctrl/⌘+C)" onClick={() => { void tools.copy(); }}>복사</button>
      <button type="button" disabled={busy || !tools.picked.size} title="평가금액 칸에 붙여넣기 (Ctrl/⌘+V)" onClick={() => { void tools.paste(); }}>붙여넣기</button>
      {touch && <button type="button" aria-pressed={tools.touchSelection} onClick={() => tools.setTouchSelection(!tools.touchSelection)}>셀 선택</button>}
      <span className="selection-info" role="status">{tools.picked.size ? `${tools.picked.size}칸 선택${tools.numericCount ? ` · 합계 ${won(tools.total)}` : ''}` : touch ? '셀 선택을 켜고 범위의 양 끝을 누르세요' : '클릭 선택 · 두 번 클릭 편집'}</span></>}
    </div>
    {rows.length ? <div className="table-scroll asset-scroll" ref={scroller} tabIndex={-1} role="region" aria-label="계좌별 원금·평가금액 표">
      <table className={`balance-table asset-table sheet-like${tools.touchSelection ? ' selecting' : ''}`} ref={tools.table} {...tools.tableProps} style={columns.tableStyle}>
      <thead><tr ref={columns.head}>
        {heads.map(([className, label, month], col) => <th key={col} scope="col" className={className || undefined} data-month={month}
          style={className.includes('stick-r') ? pin(col) : columns.width(col)}>{label}{columns.handle(col)}</th>)}
      </tr></thead>
      <tbody>{rows.map((r, row) => <tr key={r.account.id}
        className={[edit === r.account.id ? 'editing' : '', r.closed ? 'closed' : '', drag === row ? 'dragging' : '',
          drag !== null && drop === row ? 'drop-before' : drag !== null && drop === openRows.length && row === openRows.length - 1 ? 'drop-after' : ''].join(' ').trim() || undefined}
        onDragOver={drag === null || r.closed ? undefined : e => {
          e.preventDefault(); e.dataTransfer.dropEffect = 'move'; const box = e.currentTarget.getBoundingClientRect();
          const at = e.clientY > box.top + box.height / 2 ? row + 1 : row; setDrop(at === drag || at === drag + 1 ? null : at);
        }} onDrop={drag === null ? undefined : e => { e.preventDefault(); if (drop !== null) moveTo(drag, drop); endDrag(); }}>
        {[
          <th scope="row">{!phone && !r.closed && !busy && <span className="line-grip" role="button" tabIndex={0} draggable aria-label={`${r.account.name} 순서 옮기기 (끌거나 위·아래 화살표)`} title="끌어서 순서 옮기기"
              onDragStart={e => {
                e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.account.id);
                const tr = e.currentTarget.closest('tr'); if (tr) e.dataTransfer.setDragImage(tr, 24, tr.offsetHeight / 2);
                setDrag(row);
              }} onDragEnd={endDrag}
              onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); moveTo(row, row - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); moveTo(row, row + 2); } }}>⠿</span>}
            <button className="line-name" disabled={busy} aria-label={`${r.account.name} 계좌 수정`} onClick={() => setEdit(edit === r.account.id ? null : r.account.id)}>{r.account.name}</button>
            <small>{r.closed ? `해지 ${shortDate(r.closed.on)}${r.closed.note ? ` · → ${r.closed.note}` : ''}` : `${accountKinds[r.account.kind]}${r.lockedUntil ? ` · 묶임 ~${r.lockedUntil.slice(0, 7).replace('-', '.')}` : ''}`}</small></th>,
          <td className="numeric"><MoneyCell value={r.opening || null} label={`${r.account.name} 이월 원금`} disabled={busy || !!r.closed} onError={onError}
            onSave={amount => { void saveOpening(r, amount ?? 0); }} /></td>,
          ...r.months.map(m => m.before || m.closed ? <td className="numeric before" />
            : isDirect(r.account)
            // 직접 입력 계좌: 달 칸에 바로 적는다. 앞 달에서 이어 쓴 값은 흐리게 보인다.
            ? <td className={`numeric${m.carried ? ' carried' : ''}${m.future ? ' future' : ''}`}><MoneyCell value={m.amount} signed label={`${r.account.name} ${m.month}월 입금`} disabled={busy} onError={onError}
                onSave={amount => { void perform({ type: 'deposit', id: r.account.id, year: data.year, month: m.month, amount }); }} /></td>
            : m.lineId
              // 연결된 저축 줄이 하나인 달: 칸에서 고치면 월별 표 그 줄 금액이 바뀐다(매달 같은 금액 줄이면 뒤 달로 이어진다).
              ? <td className={`numeric${m.future ? ' future' : ''}`}><MoneyCell value={m.amount} signed label={`${r.account.name} ${m.month}월 원금`} disabled={busy} onError={onError}
                  onSave={amount => { void perform({ type: 'amount', id: m.lineId!, amount }); }} /></td>
              : <td className={`numeric${m.future ? ' future' : m.amount !== null && m.amount < 0 ? ' minus' : ''}`} title={m.amount === null ? undefined : '저축 줄이 둘 이상이라 월별 표에서 고칩니다'}>{m.amount === null ? '' : won(m.amount)}</td>),
          <td className="numeric stick-r r2" style={pin(totalCol)}>{won(r.principal)}</td>,
          <td className="numeric asset-value asset-key stick-r r1" style={pin(valueCol)}>{r.closed
            // 해지한 계좌: 평가금액 대신 받은 금액
            ? <span className="muted">{won(r.closed.amount)}<small>해지하고 받은 돈</small></span>
            : r.account.kind === 'invest'
            ? <><MoneyCell value={r.value} label={`${r.account.name} 평가금액`} disabled={busy || !thisYear} onError={onError}
                onSave={amount => { void perform({ type: 'balance', id: r.account.id, year: today.year, month: today.month, amount, checked_on: amount === null ? null : today.iso }); }} />
              <small>{checked(r.checkedOn, data.year) ?? '적은 값 없음'}</small></>
            : <span className="muted">{won(r.principal)}<small>원금과 같음</small></span>}</td>,
          <td className={`numeric stick-r r0${trend(r.closed ? r.closed.profit : r.change)}`} style={pin(count - 1)}>
            {r.closed ? <>{signed(r.closed.profit)}<small>최종</small></>
              : r.change === null ? <span className="muted">—</span> : <>{signed(r.change)}<small>{rate(r.change, r.principal).trim()}</small></>}</td>,
        ].map((cell, col) => tools.cell(row, col, cell))}
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row">합계</th><td className="numeric">{won(openRows.reduce((sum, r) => sum + r.opening, 0))}</td>
        {visible.map((m, i) => { const sum = monthSum(i); return <td key={m} className={`numeric${rows[0]?.months[i].future ? ' future' : ''}`}>{sum === null ? '' : won(sum)}</td>; })}
        <td className="numeric stick-r r2" style={pin(totalCol)}>{won(totals.principal)}</td><td className="numeric asset-key stick-r r1" style={pin(valueCol)}>{won(totals.allValue)}</td>
        <td className={`numeric stick-r r0${trend(totals.change)}`} style={pin(count - 1)}>{signed(totals.change)}</td>
      </tr></tfoot>
    </table></div>
      : <p className="muted empty-chart">토스·ISA·적금처럼 돈을 넣는 계좌를 추가하고 월별 표의 저축 줄을 연결하면, 달마다 넣은 원금과 평가금액·증감이 여기에 보입니다.</p>}
    {rows.length > 0 && <p className="table-note">단위: 원 · 회색은 아직 오지 않은 달로 총 원금에 넣지 않습니다. 돈을 뺐으면 그 달 저축 줄에 마이너스로 적습니다. 계좌마다 기록 시작 달부터 원금을 더하고, 시작 원금은 그 전까지 넣은 돈입니다. 저축은 이자를 계산하지 않아 평가금액이 원금과 같습니다. 계좌 이름을 누르면 연결한 저축 줄·시작 달·시작 원금을 고칩니다.</p>}

    <h3 className="asset-subhead">묶인 돈</h3>
    {locked.length ? <div className="table-scroll"><table className="balance-table locked-table">
      <thead><tr><th scope="col">이름</th><th scope="col" className="numeric">금액</th><th scope="col" className="numeric">돌려받는 날</th></tr></thead>
      <tbody>{locked.map(a => <tr key={a.id} className={[edit === a.id ? 'editing' : '', a.closed_on ? 'closed' : ''].join(' ').trim() || undefined}>
        <th scope="row"><button className="line-name" disabled={busy} aria-label={`${a.name} 수정`} onClick={() => setEdit(edit === a.id ? null : a.id)}>{a.name}</button>
          {a.closed_on && <small>돌려받음 {shortDate(a.closed_on)} · {won(a.closed_amount ?? 0)}{a.closed_note ? ` · → ${a.closed_note}` : ''}</small>}</th>
        <td className="numeric">{won(a.principal)}</td><td className="numeric">{a.due_on ?? <span className="muted">—</span>}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row">합계</th><td className="numeric">{won(locked.filter(a => !a.closed_on).reduce((sum, a) => sum + a.principal, 0))}</td><td /></tr></tfoot>
    </table></div>
      : <p className="muted">보증금처럼 당장 꺼낼 수 없는 돈은 [+ 계좌 추가]에서 종류를 ‘묶인 돈’으로 고르면 여기에 모이고 총 자산에 더해집니다.</p>}
    {chart.length > 1 && <SavingsChart rows={chart} title="넣은 원금 누적" label="월별 넣은 원금 누적 그래프" name="원금" />}
  </>;
}

const kinds = Object.keys(accountKinds) as Account['kind'][];
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// 해지: 해지한 날·받은 금액·어디로 보냈는지(어떻게 썼는지)를 남긴다. 해지한 계좌는 [해지 취소]로 되돌린다.
// 계좌 수정 form 안에 있지만 따로 보내므로 버튼은 모두 type="button"이다.
function CloseAccount({ account, busy, onError, onClose }: { account: Account; busy: boolean; onError: (message: string) => void;
  onClose: (fields: { closed_on: string | null; closed_amount: number | null; closed_note: string | null }) => void }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [on, setOn] = useState(today); const [amount, setAmount] = useState(''); const [note, setNote] = useState('');
  if (account.closed_on) return <div className="close-account"><h4>해지함</h4>
    <p className="muted">{account.closed_on} · 받은 돈 {won(account.closed_amount ?? 0)}원{account.closed_note ? ` · → ${account.closed_note}` : ''}</p>
    <div className="actions"><button type="button" disabled={busy} onClick={() => onClose({ closed_on: null, closed_amount: null, closed_note: null })}>해지 취소</button></div></div>;
  return <div className="close-account"><h4>해지하기</h4>
    <div className="form-grid">
      <label>해지한 날<input type="date" value={on} onChange={e => setOn(e.target.value)} /></label>
      <label>{account.kind === 'reserved' ? '돌려받은 금액' : '받은 금액'}<input inputMode="numeric" value={amount} placeholder="0" onChange={e => setAmount(e.target.value)} /></label>
      <label className="close-note">어디로 보냈는지 · 어떻게 썼는지<input value={note} maxLength={500} placeholder="예: 생활비 통장으로, 전세 대출 상환" onChange={e => setNote(e.target.value)} /></label>
    </div>
    <div className="actions"><button type="button" className="danger" disabled={busy} onClick={() => {
      try {
        const received = parseMoney(amount);
        if (!on || received === null) { onError('해지한 날과 받은 금액을 적으세요.'); return; }
        if (confirm(`“${account.name}”을(를) ${on}에 해지로 기록할까요? 합계에서 빠지고 표 아래에 회색으로 남습니다.`)) onClose({ closed_on: on, closed_amount: received, closed_note: note.trim() || null });
      } catch (error) { onError(error instanceof Error ? error.message : '받은 금액을 확인하세요.'); }
    }}>해지</button></div></div>;
}
function AccountForm({ account, data, today, busy, onSave, onCancel, onDelete, onError, onCloseAccount }: {
  account?: Account; data: Snapshot; today: string; busy: boolean;
  onSave: (fields: { name: string; kind: Account['kind']; principal: number; due_on: string | null; series: string[]; start_month: string | null }) => void;
  onCancel: () => void; onDelete?: () => void; onError: (message: string) => void;
  onCloseAccount?: (fields: { closed_on: string | null; closed_amount: number | null; closed_note: string | null }) => void;
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
        due_on: String(form.get('due_on') ?? '') || null, series: kind === 'reserved' ? [] : form.getAll('series').map(String),
        start_month: kind === 'reserved' ? null : String(form.get('start_month') ?? '') || null });
    } catch (error) { onError(error instanceof Error && !('issues' in error) ? error.message : '이름과 금액을 확인하세요.'); }
  }}>
    <div className="form-grid">
      <label>이름<input name="name" defaultValue={account?.name} maxLength={120} required placeholder={kind === 'reserved' ? '월세 보증금' : '토스'} /></label>
      <label>종류<select name="kind" value={kind} onChange={e => setKind(accountKind.parse(e.target.value))}>{kinds.map(k => <option key={k} value={k}>{accountKinds[k]}</option>)}</select></label>
      <label>{kind === 'reserved' ? '금액' : '시작 원금'}<input name="principal" inputMode="numeric" defaultValue={account?.principal || ''} placeholder="0" /></label>
      {kind !== 'reserved' && <label>기록 시작 달<input name="start_month" type="month" defaultValue={account ? account.start_month ?? '' : today} /></label>}
      {/* 묶인 돈은 돌려받는 날, 저축·투자는 꺼낼 수 있는 날(퇴직연금처럼 묶인 계좌만 적는다) */}
      <label>{kind === 'reserved' ? '돌려받는 날' : '꺼낼 수 있는 날(묶인 계좌만)'}<input name="due_on" type="date" defaultValue={account?.due_on ?? ''} /></label>
    </div>
    {kind !== 'reserved' && <fieldset className="series-pick"><legend>원금으로 더할 월별 표 저축 줄</legend>
      {saving.length ? saving.map(l => <label key={l.series_id}>
        <input type="checkbox" name="series" value={l.series_id} defaultChecked={mine.has(l.series_id)} disabled={owner.has(l.series_id)} />
        {l.name}{twice(l.name) && <small> · 예산 {won(l.budget)}</small>}{owner.has(l.series_id) && <small> · {owner.get(l.series_id)}에 연결됨</small>}
      </label>) : <p className="muted">{data.year}년 월별 표에 저축 줄이 없습니다.</p>}
      <small className="muted">저축 줄을 고르지 않으면 자산 표의 달 칸에 직접 적습니다(다른 사람이 보내 주는 돈처럼 월별 표에 없는 돈). 적은 금액은 뒤 달로 이어지고, 그만 들어오면 0을 적습니다.<br />기록 시작 달부터 이 줄들의 금액을 원금에 더합니다. 시작 원금은 그 달 전까지 넣어 둔 원금입니다(시작 달을 비우면 처음부터 셉니다).</small>
    </fieldset>}
    <div className="actions"><button className="primary" disabled={busy}>저장</button><button type="button" onClick={onCancel}>취소</button>{onDelete && <button className="danger" type="button" disabled={busy} onClick={onDelete}>삭제</button>}</div>
    {account && onCloseAccount && <CloseAccount account={account} busy={busy} onError={onError} onClose={onCloseAccount} />}
  </form>;
}
