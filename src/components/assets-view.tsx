'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Account } from '../db/schema';
import type { Snapshot } from './ledger-app';
import { assetRows, computeLines } from '../lib/calculations';
import { accountKinds, won } from '../lib/labels';
import { accountKind, parseMoney } from '../lib/validation';
import { MoneyCell } from './money-cell';
import { SavingsChart } from './summary-charts';

type Props = { data: Snapshot; busy: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void };
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

// 자산: 저축·투자 계좌마다 달별로 넣은 원금(월별 표 저축 줄), 총 원금·평가금액·증감, 그리고 묶인 돈.
export function AssetsView({ data, busy, perform, onError }: Props) {
  const [edit, setEdit] = useState<string | null>(null);
  const today = seoulToday();
  const { rows, locked, totals, history } = assetRows(data.accounts, computeLines(data.lines, data.entries, data.adjustments), data.balances, data.assetCarry, data.year, today);
  const editing = edit && edit !== 'new' ? data.accounts.find(a => a.id === edit) : undefined;
  const thisYear = data.year === today.year;
  // 처음 열 때: 넓은 화면은 이번 달이 오른쪽(붙어 있는 합계 열 앞)에 오게, 폰은 합계 열이 보이게 오른쪽 끝으로 민다.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return;
    if (matchMedia('(max-width: 700px)').matches) { el.scrollLeft = el.scrollWidth; return; }
    const col = el.querySelector<HTMLElement>(`thead [data-month="${data.year === today.year ? today.month : 12}"]`);
    const pinned = [...el.querySelectorAll<HTMLElement>('thead .stick-r')].reduce((sum, th) => sum + th.offsetWidth, 0);
    if (col) el.scrollLeft = Math.max(0, col.offsetLeft + col.offsetWidth - (el.clientWidth - pinned));
  }, [data.year, today.year, today.month, rows.length]);
  const monthSum = (month: number) => rows.some(r => r.months[month - 1].amount !== null) ? rows.reduce((sum, r) => sum + (r.months[month - 1].amount ?? 0), 0) : null;

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
      <AccountForm key={edit} account={editing} data={data} busy={busy} onError={onError} onCancel={() => setEdit(null)}
        onSave={async fields => { if (await perform({ type: 'account-save', id: editing?.id, ...fields })) setEdit(null); }}
        onDelete={editing && (async () => {
          if (confirm(`“${editing.name}” 계좌와 지금까지 적은 평가금액 기록을 삭제할까요? 월별 표의 저축 줄은 그대로입니다.`) && await perform({ type: 'account-delete', id: editing.id })) setEdit(null);
        })} />
    </div>}

    {rows.length ? <div className="table-scroll asset-scroll" ref={scroller} tabIndex={0} role="region" aria-label="계좌별 원금·평가금액 표"><table className="balance-table asset-table">
      <thead><tr>
        <th scope="col">계좌</th><th scope="col" className="numeric">이월 원금</th>
        {Array.from({ length: 12 }, (_, i) => <th key={i} scope="col" className="numeric" data-month={i + 1}>{i + 1}월</th>)}
        <th scope="col" className="numeric asset-total stick-r r2">총 원금</th><th scope="col" className="numeric stick-r r1">평가금액</th><th scope="col" className="numeric stick-r r0">증감</th>
      </tr></thead>
      <tbody>{rows.map(r => <tr key={r.account.id} className={edit === r.account.id ? 'editing' : undefined}>
        <th scope="row"><button className="line-name" disabled={busy} aria-label={`${r.account.name} 계좌 수정`} onClick={() => setEdit(edit === r.account.id ? null : r.account.id)}>{r.account.name}</button>
          <small>{accountKinds[r.account.kind]}</small></th>
        <td className="numeric">{r.opening ? won(r.opening) : ''}</td>
        {r.months.map(m => <td key={m.month} className={`numeric${m.future ? ' future' : ''}${m.amount !== null && m.amount < 0 ? ' minus' : ''}`}>
          {m.amount === null ? '' : m.future ? `(${won(m.amount)})` : won(m.amount)}</td>)}
        <td className="numeric asset-total stick-r r2">{won(r.principal)}</td>
        <td className="numeric asset-value stick-r r1">{r.account.kind === 'invest'
          ? <><MoneyCell value={r.value} label={`${r.account.name} 평가금액`} disabled={busy || !thisYear} onError={onError}
              onSave={amount => { void perform({ type: 'balance', id: r.account.id, year: today.year, month: today.month, amount, checked_on: amount === null ? null : today.iso }); }} />
            <small>{checked(r.checkedOn, data.year) ?? '적은 값 없음'}</small></>
          : <span className="muted">{won(r.principal)}<small>원금과 같음</small></span>}</td>
        <td className={`numeric stick-r r0${r.change !== null && r.change < 0 ? ' minus' : ''}`}>
          {r.change === null ? <span className="muted">—</span> : <>{signed(r.change)}<small>{rate(r.change, r.principal).trim()}</small></>}</td>
      </tr>)}</tbody>
      <tfoot><tr>
        <th scope="row">합계</th><td className="numeric">{won(rows.reduce((sum, r) => sum + r.opening, 0))}</td>
        {Array.from({ length: 12 }, (_, i) => { const sum = monthSum(i + 1); const future = data.year * 12 + i + 1 > today.year * 12 + today.month;
          return <td key={i} className={`numeric${future ? ' future' : ''}`}>{sum === null ? '' : future ? `(${won(sum)})` : won(sum)}</td>; })}
        <td className="numeric asset-total stick-r r2">{won(totals.principal)}</td><td className="numeric stick-r r1">{won(totals.value)}</td>
        <td className={`numeric stick-r r0${totals.change < 0 ? ' minus' : ''}`}>{signed(totals.change)}</td>
      </tr></tfoot>
    </table></div>
      : <p className="muted empty-chart">토스·ISA·적금처럼 돈을 넣는 계좌를 추가하고 월별 표의 저축 줄을 연결하면, 달마다 넣은 원금과 평가금액·증감이 여기에 보입니다.</p>}
    {rows.length > 0 && <p className="table-note">단위: 원 · 돈을 뺐으면 그 달 저축 줄에 마이너스로 적습니다. 괄호는 아직 오지 않은 달로 총 원금에 넣지 않습니다. 저축은 이자를 계산하지 않아 평가금액이 원금과 같습니다. 계좌 이름을 누르면 연결한 저축 줄·시작 원금을 고칩니다.</p>}

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
    {history.length > 1 && <SavingsChart rows={history} title="넣은 원금 누적" label="월별 넣은 원금 누적 그래프" name="원금" />}
  </>;
}

