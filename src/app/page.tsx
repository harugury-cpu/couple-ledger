import { headers } from 'next/headers';
import { AccessDenied, requestLedger } from '../db/request-ledger';
import { LedgerApp } from '../components/ledger-app';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  const year = Number(date.find(p => p.type === 'year')!.value); const month = Number(date.find(p => p.type === 'month')!.value);
  let ledger;
  try { ledger = await requestLedger(await headers()); }
  catch (e) { if (e instanceof AccessDenied) return <main><p className="error">{e.message}</p></main>; throw e; }
  return <LedgerApp initial={await ledger.snapshot(year, month)} />;
}
