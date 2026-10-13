'use client';
import { useMemo, useState } from 'react';
import type { ComputedLine } from '../lib/calculations';
import type { CaptureMatchItem } from '../lib/capture-match';
import { sections, won } from '../lib/labels';

type Draft = CaptureMatchItem & { selected: boolean; remember: boolean; amountText: string; unclassified: boolean };
type Section = ComputedLine['section'];

type Props = {
  year: number; month: number; lines: ComputedLine[]; disabled: boolean;
  onClose: () => void; onSuccess: (count: number) => void;
};

function amountValue(text: string) {
  const clean = text.replaceAll(',', '').trim();
  return /^-?\d+$/.test(clean) ? Number(clean) : null;
}

export function CapturePanel({ year, month, lines, disabled, onClose, onSuccess }: Props) {
  const [reading, setReading] = useState(false);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const groupedLines = useMemo(() => (Object.keys(sections) as Section[]).map(section => ({ section, lines: lines.filter(line => line.section === section) })), [lines]);

  async function readFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    setError('');
    if (files.length < 1 || files.length > 5) { setError('명세서 이미지는 1~5장까지 올릴 수 있습니다.'); return; }
    if (files.some(file => !file.type.startsWith('image/'))) { setError('이미지 파일만 올릴 수 있습니다.'); return; }
    if (files.some(file => file.size > 8 * 1024 * 1024)) { setError('이미지 한 장은 8MB까지 올릴 수 있습니다.'); return; }
    setReading(true);
    try {
      const form = new FormData(); form.set('year', String(year)); form.set('month', String(month));
      files.forEach(file => form.append('images', file));
      const response = await fetch('/api/capture/read', { method: 'POST', body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDrafts((result.items as CaptureMatchItem[]).map(item => ({ ...item, selected: !item.duplicate && !!item.lineId, remember: false,
        amountText: won(item.amount), unclassified: item.lineId === null })));
    } catch (e) { setError(e instanceof Error ? e.message : '명세서를 읽지 못했습니다.'); }
    finally { setReading(false); }
  }

  function update(key: string, change: (item: Draft) => Draft) {
    setDrafts(items => items?.map(item => item.key === key ? change(item) : item) ?? null);
  }

  async function confirm() {
    if (!drafts) return;
    const chosen = drafts.filter(item => item.selected && item.lineId !== null && !item.duplicate);
    if (!chosen.length) { setError('줄을 고른 항목을 하나 이상 선택하세요.'); return; }
    const items = chosen.map(item => ({ ...item, amount: amountValue(item.amountText) }));
    if (items.some(item => item.amount === null)) { setError('금액은 원 단위 정수로 입력하세요.'); return; }
    setConfirming(true); setError('');
    try {
      const response = await fetch('/api/capture/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month, items: items.map(item => ({ key: item.key, lineId: item.lineId, amount: item.amount, raw: item.raw, remember: item.remember, merchant: item.merchant })) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      onSuccess(result.inserted ?? 0);
    } catch (e) { setError(e instanceof Error ? e.message : '명세서 항목을 넣지 못했습니다.'); }
    finally { setConfirming(false); }
  }

  const ordered = drafts ? [...drafts].sort((a, b) => (a.lineId === null ? 0 : a.duplicate ? 2 : 1) - (b.lineId === null ? 0 : b.duplicate ? 2 : 1)) : [];
  const count = drafts?.filter(item => item.selected && item.lineId !== null && !item.duplicate && amountValue(item.amountText) !== null).length ?? 0;

  return <section className="capture-panel" aria-label="명세서 올리기">
    <div className="capture-heading"><h3>명세서 올리기</h3><button type="button" onClick={onClose} disabled={reading || confirming}>취소</button></div>
    {reading && <p className="capture-status" aria-live="polite">읽는 중…</p>}
    {!reading && drafts === null && <div className="capture-start">
      <p>카드 앱 명세서 화면을 여러 장 고르면 현재 {month}월 줄에 맞춰봅니다. 확정 전에는 저장하지 않습니다.</p>
      <label className="button-link capture-choose">사진 선택
        <input type="file" accept="image/*" multiple onChange={readFiles} disabled={disabled} />
      </label>
    </div>}
    {!reading && drafts !== null && <>
      {drafts.length === 0 ? <p className="capture-status">읽은 거래가 없습니다. 사진을 바꿔 다시 시도하세요.</p> : <>
        <p className="capture-status">미분류는 위에서 줄을 고르고, 이미 있는 기록은 아래에서 제외했습니다.</p>
        <ul className="capture-list">
          {ordered.map(item => <li key={item.key} className={`capture-item${item.duplicate ? ' is-duplicate' : ''}`}>
            <label className="capture-main">
              <input type="checkbox" checked={item.selected} disabled={item.duplicate || item.lineId === null} onChange={event => update(item.key, current => ({ ...current, selected: event.target.checked }))} />
              <span className="capture-merchant"><strong>{item.duplicate ? '이미 있음 · ' : ''}{item.merchant}</strong><small>{item.date}</small></span>
            </label>
            <input className="capture-amount" inputMode="numeric" aria-label={`${item.merchant} 금액`} value={item.amountText}
              onFocus={() => update(item.key, current => ({ ...current, amountText: current.amountText.replaceAll(',', '') }))}
              onChange={event => update(item.key, current => ({ ...current, amountText: event.target.value.replaceAll(',', '') }))}
              onBlur={() => update(item.key, current => {
                const amount = amountValue(current.amountText);
                // 중복 방지 키는 읽은 금액 그대로 둔다: 같은 캡처를 다시 올리면 고친 금액과 상관없이 '이미 있음'으로 잡힌다.
                return amount === null ? { ...current } : { ...current, amountText: won(amount) };
              })} />
            <select className="capture-line" aria-label={`${item.merchant} 줄`} value={item.lineId ?? ''} disabled={item.duplicate || confirming}
              onChange={event => update(item.key, current => ({ ...current, lineId: event.target.value || null, selected: !!event.target.value && !current.duplicate,
                remember: current.unclassified && !!event.target.value ? true : !!event.target.value && current.remember }))}>
              <option value="">미분류</option>
              {groupedLines.map(group => <optgroup key={group.section} label={sections[group.section]}>{group.lines.map(line => <option key={line.id} value={line.id}>{line.name}</option>)}</optgroup>)}
            </select>
            {item.unclassified && item.lineId && <label className="capture-remember"><input type="checkbox" checked={item.remember} onChange={event => update(item.key, current => ({ ...current, remember: event.target.checked }))} /> 다음에도 이 줄로</label>}
            {item.raw && <small className="capture-raw">{item.raw}</small>}
          </li>)}
        </ul>
        {error && <p className="capture-error" role="alert">{error}</p>}
        <div className="capture-actions"><button type="button" className="primary" disabled={confirming || count === 0} onClick={() => { void confirm(); }}>{count}건 넣기</button><button type="button" onClick={onClose} disabled={confirming}>취소</button></div>
      </>}
      {drafts.length === 0 && error && <p className="capture-error" role="alert">{error}</p>}
      {drafts.length === 0 && <div className="capture-actions"><label className="button-link capture-choose">사진 다시 선택<input type="file" accept="image/*" multiple onChange={readFiles} disabled={disabled} /></label></div>}
    </>}
    {error && drafts === null && <p className="capture-error" role="alert">{error}</p>}
  </section>;
}
