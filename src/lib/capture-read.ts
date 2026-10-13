import { z } from 'zod';

export const captureReadItemSchema = z.object({
  date: z.string().regex(/^(?:\d{2}\/\d{2}|\d{4}-\d{2}-\d{2})$/),
  merchant: z.string().trim().min(1).max(500),
  amount: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  raw: z.string().max(2000),
}).strict();
const captureResponseSchema = z.object({ items: z.array(captureReadItemSchema).max(2000) }).strict();

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
  if (!payload || typeof payload !== 'object') throw new Error('명세서 내용을 읽지 못했습니다.');
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) throw new Error('명세서 내용을 읽지 못했습니다.');
  const parts = (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts;
  if (!Array.isArray(parts)) throw new Error('명세서 내용을 읽지 못했습니다.');
  const text = parts.map(part => typeof part === 'object' && part && 'text' in part && typeof part.text === 'string' ? part.text : '').join('').trim();
  if (!text) throw new Error('명세서 내용을 읽지 못했습니다.');
  return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// Gemini 응답의 외부 구조와 모델이 반환한 JSON을 함께 검증한다.
export function parseCaptureResponse(payload: unknown): CaptureReadItem[] {
  try {
    return captureResponseSchema.parse(JSON.parse(responseText(payload))).items;
  } catch {
    throw new Error('명세서 내용을 읽지 못했습니다.');
  }
}

export async function readCaptureImages(images: CaptureImage[], apiKey: string): Promise<CaptureReadItem[]> {
  if (!apiKey) throw new Error('Gemini API 키가 설정되지 않았습니다.');
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
    throw new Error('명세서를 읽는 중 Gemini 연결에 실패했습니다.');
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error('명세서 내용을 읽지 못했습니다.'); }
  if (!response.ok) throw new Error('명세서를 읽지 못했습니다.');
  return parseCaptureResponse(payload);
}
