import type { Metadata } from 'next';
import { Sofia_Sans } from 'next/font/google';
import './globals.css';
const sofia = Sofia_Sans({ subsets: ['latin'], variable: '--font-sofia', display: 'swap' });
export const metadata: Metadata = { title: '우리 가계부', description: '예산과 실사용을 함께 기록하는 커플 가계부' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ko" className={sofia.variable}><body>{children}</body></html>;
}
