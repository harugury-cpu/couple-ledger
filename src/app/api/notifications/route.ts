import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requestLedger } from '../../../db/request-ledger';
import { NotificationError, NotificationInbox } from '../../../db/notification-inbox';
import { notificationActionSchema } from '../../../lib/notification';
import { yearValue, monthValue } from '../../../lib/validation';
import { checkOrigin, denied } from '../local-request';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  let ledger;
  try { ledger = await requestLedger(request.headers); } catch (error) { return denied(error); }
  try {
    return NextResponse.json(await new NotificationInbox(ledger).list(
      yearValue.parse(Number(request.nextUrl.searchParams.get('year'))), monthValue.parse(Number(request.nextUrl.searchParams.get('month'))),
    ), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: '알림 목록을 불러오지 못했습니다.' }, { status: 400 }); }
}
export async function POST(request: NextRequest) {
  let ledger;
  try { ledger = await requestLedger(request.headers); } catch (error) { return denied(error); }
  try {
    checkOrigin(request);
    const action = notificationActionSchema.parse(await request.json());
    const inbox = new NotificationInbox(ledger);
    const event = action.type === 'save' ? await inbox.save(action.id, action.transaction, action.lineId, action.remember, action.paymentMethodId) :
      action.type === 'undo' ? await inbox.undo(action.id) : await inbox.discard(action.id);
    return NextResponse.json({ ok: true, event }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof NotificationError ? error.message :
      error instanceof ZodError || error instanceof SyntaxError ? '알림 입력값을 확인하세요.' : '알림을 처리하지 못했습니다.' }, { status: 400 });
  }
}
