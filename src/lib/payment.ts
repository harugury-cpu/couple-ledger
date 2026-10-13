// 수단 칸에 적은 글자를 결제일과 결제수단으로 읽는다: '8일(A은행)', '생활카드', '7일', 빈칸.
export function parsePayment(text: string, methods: { id: string; name: string }[]): { pay_day: number | null; payment_method_id: string | null } {
  const clean = text.trim();
  if (!clean) return { pay_day: null, payment_method_id: null };
  const whole = methods.find(m => m.name === clean);
  if (whole) return { pay_day: null, payment_method_id: whole.id };
  const dayOnly = /^(\d{1,2})일?$/.exec(clean);
  const dayAndMethod = /^(\d{1,2})일\s*\((.+)\)$/.exec(clean);
  const day = dayOnly ?? dayAndMethod;
  if (day && (Number(day[1]) < 1 || Number(day[1]) > 31)) throw new Error('결제일은 1~31일로 적으세요.');
  if (dayOnly) return { pay_day: Number(dayOnly[1]), payment_method_id: null };
  const name = dayAndMethod ? dayAndMethod[2].trim() : clean;
  const method = methods.find(m => m.name === name);
  if (!method) throw new Error(`“${name}” 결제수단이 없습니다. 설정에서 먼저 추가하거나 이름을 확인하세요.`);
  return { pay_day: dayAndMethod ? Number(dayAndMethod[1]) : null, payment_method_id: method.id };
}
