// 로컬 Next 라우트와 Workers가 함께 쓰는 표준 Request/Response API.
import { $ZodError } from 'zod/v4/core';
import type { LedgerCore } from '../db/ledger-core';
import { AccessDenied } from '../db/worker-ledger';
import { runLedgerAction } from '../db/ledger-action';
import { EditConflict } from '../db/edit-history';
import { NotificationError, NotificationInbox } from '../db/notification-inbox';
import { commandSchema, captureConfirmSchema, yearValue, monthValue } from '../lib/validation';
import { notificationActionSchema, notificationSchema } from '../lib/notification';
import { InputError } from '../lib/input-error';
import { computeLines } from '../lib/calculations';
import { matchCaptureItems } from '../lib/capture-match';
import { readCaptureImages, type CaptureImage } from '../lib/capture-read';
import { checkOrigin } from './request';

export type ContextKind = 'access' | 'capture' | 'ingest';
export type ApiContext = {
  resolve: (headers: Headers, kind: ContextKind) => Promise<{ ledger: LedgerCore; geminiKey?: string }>;
  isAccessDenied?: (error: unknown) => boolean;
};
const noStore = { 'Cache-Control': 'no-store' };
const methods: Record<string, string[]> = {
  '/api/ledger': ['GET', 'POST'], '/api/notifications': ['GET', 'POST'], '/api/backup': ['GET', 'POST'],
  '/api/capture/read': ['POST'], '/api/capture/confirm': ['POST'], '/api/ingest': ['POST'],
};

// MacroDroid가 문자열 안에 그대로 넣은 제어문자만 이스케이프한다.
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

function toBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function dispatch(request: Request, url: URL, path: string, method: string, context: { ledger: LedgerCore; geminiKey?: string }) {
  const { ledger } = context;
  if (path === '/api/ingest') {
    if (Number(request.headers.get('content-length') ?? 0) > 32_000) return Response.json({ error: '알림이 너무 큽니다.' }, { status: 413, headers: noStore });
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 32_000) return Response.json({ error: '알림이 너무 큽니다.' }, { status: 413, headers: noStore });
    const form = request.headers.get('content-type')?.includes('application/x-www-form-urlencoded');
    const body = form ? Object.fromEntries(new URLSearchParams(text)) : parseLooseJson(text);
    return Response.json(await new NotificationInbox(ledger).receive(notificationSchema.parse(body)), { headers: noStore });
  }
  if (method === 'POST') checkOrigin(request);
  if (path === '/api/ledger') {
    if (method === 'GET') return Response.json(await ledger.snapshot(
      yearValue.parse(Number(url.searchParams.get('year'))), monthValue.parse(Number(url.searchParams.get('month'))),
    ), { headers: noStore });
    const result = await runLedgerAction(ledger, commandSchema.parse(await request.json()), request.headers.get('x-ledger-operation'));
    return Response.json({ ok: true, ...result }, { headers: noStore });
  }
  if (path === '/api/notifications') {
    const inbox = new NotificationInbox(ledger);
    if (method === 'GET') return Response.json(await inbox.list(
      yearValue.parse(Number(url.searchParams.get('year'))), monthValue.parse(Number(url.searchParams.get('month'))),
    ), { headers: noStore });
    const action = notificationActionSchema.parse(await request.json());
    const event = action.type === 'save' ? await inbox.save(action.id, action.transaction, action.lineId, action.remember, action.paymentMethodId) :
      action.type === 'undo' ? await inbox.undo(action.id) : await inbox.discard(action.id);
    return Response.json({ ok: true, event }, { headers: noStore });
  }
  if (path === '/api/backup') {
    if (method === 'GET') {
      const archive = await ledger.exportArchive();
      return new Response(JSON.stringify(archive, null, 2), { headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="couple-ledger-${archive.exported_at.slice(0, 10)}.json"` } });
    }
    if (Number(request.headers.get('content-length')) > 10 * 1024 * 1024) throw new InputError('JSON 파일은 10MB까지 가져올 수 있습니다.');
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) throw new InputError('JSON 파일은 10MB까지 가져올 수 있습니다.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { throw new InputError('올바른 JSON 파일을 선택하세요.'); }
    return Response.json({ ok: true, backupPath: await ledger.importArchive(parsed) }, { headers: noStore });
  }
  if (path === '/api/capture/confirm') {
    const command = captureConfirmSchema.parse(await request.json());
    return Response.json({ ok: true, inserted: await ledger.addCaptured(command.year, command.month, command.items) }, { headers: noStore });
  }
  const form = await request.formData();
  const year = yearValue.parse(Number(form.get('year'))); const month = monthValue.parse(Number(form.get('month')));
  const values = form.getAll('images').length ? form.getAll('images') : form.getAll('image');
  if (values.length < 1 || values.length > 5) throw new InputError('명세서 이미지는 1~5장까지 올릴 수 있습니다.');
  const images: CaptureImage[] = [];
  for (const value of values) {
    if (!(value instanceof File) || !value.type.startsWith('image/')) throw new InputError('이미지 파일만 올릴 수 있습니다.');
    if (value.size > 8 * 1024 * 1024) throw new InputError('이미지 한 장은 8MB까지 올릴 수 있습니다.');
    images.push({ mimeType: value.type, data: toBase64(new Uint8Array(await value.arrayBuffer())) });
  }
  if (!context.geminiKey) throw new InputError('Gemini API 키가 설정되지 않았습니다.');
  const read = await readCaptureImages(images, context.geminiKey);
  const snapshot = await ledger.snapshot(year, month);
  const lines = computeLines(snapshot.lines.filter(line => line.month === month), snapshot.entries, snapshot.adjustments);
  const lineIds = new Set(lines.map(line => line.id));
  return Response.json({ items: matchCaptureItems(read, lines, snapshot.matchRules,
    snapshot.entries.filter(entry => lineIds.has(entry.month_line_id)), year, month) }, { headers: noStore });
}

function failure(error: unknown, path: string, method: string, ctx: ApiContext) {
  if ((ctx.isAccessDenied ?? (e => e instanceof AccessDenied))(error)) return Response.json({
    error: path === '/api/ingest' ? '알림 전송 토큰을 확인하세요.' : error instanceof Error ? error.message : '허용된 계정으로 로그인해야 열 수 있습니다.',
  }, { status: path === '/api/ingest' ? 401 : 403, headers: noStore });
  if (error instanceof EditConflict) return Response.json({ error: error.message }, { status: 409, headers: noStore });
  const invalid = error instanceof InputError || error instanceof NotificationError || error instanceof $ZodError || error instanceof SyntaxError;
  let message: string;
  if (path === '/api/ingest') message = invalid ? error instanceof NotificationError ? error.message : '알림 입력 형식을 확인하세요.' : '알림 처리에 실패했습니다. 다시 시도하세요.';
  else if (path === '/api/notifications') message = method === 'GET' ? '알림 목록을 불러오지 못했습니다.' : error instanceof NotificationError ? error.message :
    error instanceof $ZodError || error instanceof SyntaxError ? '알림 입력값을 확인하세요.' : '알림을 처리하지 못했습니다.';
  else if (path === '/api/ledger') message = method === 'GET' ? '월 데이터를 불러오지 못했습니다. 연도와 월을 확인하세요.' :
    error instanceof InputError ? error.message : invalid ? '입력값을 확인하세요. 금액은 원 단위 정수입니다.' : '가계부를 처리하지 못했습니다. 다시 시도하세요.';
  else if (path === '/api/backup') message = method === 'GET' ? 'JSON 내보내기에 실패했습니다.' : error instanceof InputError || error instanceof $ZodError ? error.message : 'JSON 가져오기에 실패했습니다.';
  else if (path === '/api/capture/confirm') message = error instanceof InputError ? error.message : invalid ? '확정할 명세서 항목을 확인하세요.' : '명세서를 저장하지 못했습니다.';
  // mini의 $ZodError도 Error 하위 클래스다.
  else message = invalid && error instanceof Error ? error.message : '명세서를 읽지 못했습니다.';
  return Response.json({ error: message }, { status: invalid ? 400 : 500, headers: noStore });
}

export async function handleApi(request: Request, ctx: ApiContext): Promise<Response> {
  let path = ''; const method = request.method === 'HEAD' ? 'GET' : request.method;
  try {
    const url = new URL(request.url); path = url.pathname.replace(/\/$/, '');
    const allowed = methods[path];
    if (!allowed) return Response.json({ error: '요청한 API를 찾을 수 없습니다.' }, { status: 404, headers: noStore });
    const allow = [...allowed, ...(allowed.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].join(', ');
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...noStore, Allow: allow } });
    if (!allowed.includes(method)) return Response.json({ error: '지원하지 않는 요청 방식입니다.' }, { status: 405, headers: { ...noStore, Allow: allow } });
    const context = await ctx.resolve(request.headers, path === '/api/ingest' ? 'ingest' : path === '/api/capture/read' ? 'capture' : 'access');
    const response = await dispatch(request, url, path, method, context);
    return request.method === 'HEAD' ? new Response(null, response) : response;
  } catch (error) { return failure(error, path, method, ctx); }
}
