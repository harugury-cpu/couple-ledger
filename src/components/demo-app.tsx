'use client';
import { useEffect, useState } from 'react';
import { LedgerApp, type Snapshot } from './ledger-app';
import { OwnerNames } from './owner-names';

// 브라우저 안 가계부를 만들고, 화면이 보내는 /api 요청을 그쪽으로 돌린다. 서버의 실제 가계부에는 닿지 않는다.
async function startDemo(): Promise<Snapshot> {
  const [{ default: initSqlJs }, { createDemoLedger, handleDemoRequest }] = await Promise.all([import('sql.js/dist/sql-asm.js'), import('../demo/demo-ledger')]);
  const SQL = await initSqlJs();
  // LEDGER_MIGRATIONS: 빌드 스크립트가 migrations/*.sql 을 그대로 넣는다.
  const core = await createDemoLedger(new SQL.Database(), JSON.parse(process.env.LEDGER_MIGRATIONS!));
  const serverFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    return (url.origin === location.origin && await handleDemoRequest(core, url, init)) || serverFetch(input, init);
  };
  const today = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(today);
  return core.snapshot(Number(parts.find(p => p.type === 'year')!.value), Number(parts.find(p => p.type === 'month')!.value));
}

export function DemoApp() {
  const [initial, setInitial] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { startDemo().then(setInitial, e => setError(e instanceof Error ? e.message : '데모를 열지 못했습니다.')); }, []);
  return <OwnerNames.Provider value={{ a: 'A', b: 'B' }}>
    <p className="demo-banner"><strong>데모</strong>금액과 이름은 모두 예시입니다. 눌러서 고쳐 볼 수 있지만 저장되지 않고, 새로고침하면 처음으로 돌아갑니다.</p>
    {initial ? <LedgerApp initial={initial} /> : <main><p className={error ? 'error' : 'muted'}>{error || '예시 가계부를 만드는 중…'}</p></main>}
  </OwnerNames.Provider>;
}