const kinds = Object.keys(accountKinds) as Account['kind'][];
function AccountForm({ account, data, busy, onSave, onCancel, onDelete, onError }: {
  account?: Account; data: Snapshot; busy: boolean;
  onSave: (fields: { name: string; kind: Account['kind']; principal: number; due_on: string | null; series: string[] }) => void;
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
        due_on: kind === 'reserved' ? String(form.get('due_on') ?? '') || null : null, series: kind === 'reserved' ? [] : form.getAll('series').map(String) });
    } catch (error) { onError(error instanceof Error && !('issues' in error) ? error.message : '이름과 금액을 확인하세요.'); }
  }}>
    <div className="form-grid">
      <label>이름<input name="name" defaultValue={account?.name} maxLength={120} required placeholder={kind === 'reserved' ? '월세 보증금' : '토스'} /></label>
      <label>종류<select name="kind" value={kind} onChange={e => setKind(accountKind.parse(e.target.value))}>{kinds.map(k => <option key={k} value={k}>{accountKinds[k]}</option>)}</select></label>
      <label>{kind === 'reserved' ? '금액' : '시작 원금'}<input name="principal" inputMode="numeric" defaultValue={account?.principal || ''} placeholder="0" /></label>
      {kind === 'reserved' && <label>돌려받는 날<input name="due_on" type="date" defaultValue={account?.due_on ?? ''} /></label>}
    </div>
    {kind !== 'reserved' && <fieldset className="series-pick"><legend>원금으로 더할 월별 표 저축 줄</legend>
      {saving.length ? saving.map(l => <label key={l.series_id}>
        <input type="checkbox" name="series" value={l.series_id} defaultChecked={mine.has(l.series_id)} disabled={owner.has(l.series_id)} />
        {l.name}{twice(l.name) && <small> · 예산 {won(l.budget)}</small>}{owner.has(l.series_id) && <small> · {owner.get(l.series_id)}에 연결됨</small>}
      </label>) : <p className="muted">{data.year}년 월별 표에 저축 줄이 없습니다.</p>}
      <small className="muted">시작 원금은 이 가계부에 기록하기 전에 넣어 둔 원금입니다.</small>
    </fieldset>}
    <div className="actions"><button className="primary" disabled={busy}>저장</button><button type="button" onClick={onCancel}>취소</button>{onDelete && <button className="danger" type="button" disabled={busy} onClick={onDelete}>삭제</button>}</div>
  </form>;
}
