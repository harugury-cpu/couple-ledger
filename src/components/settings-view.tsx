'use client';
import { useState } from 'react';
import type { Snapshot } from './ledger-app';
import { validateArchive, type Archive } from '../lib/archive';
export function SettingsView({ data, busy, perform, onError }: {
  data: Snapshot; busy: boolean; perform: (command: object, endpoint?: string) => Promise<{ ok: boolean; backupPath?: string } | false>; onError: (message: string) => void;
}) {
  const [categoryEdit, setCategoryEdit] = useState<string | null>(null);
  const [paymentEdit, setPaymentEdit] = useState<string | null>(null);
  const [archive, setArchive] = useState<Archive | null>(null); const [backup, setBackup] = useState(''); const [reading, setReading] = useState(false);
  const payment = data.paymentMethods.find(m => m.id === paymentEdit);
  return <><div className="section-heading"><div><h2>설정</h2><p className="muted">카테고리와 결제수단의 이름은 모든 달에 반영됩니다.</p></div></div>
    <section className="settings-section"><h3>카테고리</h3><ul className="settings-list">{data.categories.map(c => <li key={c.id}>
      {categoryEdit === c.id ? <form className="inline-form" onSubmit={async e => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name'); if (await perform({ type: 'category-save', id: c.id, name })) setCategoryEdit(null); }}><input name="name" defaultValue={c.name} required aria-label="카테고리 이름" maxLength={120}/><button disabled={busy}>이름 저장</button><button type="button" onClick={() => setCategoryEdit(null)}>취소</button></form> : <><span>{c.name}</span><div><button disabled={busy} onClick={() => setCategoryEdit(c.id)}>이름 변경</button><button disabled={busy} className="danger" onClick={() => { if (confirm(`“${c.name}” 카테고리를 삭제할까요? 사용 중인 카테고리는 유지됩니다.`)) void perform({ type: 'category-delete', id: c.id }); }}>삭제</button></div></>}
    </li>)}</ul><form className="inline-form" onSubmit={async e => { e.preventDefault(); const form = e.currentTarget; const name = new FormData(form).get('name'); if (await perform({ type: 'category-save', name })) form.reset(); }}><input name="name" placeholder="새 카테고리" aria-label="새 카테고리" required maxLength={120}/><button disabled={busy}>카테고리 추가</button></form></section>
    <section className="settings-section payment-settings"><h3>결제수단</h3><p className="payment-phone-note muted">결제수단과 카드 알림 설정은 PC에서 고칩니다.</p><ul className="settings-list">{data.paymentMethods.map(m => <li key={m.id}><span>{m.name}<small>{m.kind === 'card' ? '카드' : '계좌'} · {m.owner}</small>
      <small className="payment-notify-summary">{m.notify_app ? `알림 앱: ${m.notify_app}${m.notify_keyword ? ` · 구분: ${m.notify_keyword}` : ''}` : '알림 앱 미설정'} · {m.billing_kind === 'credit' ? `신용카드 · 마감 ${m.cutoff_day}일` : '결제한 달'}</small></span><div className="payment-desktop-controls"><button disabled={busy} onClick={() => setPaymentEdit(m.id)}>변경</button><button disabled={busy} className="danger" onClick={() => { if (confirm(`“${m.name}” 결제수단을 삭제할까요?`)) void perform({ type: 'payment-delete', id: m.id }); }}>삭제</button></div></li>)}</ul>
      <form key={paymentEdit ?? 'new'} className="line-form" onSubmit={async e => {
        e.preventDefault(); const form = e.currentTarget; const fields = new FormData(form);
        if (await perform({ type: 'payment-save', id: paymentEdit ?? undefined, name: fields.get('name'), kind: fields.get('kind'), owner: fields.get('owner'),
          notify_app: fields.get('notify_app') || null, notify_keyword: fields.get('notify_keyword') || null,
          billing_kind: fields.get('billing_kind'), cutoff_day: Number(fields.get('cutoff_day')) })) { setPaymentEdit(null); form.reset(); }
      }}><div className="form-grid"><label>결제수단 이름<input name="name" defaultValue={payment?.name} aria-label="결제수단 이름" required maxLength={120}/></label><label>종류<select name="kind" defaultValue={payment?.kind ?? 'account'}><option value="account">계좌</option><option value="card">카드</option></select></label><label>명의<input name="owner" defaultValue={payment?.owner ?? '공통'} required maxLength={120}/></label>
        <label>알림 앱에 포함된 문구<input name="notify_app" defaultValue={payment?.notify_app ?? ''} placeholder="삼성카드 또는 패키지명" maxLength={200}/></label>
        <label>제목·본문 구분 문구 (선택)<input name="notify_keyword" defaultValue={payment?.notify_keyword ?? ''} placeholder="같은 앱의 카드 구분" maxLength={200}/></label>
        <label>청구 기준<select name="billing_kind" defaultValue={payment?.billing_kind ?? 'transfer'}><option value="credit">신용카드</option><option value="debit">체크카드</option><option value="transfer">이체</option></select></label>
        <label>신용카드 마감일<input name="cutoff_day" type="number" min={1} max={31} required defaultValue={payment?.cutoff_day ?? 31}/></label>
      </div><p className="muted">신용카드는 마감일까지 다음 달, 이후에는 다다음 달에 넣습니다. 체크카드와 이체는 결제한 달에 넣습니다.</p><div className="actions"><button disabled={busy}>{paymentEdit ? '결제수단 저장' : '결제수단 추가'}</button>{paymentEdit && <button type="button" onClick={() => setPaymentEdit(null)}>취소</button>}</div></form>
    </section>
    <section className="settings-section"><h3>JSON 백업과 복원</h3><p className="muted">모든 달의 표·입력 기록·설정·저축·특별 지출을 한 파일로 보관합니다.</p><a className="button-link" href="/api/backup" download>JSON 전체 내보내기</a>
      <label className="file-label">JSON 가져오기<input type="file" accept=".json,application/json" disabled={busy || reading} onChange={async e => {
        setArchive(null); setBackup(''); const file = e.target.files?.[0]; if (!file) return;
        setReading(true);
        try { if (file.size > 10 * 1024 * 1024) throw new Error('JSON 파일은 10MB까지 가져올 수 있습니다.'); setArchive(validateArchive(JSON.parse(await file.text()))); }
        catch (error) { onError(error instanceof SyntaxError ? '올바른 JSON 파일을 선택하세요.' : error instanceof Error ? error.message : '파일을 읽지 못했습니다.'); }
        finally { setReading(false); e.target.value = ''; }
      }}/></label>
      {reading && <p role="status">파일을 검증하는 중…</p>}
      {archive && <div className="restore-preview"><p>복원할 자료: {archive.data.ledger_months.length}개 월 · {archive.data.month_lines.length}개 항목 · {archive.data.entries.length}개 입력 기록</p><p className="muted">현재 가계부 전체가 이 파일의 내용으로 바뀝니다. 현재 자료는 복원 전에 별도 JSON으로 자동 백업합니다.</p><div className="actions"><button className="primary" disabled={busy} onClick={async () => { if (!confirm('현재 가계부를 자동 백업하고 선택한 파일로 전체 복원할까요?')) return; const result = await perform(archive, '/api/backup'); if (result) { setBackup(result.backupPath ?? ''); setArchive(null); } }}>백업 후 전체 복원</button><button disabled={busy} onClick={() => setArchive(null)}>취소</button></div></div>}
      {backup && <p className="backup-result" role="status">복원했습니다. 이전 자료 백업: <code>{backup}</code></p>}
    </section>
  </>;
}
