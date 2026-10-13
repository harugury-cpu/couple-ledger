'use client';
import { useState } from 'react';
import type { Account } from '../db/schema';
import type { Snapshot } from './ledger-app';
import { accountRows, accountTotals, balanceHistory } from '../lib/calculations';
import { accountKind, parseMoney } from '../lib/validation';
import { accountKinds, won } from '../lib/labels';
import { MoneyCell } from './money-cell';
import { SavingsChart } from './summary-charts';

type Props = { data: Snapshot; month: number; busy: boolean; perform: (command: object) => Promise<unknown>; onError: (message: string) => void; onMonth: (month: number) => void };
const kinds = Object.keys(accountKinds) as Account['kind'][];
const signed = (n: number) => `${n > 0 ? '+' : ''}${won(n)}`;

// 쌓여 있는 돈을 계좌마다 직접 적는 화면. 월별 표와 연결하지 않고, 적은 숫자끼리만 비교한다.
export function BalanceView({ data, month, busy, perform, onError, onMonth }: Props) {
  const [edit, setEdit] = useState<string | null>(null);
  const rows = accountRows(data.accounts, data.balances, data.year, month);
  const totals = accountTotals(rows);
  const history = balanceHistory(data.accounts, data.balances, data.year);
  const editing = edit && edit !== 'new' ? data.accounts.find(a => a.id === edit) : undefined;
  // 지난해 기록과 비교할 때는 연도도 함께 보여 준다.
  const when = (r: { year: number; month: number }) => r.year === data.year ? `${r.month}월` : `${r.year % 100}년 ${r.month}월`;

  return <>
    <div className="section-heading"><div>
      <h2>잔액</h2>
      <div className="month-step">
        <button aria-label="이전 달" disabled={busy || month === 1} onClick={() => onMonth(month - 1)}>‹</button>
        <strong>{month}월</strong>
        <button aria-label="다음 달" disabled={busy || month === 12} onClick={() => onMonth(month + 1)}>›</button>
      </div>
      <p className="muted">은행 앱에서 본 잔액을 계좌마다 적습니다. 이 달에 적지 않은 계좌는 마지막으로 적은 잔액으로 셉니다.</p>
    </div></div>
    <div className="month-bar">
      <dl className="month-summary" aria-label={`${month}월 잔액 요약`}>
        <div className="lead"><dt>합계</dt><dd className={totals.total < 0 ? 'minus' : ''}>{won(totals.total)}</dd></div>
        {kinds.map(k => <div key={k}><dt>{accountKinds[k]}</dt><dd>{won(totals[k])}</dd></div>)}
      </dl>
      <button disabled={busy} onClick={() => setEdit(edit === 'new' ? null : 'new')}>+ 계좌 추가</button>
    </div>
    {(edit === 'new' || editing) && <div className="edit-panel balance-panel"><h3>{editing ? `${editing.name} 수정` : '새 계좌'}</h3>
      <AccountForm key={edit} account={editing} busy={busy} onError={onError} onCancel={() => setEdit(null)}
        onSave={async fields => { if (await perform({ type: 'account-save', id: editing?.id, ...fields })) setEdit(null); }}
        onDelete={editing && (async () => {
          if (confirm(`“${editing.name}” 계좌와 지금까지 적은 잔액 기록을 모두 삭제할까요?`) && await perform({ type: 'account-delete', id: editing.id })) setEdit(null);
        })} />
    </div>}
    {rows.length ? <div className="table-scroll"><table className="balance-table">
      <thead><tr><th scope="col">계좌</th><th scope="col" className="numeric c-bal">{month}월 잔액</th><th scope="col" className="numeric c-chg">지난 기록 대비</th><th scope="col" className="numeric c-goal d">목표</th></tr></thead>
      <tbody>{kinds.filter(k => rows.some(r => r.kind === k)).map(k => [
        <tr key={k} className={`band ${k}`}><th scope="rowgroup">{accountKinds[k]}</th><td className="numeric">{won(totals[k])}</td><td /><td className="d" /></tr>,
        ...rows.filter(r => r.kind === k).map(r => <tr key={r.id} className={edit === r.id ? 'editing' : undefined}>
          <th scope="row"><button className="line-name" disabled={busy} aria-label={`${r.name} 계좌 수정`} onClick={() => setEdit(edit === r.id ? null : r.id)}>{r.name}</button></th>
          <td className="numeric"><MoneyCell value={r.entered} label={`${r.name} ${month}월 잔액`} signed disabled={busy} onError={onError}
            onSave={amount => { void perform({ type: 'balance', id: r.id, year: data.year, month, amount }); }} /></td>
          <td className={`numeric ${r.change !== null && r.change < 0 ? 'minus' : ''}`}>
            {r.change !== null ? <>{signed(r.change)}<small>{when(r.previous!)}</small></>
              : r.entered !== null ? <span className="muted">첫 기록</span>
              : r.latest ? <span className="muted">{won(r.latest.amount)}<small>{when(r.latest)} 값</small></span> : <span className="muted">—</span>}
          </td>
          <td className="numeric d">{r.target === null ? <span className="muted">—</span>
            : <>{won(r.target)}{r.latest && r.target > 0 && <small>{Math.floor(r.latest.amount / r.target * 100)}%</small>}</>}</td>
        </tr>),
      ])}</tbody>
      <tfoot><tr><th scope="row">합계</th><td className="numeric">{won(totals.total)}</td><td /><td className="d" /></tr></tfoot>
    </table></div>
      : <p className="muted empty-chart">비상금·모으기·저축·투자처럼 돈이 쌓이는 계좌를 추가하고 잔액을 적으면, 합계와 지난 기록 대비 늘고 준 금액이 여기에 보입니다.</p>}
    {rows.length > 0 && <p className="table-note">단위: 원 · 계좌 이름을 누르면 이름·묶음·목표를 고칩니다. 잔액을 비우면 그 달 기록이 지워집니다. 목표 옆 숫자는 마지막 잔액이 목표에서 차지하는 비율입니다.</p>}
    {history.length > 1 && <SavingsChart rows={history} title="잔액 합계" label="월별 잔액 합계 그래프" name="잔액 합계" />}
  </>;
}

function AccountForm({ account, busy, onSave, onCancel, onDelete, onError }: {
  account?: Account; busy: boolean; onSave: (fields: { name: string; kind: Account['kind']; target: number | null }) => void;
  onCancel: () => void; onDelete?: () => void; onError: (message: string) => void;
}) {
  return <form onSubmit={e => {
    e.preventDefault(); const form = new FormData(e.currentTarget);
    try { onSave({ name: String(form.get('name')).trim(), kind: accountKind.parse(form.get('kind')), target: parseMoney(String(form.get('target') ?? '')) }); }
    catch (error) { onError(error instanceof Error && !('issues' in error) ? error.message : '이름과 목표 금액을 확인하세요.'); }
  }}>
    <div className="form-grid">
      <label>계좌 이름<input name="name" defaultValue={account?.name} maxLength={120} required placeholder="비상금" /></label>
      <label>묶음<select name="kind" defaultValue={account?.kind ?? 'ready'}>{kinds.map(k => <option key={k} value={k}>{accountKinds[k]}</option>)}</select></label>
      <label>목표 금액<input name="target" inputMode="numeric" defaultValue={account?.target ?? ''} placeholder="없음" /></label>
    </div>
    <div className="actions"><button className="primary" disabled={busy}>저장</button><button type="button" onClick={onCancel}>취소</button>{onDelete && <button className="danger" type="button" disabled={busy} onClick={onDelete}>계좌 삭제</button>}</div>
  </form>;
}
