import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccessDenied, requestNotificationLedger } from '../../../db/request-ledger';
import { NotificationError, NotificationInbox } from '../../../db/notification-inbox';
import { notificationSchema } from '../../../lib/notification';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 문자열 안의 날것 제어문자(줄바꿈·탭)만 이스케이프해서 읽는다. 문자열 밖의 공백 줄바꿈은 원래 허용된다.
function parseLooseJson(text: string) {
  let out = ''; let inString = false; let escaped = false;
  for (const ch of text) {
    if (!inString) { if (ch === '"') inString = true; out += ch; continue; }
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === '\\') { escaped = true; out += ch; continue; }
    if (ch === '"') { inString = false; out += ch; continue; }
    const code = ch.charCodeAt(0);
    out += code < 0x20 ? ({ '\n': '\\n', '\r': '\\r', '\t': '\\t' } as Record<string, string>)[ch] ?? `\\u${code.toString(16).padStart(4, '0')}` : ch;
  }
  return JSON.parse(out);
}

export async function POST(request: NextRequest) {
  try {
    const ledger = await requestNotificationLedger(request.headers);
    if (Number(request.headers.get('content-length') ?? 0) > 32_000)
      return NextResponse.json({ error: '알림이 너무 큽니다.' }, { status: 413 });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 32_000)
      return NextResponse.json({ error: '알림이 너무 큽니다.' }, { status: 413 });
    // MacroDroid는 알림 글자를 이스케이프하지 않고 끼워 넣는다. 폼 형식과, 문자열 안에 줄바꿈이 그대로 든 JSON을 모두 받는다.
    const form = request.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    const body = form ? Object.fromEntries(new URLSearchParams(text)) : parseLooseJson(text);
    return NextResponse.json(await new NotificationInbox(ledger).receive(notificationSchema.parse(body)),
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof AccessDenied) return NextResponse.json({ error: '알림 전송 토큰을 확인하세요.' }, { status: 401 });
    if (error instanceof ZodError || error instanceof SyntaxError || error instanceof NotificationError)
      return NextResponse.json({ error: error instanceof NotificationError ? error.message : '알림 입력 형식을 확인하세요.' }, { status: 400 });
    console.error('notification ingest failed', error instanceof Error ? error.name : 'unknown');
    return NextResponse.json({ error: '알림 처리에 실패했습니다. 다시 시도하세요.' }, { status: 500 });
  }
}
