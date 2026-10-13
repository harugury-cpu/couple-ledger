import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, denied } from '../../local-request';
import { requestLedger } from '../../../../db/request-ledger';
import { captureConfirmSchema } from '../../../../lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  let ledger;
  try { ledger = await requestLedger(request.headers); } catch (e) { return denied(e); }
  try {
    checkOrigin(request);
    const command = captureConfirmSchema.parse(await request.json());
    const inserted = await ledger.addCaptured(command.year, command.month, command.items);
    return NextResponse.json({ ok: true, inserted });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !('issues' in error) ? error.message : '확정할 명세서 항목을 확인하세요.' }, { status: 400 });
  }
}
