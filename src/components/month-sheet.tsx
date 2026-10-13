'use client';
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Category, PaymentMethod } from '../db/schema';
import { monthTotals, total, transferRows, type ComputedLine } from '../lib/calculations';
import { sections, won } from '../lib/labels';
import type { LineInput } from '../lib/validation';
import { parsePayment } from '../lib/payment';
import { MoneyCell } from './money-cell';
import { TextCell } from './text-cell';
import { NewLineRow, type NewLine } from './new-line-row';

type Section = ComputedLine['section'];
type TransferRow = ReturnType<typeof transferRows>[number];
type Props = {
  lines: ComputedLine[]; transfers: TransferRow[]; categories: Category[]; methods: PaymentMethod[];
  disabled: boolean; editId: string | null;
  perform: (command: object) => Promise<unknown>; onEdit: (id: string) => void; onError: (message: string) => void;
  applyFuture: (series: string) => boolean;
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

// 폰 폭(globals.css의 폰 구간과 같은 값). 폰에서도 표는 PC와 같은 8열이지만, 폰은 금액을 고치는 곳이라 금액 칸만 입력 칸이다.
const phoneQuery = '(max-width: 700px)';
const subscribe = (change: () => void) => { const m = matchMedia(phoneQuery); m.addEventListener('change', change); return () => m.removeEventListener('change', change); };
const usePhone = () => useSyncExternalStore(subscribe, () => matchMedia(phoneQuery).matches, () => false);

// Numbers 시트와 같은 순서: 고정생활비 → 가변생활비 → 저축 → 총 지출 → 수입 → 총 수입 → 수입-지출
export function MonthSheet({ lines, transfers, categories, methods, disabled, editId, perform, onEdit, onError, applyFuture, onCreate }: Props) {
  const methodName = new Map(methods.map(m => [m.id, m.name]));
  const transferOf = new Map(transfers.map(t => [t.series_id, t]));
  const totals = monthTotals(lines);
  const used = transfers.filter(t => t.lineCount > 0);
  const phone = usePhone();
  const categoryName = new Map(categories.map(c => [c.id, c.name]));
  // 폰에서는 처음에 수단 열만큼 밀어 두어 항목 · 카테고리 · 예산 · 금액이 한 화면에 들어오게 한다. 수단은 오른쪽으로 밀면 보인다.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (phone && el) el.scrollLeft = el.querySelector<HTMLElement>('thead .c-pay')?.offsetWidth ?? 0;
  }, [phone]);

  const paymentLabel = (l: ComputedLine) => {
    const method = l.payment_method_id ? methodName.get(l.payment_method_id) : undefined;
    if (l.pay_day && method) return `${l.pay_day}일(${method})`;
    return method ?? (l.pay_day ? `${l.pay_day}일` : '');
  };

  // 양식 칸(수단·항목·카테고리·예산·이체)은 PC에서 고친다. 폰에서는 같은 자리에 값만 보인다.
  const form = (text: React.ReactNode, editor: React.ReactNode) => phone ? <span className="cell-text">{text}</span> : editor;

  function sectionRows(key: Section) {
    const group = lines.filter(l => l.section === key);
    const paySpans = mergeSpans(group, samePayment);
    const transferSpans = mergeSpans(group, (anchor, l) => !!l.transfer_key && transferOf.has(l.transfer_key) && l.transfer_key === anchor.transfer_key);
    return group.map((l, i) => {
      const special = l.series_id.startsWith('special:');
      const transfer = l.transfer_key ? transferOf.get(l.transfer_key) : undefined;
      const meta = [l.one_off ? '이번 달만' : null, special ? '특별 지출' : shortMode[l.input_mode] || null].filter(Boolean).join(' · ');
      return <tr key={l.id} className={`line ${key} ${i % 2 ? 'odd' : ''} ${editId === l.id ? 'editing' : ''}`}>
        {paySpans[i] > 0 && <td className="d merged" rowSpan={paySpans[i]}>
          {form(paymentLabel(l), <TextCell value={paymentLabel(l)} label={`${l.name} 수단`} list="sheet-methods" disabled={disabled || special} onSave={text => {
            // 병합된 칸은 값이 하나다: 묶인 줄 전부를 같이 바꾼다. 윗줄과 같은 값을 적으면 그 줄과 병합된다.
            try { void perform({ type: 'payment', ids: group.slice(i, i + paySpans[i]).filter(g => !g.series_id.startsWith('special:')).map(g => g.id), ...parsePayment(text, methods), future: applyFuture(l.series_id) }); }
            catch (e) { onError(e instanceof Error ? e.message : '수단을 확인하세요.'); }
          }} />)}
        </td>}
        <th scope="row" className="name" title={l.name}>
          {form(l.name, <button className="line-name" disabled={disabled || special} aria-label={`${l.name} 항목 수정`} onClick={() => onEdit(l.id)}>{l.name}</button>)}
          {meta && <span className="line-meta">{meta}</span>}
          {!special && !phone && <button className="line-delete" disabled={disabled} aria-label={`${l.name} 줄 삭제`} title="줄 삭제" onClick={() => {
            if (confirm(`“${l.name}” 줄과 이 달 입력 기록을 삭제할까요?`)) void perform({ type: 'delete', id: l.id, future: applyFuture(l.series_id) });
          }}>×</button>}
        </th>
        <td className="d">
          {form(l.category_id ? categoryName.get(l.category_id) : '', <select className={`cell-select${l.category_id ? '' : ' is-empty'}`} aria-label={`${l.name} 카테고리`} value={l.category_id ?? ''} disabled={disabled || special}
            onChange={e => { void perform({ type: 'update', id: l.id, fields: { ...fieldsOf(l), category_id: e.target.value || null }, future: applyFuture(l.series_id) }); }}>
            <option value="">—</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>)}
        </td>
        <td className="num" title={l.effectiveBudget !== l.budget ? `특별 지출 조정 후 ${won(l.effectiveBudget)}` : undefined}>
          {form(won(l.budget), <MoneyCell value={l.budget} label={`${l.name} 기본 예산`} disabled={disabled || special} onError={onError}
            onSave={amount => { void perform({ type: 'budget', id: l.id, amount: amount ?? 0, future: applyFuture(l.series_id) }); }} />)}
          {l.effectiveBudget !== l.budget && <small className="adjusted">조정 후 {won(l.effectiveBudget)}</small>}
        </td>
        <td className="num">
          <MoneyCell value={l.hasEntry ? l.actual : null} signed label={`${l.name} 금액`} disabled={disabled || special} onError={onError}
            onSave={amount => { void perform({ type: 'amount', id: l.id, amount }); }} />
        </td>
        {transferSpans[i] > 0 && (transfer
          ? <>
            <td className="d merged" rowSpan={transferSpans[i]}>
              {form(transfer.account, <TextCell value={transfer.account} label={`${transfer.account} 이체 계좌 이름`} disabled={disabled}
                onSave={account => { if (account) void perform({ type: 'transfer', id: transfer.id, account }); }} />)}
            </td>
            <td className="d num merged" rowSpan={transferSpans[i]}>
              {form(won(transfer.amount), <MoneyCell value={transfer.amount} label={`${transfer.account} 이체 금액`} disabled={disabled} onError={onError}
                onSave={amount => { void perform({ type: 'transfer', id: transfer.id, amount: amount ?? 0 }); }} />)}
            </td>
            <td className={`d num merged remaining ${transfer.remaining < 0 ? 'minus' : transfer.remaining === 0 ? 'zero' : ''}`} rowSpan={transferSpans[i]} title={`이체 ${won(transfer.amount)} − 쓴 돈 ${won(transfer.spent)}`}>{won(transfer.remaining)}</td>
          </>
          : <>
            <td className="d">
              {form('', <TextCell value="" label={`${l.name} 이체 계좌`} disabled={disabled || special}
                onSave={account => { void perform({ type: 'update', id: l.id, fields: fieldsOf(l), future: applyFuture(l.series_id), transfer_account: account }); }} />)}
            </td>
            <td className="d" /><td className="d" />
          </>)}
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
    {used.length > 0 && <ul className="account-list" aria-label="계좌별 남은 돈">
      {used.map(t => <li key={t.id}><span>{t.account}</span><strong className={t.remaining < 0 ? 'minus' : ''}>{won(t.remaining)}</strong><small>/ {won(t.amount)}</small></li>)}
    </ul>}
    <datalist id="sheet-methods">{methods.map(m => <option key={m.id} value={m.name} />)}</datalist>
    <datalist id="sheet-accounts">{transfers.map(t => <option key={t.id} value={t.account} />)}</datalist>
    <div className="sheet-scroll" ref={scroller}><table className="sheet">
      <thead><tr>
        <th className="d c-pay"><span className="pc">고정생활비</span><span className="m">수단</span></th><th className="name"><span className="m">고정생활비</span></th><th className="d c-cat">카테고리</th>
        <th className="num c-num">예산</th><th className="num c-num">금액</th>
        <th className="d c-acc" /><th className="d num c-num">이체 계좌</th><th className="d num c-num">남음</th>
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
