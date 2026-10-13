import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, denied } from '../local-request';
import { requestLedger } from '../../../db/request-ledger';
import { commandSchema, yearValue, monthValue } from '../../../lib/validation';
import { runLedgerCommand } from '../../../db/ledger-command';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let l;
  try { l = await requestLedger(request.headers); } catch (e) { return denied(e); }
  try {
    const year = yearValue.parse(Number(request.nextUrl.searchParams.get('year')));
    const month = monthValue.parse(Number(request.nextUrl.searchParams.get('month')));
    return NextResponse.json(await l.snapshot(year, month));
  } catch { return NextResponse.json({ error: '월 데이터를 불러오지 못했습니다. 연도와 월을 확인하세요.' }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  let l;
  try { l = await requestLedger(request.headers); } catch (e) { return denied(e); }
  try {
    checkOrigin(request);
    const entry_id = await runLedgerCommand(l, commandSchema.parse(await request.json()));
    return NextResponse.json({ ok: true, entry_id });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !('issues' in error) ? error.message : '입력값을 확인하세요. 금액은 원 단위 정수입니다.' }, { status: 400 });
  }
}
