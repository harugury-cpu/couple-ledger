'use client';
import { useEffect, useState } from 'react';
import type { MonthLine, PaymentMethod } from '../db/schema';
import type { NotificationList, NotificationView } from '../db/notification-inbox';
import { notificationMonth, notificationTransactionSchema } from '../lib/notification';
import { sections, won } from '../lib/labels';

type Props = { year: number; month: number; methods: PaymentMethod[]; disabled: boolean; onClose: () => void; onSuccess: (message: string) => void };

function ReviewItem({ item, methods, disabled, act }: {
  item: NotificationView; methods: PaymentMethod[]; disabled: boolean; act: (action: object, message: string) => Promise<void>;
}) {
  const [date, setDate] = useState(item.date);
  const [merchant, setMerchant] = useState(item.merchant);
  const [amount, setAmount] = useState(item.amount === null ? '' : String(item.amount));
  const [methodId, setMethodId] = useState(item.paymentMethodId ?? '');
  const [lineId, setLineId] = useState('');
  const [remember, setRemember] = useState(false);
  const [lines, setLines] = useState<MonthLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  let target: { year: number; month: number } | null = null;
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) target = notificationMonth(date,
      methodId === item.paymentMethodId ? item : methods.find(method => method.id === methodId) ?? { billing_kind: 'debit', cutoff_day: 31 });
  } catch { /* 유효한 날짜를 입력할 때까지 줄 선택을 기다린다. */ }
  const targetYear = target?.year; const targetMonth = target?.month;
  useEffect(() => {
    const controller = new AbortController();
    setLineId(''); setRemember(false); setLines([]); setError('');
    if (targetYear === undefined || targetMonth === undefined) { setLoading(false); return; }
    setLoading(true);
    fetch(`/api/ledger?year=${targetYear}&month=${targetMonth}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => setLines((data.lines as MonthLine[]).filter(line => line.year === targetYear && line.month === targetMonth &&
        ['fixed', 'variable'].includes(line.section) && !line.series_id.startsWith('special:'))))
      .catch(e => { if (e.name !== 'AbortError') setError('청구월의 줄을 불러오지 못했습니다.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [targetYear, targetMonth, retry]);
  const selected = lines.find(line => line.id === lineId);
  const canRemember = !!methodId && !!selected && selected.input_mode !== 'fixed';
  const label = merchant || '읽지 못한 알림';
  return <li className="notification-item">
    <div className="notification-meta"><strong>{item.reason ?? '미분류'}</strong><small>{item.app} · {new Date(item.receivedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</small></div>
    <pre className="notification-raw">{item.raw}</pre>
    <form onSubmit={async event => {
      event.preventDefault(); setError('');
      const parsed = notificationTransactionSchema.safeParse({ date, merchant, amount: /^-?\d+$/.test(amount.replaceAll(',', '')) ? Number(amount.replaceAll(',', '')) : NaN });
      if (!parsed.success) { setError('날짜·가맹점·금액을 확인하세요. 금액은 0이 아닌 원 단위 정수입니다.'); return; }
      if (!selected) { setError('넣을 줄을 골라주세요.'); return; }
      await act({ type: 'save', id: item.id, transaction: parsed.data, lineId, paymentMethodId: methodId || null, remember: remember && canRemember }, '1건 넣었습니다.');
    }}>
      <fieldset disabled={disabled} className="notification-fields">
        <label>결제일<input type="date" value={date} required aria-label={`${label} 결제일`} onChange={event => setDate(event.target.value)} /></label>
        <label>가맹점<input value={merchant} required maxLength={120} aria-label={`${label} 가맹점`} onChange={event => setMerchant(event.target.value)} /></label>
        <label>금액<input className="capture-amount" inputMode="text" value={amount} required aria-label={`${label} 금액`} onChange={event => setAmount(event.target.value.replaceAll(',', ''))} /></label>
        <label>결제수단<select value={methodId} aria-label={`${label} 결제수단`} onChange={event => { setMethodId(event.target.value); setRemember(false); }}>
          <option value="">카드 미지정</option>{methods.map(method => <option key={method.id} value={method.id}>{method.name}</option>)}
        </select></label>
        <label className="notification-line">{target ? `${target.year}년 ${target.month}월 줄` : '넣을 줄'}
          <select value={lineId} disabled={loading || !target} required aria-label={`${label} 줄`} onChange={event => { setLineId(event.target.value); setRemember(false); }}>
            <option value="">{loading ? '불러오는 중…' : '줄 선택'}</option>
            {(['fixed', 'variable'] as const).map(section => <optgroup key={section} label={sections[section]}>{lines.filter(line => line.section === section).map(line => <option key={line.id} value={line.id}>{line.name}</option>)}</optgroup>)}
          </select>
        </label>
        {selected && <label className="capture-remember"><input type="checkbox" checked={remember && canRemember} disabled={!canRemember} onChange={event => setRemember(event.target.checked)} />이 가맹점 기억하기</label>}
        {selected?.input_mode === 'fixed' && <small className="muted notification-line">매달 같은 금액 줄은 가맹점을 기억할 수 없습니다.</small>}
        {!methodId && <small className="muted notification-line">결제수단을 고르면 청구월을 맞추고 가맹점을 기억할 수 있습니다.</small>}
      </fieldset>
      {error && <p role="alert" className="capture-error">{error}<button type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></p>}
      <div className="capture-actions"><button className="primary" disabled={disabled || loading || !selected}>넣기</button>
        <button type="button" disabled={disabled} onClick={() => { void act({ type: 'discard', id: item.id }, '알림을 버렸습니다.'); }}>버리기</button></div>
    </form>
  </li>;
}

export function NotificationPanel({ year, month, methods, disabled, onClose, onSuccess }: Props) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/notifications?year=${year}&month=${month}`, { signal: controller.signal })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error); return json; })
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, month, revision]);
  async function act(action: object, message: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      onSuccess(message); setRevision(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : '알림을 처리하지 못했습니다.'); }
    finally { setBusy(false); }
  }
  const locked = disabled || busy || loading;
  return <section className="capture-panel notification-panel" aria-label="미분류 알림" aria-busy={busy || loading}>
    <div className="capture-heading"><h3>미분류 알림{data ? ` · ${data.pending.length}건` : ''}</h3>
      <div className="capture-actions"><button type="button" disabled={locked} onClick={() => setRevision(value => value + 1)}>다시 불러오기</button><button type="button" disabled={busy} onClick={onClose}>닫기</button></div></div>
    {loading && <p className="capture-status" role="status">불러오는 중…</p>}
    {error && <p className="capture-error" role="alert">{error}</p>}
    {!loading && data && <>
      <p className="capture-status">모든 달의 미분류입니다. 결제일과 결제수단을 확인하고 청구월의 줄을 고릅니다.</p>
      {data.pending.length ? <ul className="capture-list">{data.pending.map(item => <ReviewItem key={item.id} item={item} methods={methods} disabled={locked} act={act} />)}</ul> : <p className="capture-status">미분류 알림이 없습니다.</p>}
      <details className="notification-history"><summary>{year}년 {month}월 알림 기록 · {data.history.length}건</summary>
        <ul className="capture-list">{data.history.map(item => <li key={item.id} className="notification-item">
          <div className="notification-meta"><strong>{item.lineName ?? (item.merchant || '알림')}</strong><span>{item.amount !== null ? `${won(item.amount)}원` : ''}</span>
            <small>{item.date} · {item.status === 'undone' ? '되돌림' : item.status === 'discarded' ? '버림' : '넣음'}</small></div>
          <pre className="notification-raw">{item.raw}</pre>
          {item.status === 'saved' && <button type="button" disabled={locked} onClick={() => { void act({ type: 'undo', id: item.id }, '알림 입력을 되돌렸습니다.'); }}>되돌리기</button>}
        </li>)}</ul>
      </details>
    </>}
  </section>;
}
