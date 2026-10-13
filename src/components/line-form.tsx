'use client';
import type { Category, MonthLine, PaymentMethod } from '../db/schema';
import type { LineFields } from '../lib/validation';
import { lineFields, parseMoney } from '../lib/validation';
import { modes, sections } from '../lib/labels';
import { useOwnerNames } from './owner-names';
export function LineForm({ line, categories, methods, accounts, transferAccount, busy, onSave, onCancel, onDelete, onError, futureAvailable, prefillName }: {
  futureAvailable?: boolean; prefillName?: string; line?: MonthLine; categories: Category[]; methods: PaymentMethod[]; busy: boolean;
  accounts: string[]; transferAccount?: string;
  onSave: (fields: LineFields, future: boolean, transferAccount: string) => void; onCancel: () => void; onDelete?: () => void; onError: (message: string) => void;
}) {
  const owners = useOwnerNames();
  return <form className="line-form" onSubmit={e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    try {
      const section = data.get('section') as MonthLine['section'];
      const fields = lineFields.parse({ name: String(data.get('name')), section, category_id: data.get('category') || null,
        payment_method_id: data.get('payment') || null, pay_day: data.get('day') ? Number(data.get('day')) : null,
        budget: parseMoney(String(data.get('budget'))) ?? 0, input_mode: data.get('mode'),
        saving_owner: section === 'saving' ? data.get('owner') || 'extra' : null, one_off: data.get('one_off') === 'on' });
      onSave(fields, data.get('future') === 'on', String(data.get('transfer') ?? '').trim());
    } catch (error) { onError(error instanceof Error && !('issues' in error) ? error.message : '이름·결제일·예산을 확인하세요.'); }
  }}>
    <div className="form-grid">
      <label>항목명<input name="name" defaultValue={line?.name ?? prefillName} maxLength={120} required /></label>
      <label>구역<select name="section" defaultValue={line?.section ?? 'variable'}>{Object.entries(sections).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>카테고리<select name="category" defaultValue={line?.category_id ?? ''}><option value="">없음</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label>결제수단<select name="payment" defaultValue={line?.payment_method_id ?? ''}><option value="">없음</option>{methods.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
      <label>결제일<input name="day" type="number" min="1" max="31" placeholder="없음" defaultValue={line?.pay_day ?? ''} /></label>
      <label>기본 예산<input name="budget" inputMode="numeric" defaultValue={line?.budget ?? 0} /></label>
      <label>입력 방식<select name="mode" defaultValue={line?.input_mode ?? 'manual'}>{Object.entries(modes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <label>이체 계좌<input name="transfer" list="transfer-accounts" defaultValue={transferAccount ?? ''} placeholder="없음" maxLength={120} /><datalist id="transfer-accounts">{accounts.map(a => <option key={a} value={a} />)}</datalist></label>
      <label>저축 명의<select name="owner" defaultValue={line?.saving_owner ?? 'extra'}><option value="a">{owners.a}</option><option value="b">{owners.b}</option><option value="extra">추가</option></select></label>
    </div>
    <label className="check"><input name="one_off" type="checkbox" defaultChecked={line?.one_off} />이번 달만</label>
    {futureAvailable && <label className="check"><input name="future" type="checkbox" />이미 만든 이후 달에도 적용</label>}
    <div className="actions"><button className="primary" disabled={busy}>저장</button><button type="button" onClick={onCancel}>취소</button>{onDelete && <button className="danger" type="button" disabled={busy} onClick={onDelete}>줄 삭제</button>}</div>
  </form>;
}
