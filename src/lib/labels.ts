import type { MonthLine } from '../db/schema';
export const sections: Record<MonthLine['section'], string> = { fixed: '고정생활비', variable: '가변생활비', saving: '저축', income: '수입' };
export const modes = { card: '카드 자동', fixed: '매달 같은 금액', manual: '직접 입력' };
// 자산 계좌 종류(DB 값은 그대로, 뜻은 migrations/0007): 투자는 평가금액을 적고, 저축은 원금만 보고, 묶인 돈은 보증금처럼 꺼낼 수 없는 돈이다.
export const accountKinds = { invest: '투자', ready: '저축', reserved: '묶인 돈' } as const;
export const won =(n: number) => n.toLocaleString('ko-KR');
