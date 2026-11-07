'use client';
import { useEffect, useRef, useState } from 'react';
import type { LedgerCore } from '../db/ledger-core';
import { computeLines, monthTotals, transferRows } from '../lib/calculations';
import type { LineFields } from '../lib/validation';
import { LineForm } from './line-form';
import { BudgetView } from './budget-view';
import { AssetsView } from './assets-view';
import { SpecialPanel } from './special-panel';
import { SettingsView } from './settings-view';
import { MonthSummary } from './month-summary';
import { MonthSheet } from './month-sheet';
import { CapturePanel } from './capture-panel';
import { NotificationPanel } from './notification-panel';
import { fetchJson } from '../lib/fetch-json';

export type Snapshot = Awaited<ReturnType<LedgerCore['snapshot']>>;

// 데모만 초기 데이터를 전달한다. 실제 앱의 날짜와 데이터는 마운트 후 브라우저에서 구한다.
export function LedgerApp({ initial }: { initial?: Snapshot }) {
  const [data, setData] = useState<Snapshot | null>(initial ?? null);
  const [year, setYear] = useState(initial?.year ?? 0);
  const [month, setMonth] = useState(initial?.month ?? 0);
  const [view, setView] = useState('month');
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [captureOpen, setCaptureOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const mutations = useRef(Promise.resolve<unknown>(undefined));
  const pending = useRef(0);
  const historyRef = useRef({ undo: [] as string[], redo: [] as string[] });
  const [history, setHistory] = useState(historyRef.current);
  const historyShortcut = useRef<(direction: 'undo' | 'redo') => void>(() => {});
  const updateHistory = (next: { undo: string[]; redo: string[] }) => { historyRef.current = next; setHistory(next); };
  // 수정 창은 표 위에 열린다: 아래쪽 줄을 눌러도 보이도록 처음 열릴 때 창 위치로 스크롤한다.
  const editPanel = useRef<string | null>(null);
  const selection = useRef({ year, month });
  selection.current = { year, month };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (initial) return;
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
    setYear(Number(parts.find(p => p.type === 'year')!.value));
    setMonth(Number(parts.find(p => p.type === 'month')!.value));
  }, [initial]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || !(e.metaKey || e.ctrlKey)) return;
      if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const letter = e.key.toLowerCase();
      if (letter !== 'z' && !(letter === 'y' && e.ctrlKey)) return;
      e.preventDefault(); historyShortcut.current(letter === 'y' || e.shiftKey ? 'redo' : 'undo');
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  useEffect(() => {
    if (!year || !month) return;
    const controller = new AbortController();
    setLoading(true); setEdit(null); setCaptureOpen(false); setError('');
    fetchJson<Snapshot>(`/api/ledger?year=${year}&month=${month}`, { signal: controller.signal }, 1)
      .then(setData)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [year, month, reload]);

  // 폰에서 넘어온 알림의 건수와 금액은 화면 복귀와 30초 간격으로 갱신한다.
  useEffect(() => {
    if (!year || !month) return;
    const controller = new AbortController();
    async function refresh() {
      if (busy || loading || captureOpen || document.visibilityState !== 'visible') return;
      try {
        const snapshot = await fetchJson<Snapshot>(`/api/ledger?year=${year}&month=${month}`, { signal: controller.signal });
        if (!controller.signal.aborted) setData(snapshot);
      } catch { /* 목록의 다시 불러오기로 재시도할 수 있다. */ }
    }
    const timer = setInterval(() => { void refresh(); }, 30_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [year, month, busy, loading, captureOpen]);

  async function perform(command: object, endpoint = '/api/ledger') {
    const action = command as { type?: string; id?: string; direction?: 'undo' | 'redo' };
    const operation = crypto.randomUUID();
    pending.current++; setBusy(true);
    const run = async () => {
      setError(''); setNotice('');
      try {
        // 가계부 저장은 작업 번호로 중복 저장을 막으므로 끊기면 같은 번호로 한 번 더 보낸다. 실행 취소·다른 API는 다시 보내지 않는다.
        const retry = endpoint === '/api/ledger' && action.type !== 'history' ? 1 : 0;
        const result = await fetchJson<{ ok: boolean; entry_id?: string; backupPath?: string; history_id?: string }>(endpoint,
          { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Ledger-Operation': operation }, body: JSON.stringify(command) }, retry);
        const current = historyRef.current;
        if (endpoint !== '/api/ledger') updateHistory({ undo: [], redo: [] });
        else if (action.type === 'history' && action.id && action.direction) {
          const from = action.direction; const to = from === 'undo' ? 'redo' : 'undo';
          updateHistory({ ...current, [from]: current[from].filter(id => id !== action.id), [to]: [...current[to], action.id] });
        } else if (result.history_id) updateHistory({ undo: [...current.undo, result.history_id].slice(-50), redo: [] });
        const message = action.type === 'history' ? action.direction === 'undo' ? '실행 취소했습니다.' : '다시 실행했습니다.' : '저장했습니다.';
        setNotice(message);
        // POST가 성공했으면 뒤의 조회 실패를 저장 실패로 돌리지 않는다. 취소 이력도 이미 보존된다.
        try {
          const snapshot = await fetchJson<Snapshot>(`/api/ledger?year=${year}&month=${month}`, undefined, 1);
          if (mounted.current && selection.current.year === year && selection.current.month === month) setData(snapshot);
        } catch { setError('변경은 저장됐습니다. 화면을 다시 불러오면 최신 내용이 보입니다.'); }
        return result;
      } catch (e) { setError(e instanceof Error ? e.message : '저장하지 못했습니다. 다시 시도하세요.'); return false; }
      finally { pending.current--; if (mounted.current) setBusy(pending.current > 0); }
    };
    const next = mutations.current.then(run, run); mutations.current = next;
    return next;
  }
  historyShortcut.current = direction => {
    if (pending.current || loading) return;
    const id = historyRef.current[direction].at(-1);
    if (id) void perform({ type: 'history', id, direction });
  };

  const lines = data ? computeLines(data.lines.filter(l => l.month === month), data.entries, data.adjustments) : [];
  const transfers = transferRows(lines, data?.transfers.filter(t => t.month === month) ?? []);
  const totals = monthTotals(lines);
  const disabled = busy || loading || !data || data.year !== year || data.month !== month;
  const editing = edit ? lines.find(l => l.id === edit) : undefined;
  const accountOf = (key: string | null) => transfers.find(t => t.series_id === key)?.account ?? '';

  async function saveLine(fields: LineFields, future: boolean, transferAccount: string, paymentName?: string) {
    if (await perform({ type: 'update', id: edit, fields, future, transfer_account: transferAccount, payment_name: paymentName })) setEdit(null);
  }
  function applyFuture(series: string | string[]) {
    return [series].flat().some(s => data?.futureSeries.includes(s)) && confirm('이미 만들어진 이후 달에도 적용할까요? 취소를 누르면 이번 달만 바뀝니다.');
  }
  // 새 줄: 이후 달이 이미 만들어져 있으면 그 달들에도 넣을지 묻는다.
  const createInFuture = () => !!data?.futureSeries.length && confirm('이미 만들어진 이후 달에도 이 줄을 넣을까요? 취소를 누르면 이번 달에만 넣습니다.');
  const closeEdit = () => setEdit(null);

  return <main className={view === 'budget' ? 'wide' : undefined}>
    <header className="topbar">
      <h1>우리 가계부</h1>
      <div className="year-control">
        <button aria-label="이전 연도" disabled={disabled || year === 1900} onClick={() => setYear(year - 1)}>‹</button>
        <strong>{year ? `${year}년` : '연도'}</strong>
        <button aria-label="다음 연도" disabled={disabled || year === 2200} onClick={() => setYear(year + 1)}>›</button>
      </div>
      <nav className="sheet-nav" aria-label="가계부 시트">
        {[['budget', '예산'], ['assets', '자산']].map(([key, label]) =>
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
    {!data && <p role="status" className="muted">{loading ? '불러오는 중…' : '가계부 데이터를 불러오지 못했습니다.'}</p>}
    {data && (view === 'month' ? <>
      <div className="month-bar">
        <h2>{month}월 가계부</h2>
        <MonthSummary totals={totals} pending={lines.filter(l => !l.hasEntry).length} />
        <button type="button" onClick={() => setCaptureOpen(open => !open)} disabled={disabled}>{captureOpen ? '명세서 닫기' : '명세서 올리기'}</button>
        <button type="button" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen(open => !open)} disabled={disabled}>미분류 {data.notificationCount}건</button>
      </div>
      {captureOpen && <CapturePanel year={year} month={month} lines={lines} disabled={disabled} onClose={() => setCaptureOpen(false)}
        onSuccess={count => { setCaptureOpen(false); setNotice(`${count}건 넣었습니다.`); setReload(value => value + 1); }} />}
      {notificationsOpen && <NotificationPanel key={`notifications-${year}-${month}`} year={year} month={month} methods={data.paymentMethods} disabled={disabled}
        onClose={() => setNotificationsOpen(false)} onSuccess={message => { setNotice(message); setReload(value => value + 1); }} />}
      {editing && <div className="edit-panel" ref={el => { if (el && editPanel.current !== editing.id) { editPanel.current = editing.id; el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } }}><h3>{editing.name} 수정
</h3>
        <LineForm key={editing.id} line={editing} transferAccount={accountOf(editing.transfer_key)} futureAvailable={data.futureSeries.includes(editing.series_id)}
          categories={data.categories} methods={data.paymentMethods} accounts={transfers.map(t => t.account)} busy={disabled} onSave={saveLine} onCancel={closeEdit} onError={setError}
          onDelete={async () => {
            if (!confirm(`“${editing.name}” 줄과 이 달 입력 기록을 삭제할까요?`)) return;
            if (await perform({ type: 'delete', id: editing.id, future: applyFuture(editing.series_id) })) setEdit(null);
          }} />
      </div>}
      <SpecialPanel data={data} month={month} busy={disabled} perform={perform} />
      <MonthSheet key={`sheet-${year}-${month}`} year={year} month={month} merges={data.cellMerges ?? []} lines={lines} transfers={transfers} categories={data.categories} methods={data.paymentMethods} disabled={disabled} editId={edit}
        history={{ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0, undo: () => historyShortcut.current('undo'), redo: () => historyShortcut.current('redo') }}
        perform={perform} onEdit={id => setEdit(edit === id ? null : id)} onError={setError} applyFuture={applyFuture} futureSeries={data.futureSeries}
        onCreate={async (section, line) => !!await perform({ type: 'create', year, month, amount: line.amount ?? undefined, transfer_account: line.transfer || undefined, future: createInFuture(), payment_name: line.payment_name,
          fields: { name: line.name, section, category_id: line.category_id, payment_method_id: line.payment_method_id, pay_day: line.pay_day, budget: line.budget, input_mode: 'manual', saving_owner: section === 'saving' ? 'extra' : null, one_off: false } })} />
      <p className="table-note">단위: 원 · 항목명을 누르면 줄을 고치고, 왼쪽 손잡이를 끌면 순서를 옮깁니다. 처음 적은 결제수단은 자동으로 추가됩니다. 금액을 비우면 미입력으로 돌아갑니다. 남음 = 이체 계좌에 옮긴 돈 − 그 묶음에서 쓴 돈.</p>
    </> : view === 'budget' ? <BudgetView data={data} month={month} />
      : view === 'assets' ? <AssetsView data={data} busy={disabled} perform={perform} onError={setError} />
      : <SettingsView data={data} busy={disabled} perform={perform} onError={setError} />)}
  </main>;
}
