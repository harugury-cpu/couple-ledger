'use client';
import { useEffect, useRef, useState } from 'react';
import type { Ledger } from '../db/ledger';
import { computeLines, monthTotals, transferRows } from '../lib/calculations';
import { sections, won } from '../lib/labels';
import type { LineFields } from '../lib/validation';
import { LineForm } from './line-form';
import { parseQuick, quickCandidates } from '../lib/quick';
import { BudgetView } from './budget-view';
import { SavingsView } from './savings-view';
import { BalanceView } from './balance-view';
import { SpecialPanel } from './special-panel';
import { SettingsView } from './settings-view';
import { MonthSummary } from './month-summary';
import { MonthSheet } from './month-sheet';
import { CapturePanel } from './capture-panel';
import { NotificationPanel } from './notification-panel';

export type Snapshot = Awaited<ReturnType<Ledger['snapshot']>>;

export function LedgerApp({ initial }: { initial: Snapshot }) {
  const [data, setData] = useState(initial);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [view, setView] = useState('month');
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quickText, setQuickText] = useState('');
  const [quickPending, setQuickPending] = useState<ReturnType<typeof parseQuick> | null>(null);
  const [undo, setUndo] = useState<string | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const selection = useRef({ year, month });
  selection.current = { year, month };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setEdit(null); setQuickPending(null); setUndo(null); setCaptureOpen(false); setError('');
    fetch(`/api/ledger?year=${year}&month=${month}`, { signal: controller.signal })
      .then(async r => { const json = await r.json(); if (!r.ok) throw new Error(json.error); return json; })
      .then(setData)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, month, reload]);

  // 폰에서 넘어온 알림의 건수와 금액은 화면 복귀와 30초 간격으로 갱신한다.
  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      if (busy || loading || captureOpen || document.visibilityState !== 'visible') return;
      try {
        const response = await fetch(`/api/ledger?year=${year}&month=${month}`, { signal: controller.signal });
        if (!response.ok) return;
        const snapshot = await response.json();
        if (!controller.signal.aborted) setData(snapshot);
      } catch { /* 목록의 다시 불러오기로 재시도할 수 있다. */ }
    }
    const timer = setInterval(() => { void refresh(); }, 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [year, month, busy, loading, captureOpen]);

  async function perform(command: object, endpoint = '/api/ledger') {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      const refreshed = await fetch(`/api/ledger?year=${year}&month=${month}`);
      const snapshot = await refreshed.json();
      if (!refreshed.ok) throw new Error(snapshot.error);
      if (mounted.current && selection.current.year === year && selection.current.month === month) { setData(snapshot); setNotice('저장했습니다.'); }
      return result as { ok: boolean; entry_id?: string; backupPath?: string };
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도하세요.');
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const lines = computeLines(data.lines.filter(l => l.month === month), data.entries, data.adjustments);
  const transfers = transferRows(lines, data.transfers.filter(t => t.month === month));
  const totals = monthTotals(lines);
  const disabled = busy || loading || data.year !== year || data.month !== month;
  const methods = new Map(data.paymentMethods.map(p => [p.id, p.name]));
  const payment = (line: { pay_day: number | null; payment_method_id: string | null }) =>
    [line.pay_day ? `${line.pay_day}일` : null, line.payment_method_id ? methods.get(line.payment_method_id) : null].filter(Boolean).join(' · ') || '—';
  const editing = edit && edit !== 'new' ? lines.find(l => l.id === edit) : undefined;
  const accountOf = (key: string | null) => transfers.find(t => t.series_id === key)?.account ?? '';

  async function saveLine(fields: LineFields, future: boolean, transferAccount: string) {
    const ok = await perform(edit === 'new'
      ? { type: 'create', year, month, fields, amount: quickPending?.amount, transfer_account: transferAccount, future: !fields.one_off && createInFuture() }
      : { type: 'update', id: edit, fields, future, transfer_account: transferAccount });
    if (ok) { setEdit(null); setQuickPending(null); setQuickText(''); }
  }
  async function addQuick(id: string, parsed: ReturnType<typeof parseQuick>) {
    const result = await perform({ type: 'quick', id, amount: parsed.amount, raw: quickText });
    if (result) { setUndo(result.entry_id ?? null); setQuickText(''); setQuickPending(null); setNotice('금액을 추가했습니다.'); }
  }
  function submitQuick() {
    try {
      const parsed = parseQuick(quickText);
      const found = quickCandidates(lines, parsed.name);
      if (found.length === 1) { void addQuick(found[0].id, parsed); }
      else { setQuickPending(parsed); if (!found.length) setEdit('new'); }
    } catch (e) { setError(e instanceof Error ? e.message : '입력값을 확인하세요.'); }
  }
  const candidates = quickPending ? quickCandidates(lines, quickPending.name) : [];
  function applyFuture(series: string) {
    return data.futureSeries.includes(series) && confirm('이미 만들어진 이후 달에도 적용할까요? 취소를 누르면 이번 달만 바뀝니다.');
  }
  // 새 줄: 이후 달이 이미 만들어져 있으면 그 달들에도 넣을지 묻는다.
  const createInFuture = () => data.futureSeries.length > 0 && confirm('이미 만들어진 이후 달에도 이 줄을 넣을까요? 취소를 누르면 이번 달에만 넣습니다.');
  const closeEdit = () => { setEdit(null); setQuickPending(null); };

  return <main className={view === 'budget' ? 'wide' : undefined}>
    <header className="topbar">
      <h1>우리 가계부</h1>
      <div className="year-control">
        <button aria-label="이전 연도" disabled={disabled || year === 1900} onClick={() => setYear(year - 1)}>‹</button>
        <strong>{year}년</strong>
        <button aria-label="다음 연도" disabled={disabled || year === 2200} onClick={() => setYear(year + 1)}>›</button>
      </div>
      <nav className="sheet-nav" aria-label="가계부 시트">
        {[['budget', '예산'], ['saving', '저축'], ['balance', '잔액']].map(([key, label]) =>
          <button key={key} aria-current={view === key ? 'page' : undefined} onClick={() => { setView(key); setEdit(null); }}>{label}</button>)}
        <span className="nav-gap" />
        {Array.from({ length: 12 }, (_, i) =>
          <button key={i} disabled={busy} aria-current={view === 'month' && month === i + 1 ? 'page' : undefined} onClick={() => { setMonth(i + 1); setView('month'); }}>{i + 1}월</button>)}
        <span className="nav-gap" />
        <button aria-current={view === 'settings' ? 'page' : undefined} onClick={() => setView('settings')}>설정</button>
      </nav>
      <span className="feedback" aria-live="polite">{busy || loading ? '불러오는 중…' : notice}</span>
    </header>
    {error && <div role="alert" className="error">{error}<div><button onClick={() => setReload(reload + 1)}>다시 불러오기</button><button onClick={() => setError('')}>닫기</button></div></div>}
    {view === 'month' ? <>
      <div className="month-bar">
        <h2>{month}월 가계부</h2>
        <MonthSummary totals={totals} pending={lines.filter(l => !l.hasEntry).length} />
        <form className="quick-form" onSubmit={e => { e.preventDefault(); submitQuick(); }}>
          <label htmlFor="quick-input">빠른 입력</label>
          <input id="quick-input" value={quickText} onChange={e => setQuickText(e.target.value)} placeholder="가스비 12000" disabled={disabled} />
          <button className="primary" disabled={disabled || !quickText.trim()}>추가</button>
          {undo && <button type="button" disabled={disabled} onClick={async () => { if (await perform({ type: 'undo', entry_id: undo })) { setUndo(null); setNotice('빠른 입력을 되돌렸습니다.'); } }}>되돌리기</button>}
        </form>
        <button type="button" onClick={() => setCaptureOpen(open => !open)} disabled={disabled}>{captureOpen ? '명세서 닫기' : '명세서 올리기'}</button>
        <button type="button" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(open => !open)} disabled={disabled}>미분류 {data.notificationCount}건</button>
      </div>
      {captureOpen && <CapturePanel year={year} month={month} lines={lines} disabled={disabled} onClose={() => setCaptureOpen(false)}
        onSuccess={count => { setCaptureOpen(false); setNotice(`${count}건 넣었습니다.`); setReload(value => value + 1); }} />}
      {notificationsOpen && <NotificationPanel key={`${year}-${month}`} year={year} month={month} methods={data.paymentMethods} disabled={disabled}
        onClose={() => setNotificationsOpen(false)} onSuccess={message => { setNotice(message); setReload(value => value + 1); }} />}
      {quickPending && candidates.length > 1 && <div className="candidate-list"><p>어느 항목에 {won(quickPending.amount)}원을 더할까요?</p>{candidates.map(l => <button key={l.id} disabled={disabled} onClick={() => { void addQuick(l.id, quickPending); }}>{l.name} · {payment(l)} · {sections[l.section]}</button>)}<button onClick={() => setQuickPending(null)}>취소</button></div>}
      {quickPending && !candidates.length && <p className="muted">맞는 항목이 없어 새 줄을 추가합니다. 저장하면 {won(quickPending.amount)}원이 기록됩니다.</p>}
      {edit === 'new' && <div className="edit-panel"><h3>새 줄</h3>
        <LineForm prefillName={quickPending?.name} categories={data.categories} methods={data.paymentMethods} accounts={transfers.map(t => t.account)} busy={disabled} onSave={saveLine} onCancel={closeEdit} onError={setError} />
      </div>}
      {editing && <div className="edit-panel"><h3>{editing.name} 수정
        <span className="move"><button disabled={disabled} onClick={() => { void perform({ type: 'move', id: editing.id, direction: 'up' }); }}>위로</button><button disabled={disabled} onClick={() => { void perform({ type: 'move', id: editing.id, direction: 'down' }); }}>아래로</button></span></h3>
        <LineForm key={editing.id} line={editing} transferAccount={accountOf(editing.transfer_key)} futureAvailable={data.futureSeries.includes(editing.series_id)}
          categories={data.categories} methods={data.paymentMethods} accounts={transfers.map(t => t.account)} busy={disabled} onSave={saveLine} onCancel={closeEdit} onError={setError}
          onDelete={async () => {
            if (!confirm(`“${editing.name}” 줄과 이 달 입력 기록을 삭제할까요?`)) return;
            if (await perform({ type: 'delete', id: editing.id, future: applyFuture(editing.series_id) })) setEdit(null);
          }} />
      </div>}
      <SpecialPanel key={`${year}-${month}`} data={data} month={month} lines={lines} busy={disabled} perform={perform} onError={setError} />
      <MonthSheet lines={lines} transfers={transfers} categories={data.categories} methods={data.paymentMethods} disabled={disabled} editId={edit}
        perform={perform} onEdit={id => setEdit(edit === id ? null : id)} onError={setError} applyFuture={applyFuture}
        onCreate={async (section, line) => !!await perform({ type: 'create', year, month, amount: line.amount ?? undefined, transfer_account: line.transfer || undefined, future: createInFuture(),
          fields: { name: line.name, section, category_id: line.category_id, payment_method_id: line.payment_method_id, pay_day: line.pay_day, budget: line.budget, input_mode: 'manual', saving_owner: section === 'saving' ? 'extra' : null, one_off: false } })} />
      <p className="table-note">단위: 원 · 항목명을 누르면 줄을 고칩니다. 금액을 비우면 미입력으로 돌아갑니다. 남음 = 이체 계좌에 옮긴 돈 − 그 묶음에서 쓴 돈.</p>
    </> : view === 'budget' ? <BudgetView data={data} month={month} />
      : view === 'saving' ? <SavingsView data={data} busy={disabled} perform={perform} onError={setError} />
      : view === 'balance' ? <BalanceView data={data} month={month} busy={disabled} perform={perform} onError={setError} onMonth={setMonth} />
      : <SettingsView data={data} busy={disabled} perform={perform} onError={setError} />}
  </main>;
}
