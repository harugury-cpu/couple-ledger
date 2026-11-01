import { InputError } from './input-error';
import * as z from 'zod/mini';
// 영어 기본 문구 하나만 불러온다(z.locales 전체를 참조하면 60여 개 언어가 Worker 번들에 들어가 시작 CPU가 늘어난다).
import en from 'zod/v4/locales/en.js';

// 이 스키마를 단독으로 읽어도 클래식 Zod의 기본 오류 문구를 유지한다.
if (!z.config().localeError) z.config(en());

export const captureReadItemSchema = z.strictObject({
  date: z.string().check(z.regex(/^(?:\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})$/)),
  merchant: z.string().check(z.trim(), z.minLength(1), z.maxLength(500)),
  amount: z.number().check(z.int(), z.minimum(-1_000_000_000_000), z.maximum(1_000_000_000_000)),
  raw: z.string().check(z.maxLength(2000)),
});
const captureResponseSchema = z.strictObject({ items: z.array(captureReadItemSchema).check(z.maxLength(2000)) });

export type CaptureReadItem = z.infer<typeof captureReadItemSchema>;
export type CaptureImage = { mimeType: string; data: string };

const responseSchema = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: '화면에 보이는 결제일. MM/DD 또는 YYYY-MM-DD' },
          merchant: { type: 'STRING', description: '가맹점 이름' },
          amount: { type: 'INTEGER', description: '원 단위 금액. 승인 취소는 음수' },
          raw: { type: 'STRING', description: '해당 거래 한 줄의 원문' },
        },
        required: ['date', 'merchant', 'amount', 'raw'],
      },
    },
  },
  required: ['items'],
} as const;

const prompt = `한국 카드 앱의 명세서 또는 이용내역 화면 이미지에서 거래 목록을 읽어 주세요.
각 거래를 날짜·가맹점·금액·해당 줄 원문으로 반환합니다.
합계, 청구금액, 포인트, 광고와 같은 거래가 아닌 줄은 제외합니다.
할부는 화면에 찍힌 이번 달 청구 금액이 있으면 그 금액을 사용합니다.
승인 취소는 음수 금액으로 반환합니다.
날짜는 화면에 보이는 MM/DD 또는 YYYY-MM-DD 형식을 그대로 씁니다.
읽을 수 없는 거래는 추측하지 말고 제외합니다. 전혀 읽지 못하면 빈 배열을 반환합니다.`;

function responseText(payload: unknown) {
  if (!payload || typeof payload !== 'object') throw new InputError('명세서 내용을 읽지 못했습니다.');
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) throw new InputError('명세서 내용을 읽지 못했습니다.');
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) throw new InputError('명세서 내용을 읽지 못했습니다.');
  const text = parts.map(part => typeof part === 'object' && part && 'text' in part && typeof part.text === 'string' ? part.text : '').join('').trim();
  if (!text) throw new InputError('명세서 내용을 읽지 못했습니다.');
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// Gemini 응답의 외부 구조와 모델이 반환한 JSON을 함께 검증한다.
export function parseCaptureResponse(payload: unknown): CaptureReadItem[] {
  try {
    return captureResponseSchema.parse(JSON.parse(responseText(payload))).items;
  } catch {
    throw new InputError('명세서 내용을 읽지 못했습니다.');
  }
}

export async function readCaptureImages(images: CaptureImage[], apiKey: string): Promise<CaptureReadItem[]> {
  if (!apiKey) throw new InputError('Gemini API 키가 설정되지 않았습니다.');
  let response: Response;
  try {
    response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...images.map(image => ({ inline_data: { mime_type: image.mimeType, data: image.data } }))] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema },
      }),
    });
  } catch {
    throw new InputError('명세서를 읽는 중 Gemini 연결에 실패했습니다.');
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new InputError('명세서 내용을 읽지 못했습니다.'); }
  if (!response.ok) throw new InputError('명세서를 읽지 못했습니다.');
  return parseCaptureResponse(payload);
}
