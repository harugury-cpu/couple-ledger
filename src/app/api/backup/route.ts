import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, denied } from '../local-request';
import { requestLedger } from '../../../db/request-ledger';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let l;
  try { l = await requestLedger(request.headers); } catch (e) { return denied(e); }
  try {
    const archive = await l.exportArchive();
    return new NextResponse(JSON.stringify(archive, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="couple-ledger-${archive.exported_at.slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'JSON 내보내기에 실패했습니다.' }, { status: 500 }); }
}
export async function POST(request: NextRequest) {
  let l;
  try { l = await requestLedger(request.headers); } catch (e) { return denied(e); }
  try {
    checkOrigin(request);
    if (Number(request.headers.get('content-length')) > 10 * 1024 * 1024) throw new Error('JSON 파일은 10MB까지 가져올 수 있습니다.');
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) throw new Error('JSON 파일은 10MB까지 가져올 수 있습니다.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new Error('올바른 JSON 파일을 선택하세요.'); }
    const backupPath = await l.importArchive(parsed);
    return NextResponse.json({ ok: true, backupPath });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'JSON 가져오기에 실패했습니다.' }, { status: 400 }); }
}
