import { readFileSync } from 'node:fs';
import { initialLines } from '../src/db/seed';
import { OwnerNames } from '../src/components/owner-names';
import { expect, test } from 'vitest';

test('공개 초기 양식에는 실제 예산이나 지출 금액이 없다', () => {
  const lines = initialLines(2026, 1);
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.every(line => line.budget === 0)).toBe(true);
  expect(lines.every(line => !('amount' in line))).toBe(true);
});

test('화면의 기본 명의는 일반적인 예시 이름이다', () => {
  expect(OwnerNames).toBeDefined();
  expect(readFileSync('src/components/owner-names.tsx', 'utf8')).toContain("a: 'A', b: 'B'");
  expect(readFileSync('src/db/ledger-core.ts', 'utf8')).toContain("name: '사용자'");
  expect(readFileSync('src/db/seed.ts', 'utf8')).toContain("['쇼핑 멤버십'");
  expect(readFileSync('migrations/0001_init.sql', 'utf8')).toContain("CHECK(saving_owner IN ('a','b','extra'))");
});

test('개인 데이터와 운영 설정은 Git에서 제외된다', () => {
  const patterns = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
  for (const pattern of ['data/', '_scratch/', '.env*', '*.numbers', '.wrangler/', '.dev.vars*', 'wrangler.jsonc', 'docs/', '기획서.md', '폰화면_와이어프레임.html']) {
    expect(patterns).toContain(pattern);
  }
  expect(patterns).toContain('!.env.example');
});

test('공개 설정 예시에는 인증 비밀값과 실제 D1 식별자가 없다', () => {
  const config = JSON.parse(readFileSync('wrangler.example.jsonc', 'utf8'));
  expect(config.d1_databases[0].database_id).toBe('00000000-0000-0000-0000-000000000000');
  expect(config.vars).toEqual({ ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '' });
  expect(readFileSync('.env.example', 'utf8')).toBe('GEMINI_API_KEY=\nINGEST_TOKEN=\n');
});
