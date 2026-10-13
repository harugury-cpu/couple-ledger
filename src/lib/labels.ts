import type { MonthLine } from '../db/schema';
export const sections: Record<MonthLine['section'], string> = { fixed: '고정생활비', variable: '가변생활비', saving: '저축', income: '수입' };
export const modes = { card: '카드 자동', fixed: '매달 같은 금액', manual: '직접 입력' };
export const accountKinds = { ready: '바로 쓸 수 있는 돈', reserved: '쓸 곳이 정해진 돈', invest: '저축·투자' } as const;
export const won =(n: number) => n.toLocaleString('ko-KR');
