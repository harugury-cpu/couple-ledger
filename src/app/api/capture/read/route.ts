import { NextRequest, NextResponse } from 'next/server';
import { checkOrigin, denied } from '../../local-request';
import { requestContext } from '../../../../db/request-ledger';
import { computeLines } from '../../../../lib/calculations';
import { matchCaptureItems } from '../../../../lib/capture-match';
import { readCaptureImages, type CaptureImage } from '../../../../lib/capture-read';
import { monthValue, yearValue } from '../../../../lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

export async function POST(request: NextRequest) {
  let context;
  try { context = await requestContext(request.headers); } catch (e) { return denied(e); }
  try {
    checkOrigin(request);
    const form = await request.formData();
    const year = yearValue.parse(Number(form.get('year')));
    const month = monthValue.parse(Number(form.get('month')));
    const values = form.getAll('images').length ? form.getAll('images') : form.getAll('image');
    if (values.length < 1 || values.length > 5) throw new Error('명세서 이미지는 1~5장까지 올릴 수 있습니다.');
    const images: CaptureImage[] = [];
    for (const value of values) {
      if (!(value instanceof File) || !value.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있습니다.');
      if (value.size > 8 * 1024 * 1024) throw new Error('이미지 한 장은 8MB까지 올릴 수 있습니다.');
      images.push({ mimeType: value.type, data: toBase64(new Uint8Array(await value.arrayBuffer())) });
    }
    if (!context.geminiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    const read = await readCaptureImages(images, context.geminiKey);
    const snapshot = await context.ledger.snapshot(year, month);
    const lines = computeLines(snapshot.lines.filter(line => line.month === month), snapshot.entries, snapshot.adjustments);
    const lineIds = new Set(lines.map(line => line.id));
    const entries = snapshot.entries.filter(entry => lineIds.has(entry.month_line_id));
    return NextResponse.json({ items: matchCaptureItems(read, lines, snapshot.matchRules, entries, year, month) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '명세서를 읽지 못했습니다.' }, { status: 400 });
  }
}
