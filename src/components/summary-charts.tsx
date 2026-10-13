'use client';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { won } from '../lib/labels';

// 크림·잉크·주황 계열(DESIGN-mastercard.md). 이웃한 조각이 구분되도록 밝기를 번갈아 둔다.
const ink = '#141413';
const gridColor = '#e6e0d8';
const categoryColors = ['#cf4500', '#141413', '#f37338', '#3860be', '#e0a040', '#9a3a0a', '#8fa8dc', '#b5afa7'];
const budgetColor = ink;
// 1~8월은 옅은 주황에서 짙은 갈색으로, 9~12월은 파랑으로 이어진다
const monthColors = ['#f9d9c4', '#f6be9a', '#f3a16c', '#f37338', '#e05a1a', '#cf4500', '#9a3a0a', '#6e2a08', '#b9c7e8', '#8fa8dc', '#3860be', '#27448a'];
const axisTick = { fontSize: 11, fill: '#696969' };

const amount = (value: unknown) => `${won(Number(value))}원`;
const tick = (value: number) => Math.abs(value) >= 10000 ? `${won(value / 10000)}만` : won(value);
type Row = { name: string; budget: number; months: number[] };

export function BudgetCharts({ rows, activeMonths }: { rows: Row[]; activeMonths: number[] }) {
  // 도넛: 올해 실제로 쓴 돈의 카테고리 비율
  const yearly = rows.map((r, i) => ({ name: r.name, actual: r.months.reduce((a, b) => a + b, 0), color: categoryColors[i % categoryColors.length] })).filter(r => r.actual > 0);
  const totalActual = yearly.reduce((a, r) => a + r.actual, 0);
  // 막대: 카테고리마다 예산과 월별 실제
  const bars = rows.map(r => ({ name: r.name, 예산: r.budget, ...Object.fromEntries(activeMonths.map(m => [`${m}월`, r.months[m - 1]])) }));
  return <div className="charts">
    <section>
      <h3>실제 요약</h3>
      {yearly.length ? <div className="chart" aria-label="카테고리별 실사용 도넛 차트"><ResponsiveContainer initialDimension={{ width: 360, height: 300 }}>
        <PieChart margin={{ top: 8, right: 44, bottom: 8, left: 52 }}>
          <Pie data={yearly} dataKey="actual" nameKey="name" innerRadius="46%" outerRadius="62%" isAnimationActive={false} stroke="none" labelLine={false}
            label={({ x, y, textAnchor, name, value }) => {
              const percent = Math.round(Number(value) / totalActual * 100);
              return percent >= 1 ? <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central" fontSize={11} fill={ink}>{name} {percent}%</text> : null;
            }}>
            {yearly.map(r => <Cell key={r.name} fill={r.color} />)}
          </Pie>
          <Tooltip formatter={amount} />
        </PieChart>
      </ResponsiveContainer></div> : <p className="empty-chart">금액을 기록하면 카테고리별 실사용 비율이 여기에 표시됩니다.</p>}
    </section>
    <section>
      <h3>예산 vs 실제</h3>
      <div className="chart" aria-label="카테고리별 예산과 월별 실사용 막대 차트"><ResponsiveContainer initialDimension={{ width: 640, height: 300 }}>
        <BarChart data={bars} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barGap={0} barCategoryGap="14%">
          <CartesianGrid vertical={false} stroke={gridColor} />
          <XAxis dataKey="name" tick={axisTick} interval={0} />
          <YAxis tickFormatter={tick} width={58} tick={axisTick} />
          <Tooltip formatter={amount} />
          <Legend iconType="square" iconSize={10} itemSorter={null} wrapperStyle={{ fontSize: 11 }} formatter={value => <span style={{ color: ink }}>{value}</span>} />
          <Bar dataKey="예산" fill={budgetColor} isAnimationActive={false} />
          {activeMonths.map(m => <Bar key={m} dataKey={`${m}월`} fill={monthColors[m - 1]} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer></div>
    </section>
  </div>;
}

export function SavingsChart({ rows, title = '자산 누적', label = '월별 누적 자산 그래프', name = '자산' }: { rows: { month: number; assets: number }[]; title?: string; label?: string; name?: string }) {
  return <section className="savings-chart"><h3>{title}</h3>
    <div className="chart" aria-label={label}><ResponsiveContainer initialDimension={{ width: 800, height: 280 }}>
      <LineChart data={rows} margin={{ top: 12, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke={gridColor} />
        <XAxis dataKey="month" tickFormatter={v => `${v}월`} tick={axisTick} />
        <YAxis tickFormatter={tick} width={70} tick={axisTick} />
        <Tooltip formatter={amount} labelFormatter={v => `${v}월`} />
        <Line name={name} dataKey="assets" stroke="#f37338" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer></div>
  </section>;
}
