import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createClient } from '@libsql/client';
import { Ledger } from '../src/db/ledger';
import { createD1Ledger } from '../src/db/ledger-d1';
import { LibsqlStore, migrateLocal } from '../src/db/store-libsql';
import type { Statement } from '../src/db/store';
import { computeLines, savingsRows } from '../src/lib/calculations';
import { runLedgerAction } from '../src/db/ledger-action';
import { commandSchema } from '../src/lib/validation';
const action = (l: Ledger, command: unknown) => runLedgerAction(l, commandSchema.parse(command), crypto.randomUUID());
import type { LineInput } from '../src/lib/validation';
import { FakeD1 } from './fake-d1';

const opened: { close(): void }[] = [];
afterEach(() => { opened.forEach(o => o.close()); opened.length = 0; });
let now = { year: 2026, month: 10 };
const clock = { today: () => now };
function make(url = ':memory:') { now = { year: 2026, month: 10 }; const l = new Ledger(url, clock); opened.push(l.client); return l; }
const tempDb = () => `file:${join(mkdtempSync(join(tmpdir(), 'ledger-')), 'ledger.db')}`;
const fieldsOf = ({ id: _i, year: _y, month: _m, series_id: _s, sort: _o, ...rest }: Awaited<ReturnType<Ledger['month']>>[number]): LineInput => rest;
async function counts(l: Ledger) {
  const out: Record<string, number> = {};
  for (const table of ['ledger_months', 'month_lines', 'entries', 'transfers', 'budget_adjustments']) out[table] = Number((await l.client.execute(`SELECT count(*) AS c FROM ${table}`)).rows[0].c);
  return out;
}

it('달을 보기만 하면 DB에 쓰지 않는다 (앞으로 올 달·연도 넘김 포함)', async () => {
  const l = make(); await l.ensureMonth(2026, 10);
  const allowance = (await l.month(2026, 10)).find(r => r.name === '용돈 B')!;
  await l.setBudget(allowance.id, 500000);
  const before = await counts(l); const archive = (await l.exportArchive()).data;
  for (const [y, m] of [[2026, 11], [2026, 12], [2027, 10], [2026, 10], [2025, 3]]) { await l.snapshot(y, m); await l.month(y, m); }
  expect(await counts(l)).toEqual(before);
  expect((await l.exportArchive()).data).toEqual(archive);
});

it('앞으로 올 달도 자동 금액을 바로 채우고, 자산 누적에는 이번 달까지만 들어간다', async () => {
  const l = make(); await l.ensureMonth(2026, 10);
  const saving = (await l.month(2026, 10)).find(r => r.section === 'saving' && r.input_mode === 'fixed')!;
  await l.setBudget(saving.id, 400000);
  // 10월은 양식 달이라 기록이 없다: 11월 자동 금액은 예산으로 채운다.
  const nov = await l.snapshot(2026, 11);
  const novSaving = nov.lines.find(r => r.month === 11 && r.series_id === saving.series_id)!;
  expect(novSaving.budget).toBe(400000);
  expect(nov.entries.find(e => e.month_line_id === novSaving.id)).toMatchObject({ amount: 400000, source: 'auto' });
  // 저축 화면 자산 누적에는 아직 안 한 11·12월 저축이 들어가지 않는다.
  const rows = savingsRows(2026, computeLines(nov.lines, nov.entries, nov.adjustments), nov.uses, 0, { year: 2026, month: 10 });
  expect(rows[10].a + rows[10].b + rows[10].extra).toBeGreaterThan(0);
  expect(rows[10].assets).toBe(rows[9].assets); expect(rows[11].assets).toBe(rows[9].assets);
  const gas = nov.lines.find(r => r.month === 11 && r.name === '가스비')!;
  await l.setAmount(gas.id, 30000);
  expect((await l.snapshot(2026, 11)).months.find(m => m.month === 11)).toMatchObject({ auto_filled: true });
  // 예산만 바꾸면 이미 채운 자동 금액은 그대로다.
  await l.setBudget(novSaving.id, 450000);
  expect((await l.exportArchive()).data.entries.filter(e => e.month_line_id === novSaving.id).map(e => e.amount)).toEqual([400000]);
});

it('자동 줄에 적은 금액은 뒤 달들로 이어지고, 앞 달은 그대로이며, 손으로 적은 달에서 멈춘다', async () => {
  const l = make(); await l.ensureMonth(2026, 10);
  const oct = (await l.month(2026, 10)).find(r => r.section === 'saving' && r.input_mode === 'fixed')!;
  await l.setAmount(oct.id, 100000);
  // 새 달은 전달에 적힌 금액으로 채운다.
  await l.ensureMonth(2027, 2);
  const amountAt = async (year: number, month: number) => {
    const s = await l.snapshot(year, month);
    const line = s.lines.find(r => r.year === year && r.month === month && r.series_id === oct.series_id)!;
    return computeLines([line], s.entries, [])[0].actual;
  };
  expect(await amountAt(2026, 12)).toBe(100000);
  // 11월에 적으면 12월~2월이 따라오고 10월은 그대로다.
  const nov = (await l.month(2026, 11)).find(r => r.series_id === oct.series_id)!;
  await l.setAmount(nov.id, 120000);
  expect([await amountAt(2026, 10), await amountAt(2026, 12), await amountAt(2027, 2)]).toEqual([100000, 120000, 120000]);
  // 1월을 손으로 고친 뒤 11월을 다시 바꾸면 12월만 따라오고 1월부터는 1월 값이 이어진다.
  const jan = (await l.month(2027, 1)).find(r => r.series_id === oct.series_id)!;
  await l.setAmount(jan.id, 90000);
  await l.setAmount(nov.id, 130000);
  expect([await amountAt(2026, 12), await amountAt(2027, 1), await amountAt(2027, 2)]).toEqual([130000, 90000, 90000]);
});

it('이번 달이 아직 없으면 자동 금액까지 넣은 모습으로 보여 주고, 그대로 만들어진다', async () => {
  const l = make(); await l.ensureMonth(2026, 9);
  const allowance = (await l.month(2026, 9)).find(r => r.name === '용돈 B')!;
  await l.setBudget(allowance.id, 450000);
  const preview = await l.snapshot(2026, 10);
  const line = preview.lines.find(r => r.month === 10 && r.series_id === allowance.series_id)!;
  expect(computeLines([line], preview.entries, [])[0].actual).toBe(450000);
  await l.markPrompt(2026, 10);
  const real = await l.snapshot(2026, 10);
  expect(real.lines.filter(r => r.month === 10)).toEqual(preview.lines.filter(r => r.month === 10));
  expect(real.entries.filter(e => e.month_line_id === line.id)).toEqual(preview.entries.filter(e => e.month_line_id === line.id));
});

it('batch는 하나라도 실패하면 아무것도 남기지 않는다', async () => {
  const l = make(); await l.init();
  const before = await counts(l);
  const ok = { sql: 'INSERT INTO ledger_months (year, month, special_prompt_seen) VALUES (?, ?, 0)', params: [2026, 1] };
  const bad = { sql: 'INSERT INTO ledger_months (year, month, special_prompt_seen) VALUES (?, ?, 0)', params: [2026, 13] }; // CHECK 위반
  await expect(l.store.batch([ok, bad])).rejects.toThrow();
  expect(await counts(l)).toEqual(before);
});

it('저장 하나(줄 추가 + 이체 묶음 + 금액 + 이후 달 복사)는 batch 하나로 가고, 실패하면 하나도 남지 않는다', async () => {
  class FailingStore extends LibsqlStore {
    fail = false; calls = 0;
    override async batch(statements: Statement[]) {
      this.calls++;
      return super.batch(this.fail ? [...statements, { sql: 'INSERT INTO no_such_table VALUES (1)', params: [] }] : statements);
    }
  }
  now = { year: 2026, month: 10 };
  const store = new FailingStore(':memory:'); opened.push(store);
  const { LedgerCore } = await import('../src/db/ledger-core');
  const l = new LedgerCore(store, clock);
  await l.ensureMonth(2026, 1); await l.ensureMonth(2026, 3);
  const [line] = await l.month(2026, 1);
  const read = async () => (await l.exportArchive()).data;
  const before = await read();
  store.fail = true; store.calls = 0;
  await expect(l.createLine(2026, 1, { ...fieldsOf(line), name: '실패할줄', section: 'variable', saving_owner: null, category_id: null }, 1000, '새계좌', true)).rejects.toThrow();
  expect(store.calls).toBe(1);
  const after = await read();
  expect({ ...after, exported: 0 }).toEqual({ ...before, exported: 0 });
});

it('로컬 파일 DB에서 동시에 저장해도 SQLITE_BUSY로 실패하지 않고 합계가 맞다', async () => {
  const url = tempDb(); const l = make(url); const other = new Ledger(url, clock); opened.push(other.client);
  await l.ensureMonth(2026, 1);
  const lines = (await l.month(2026, 1)).filter(r => r.section !== 'income');
  const jobs: Promise<unknown>[] = [];
  lines.forEach((line, i) => {
    jobs.push(l.setAmount(line.id, 1000 + i));
    jobs.push(other.quickEntry(line.id, 10, `동시 ${i}`));
    jobs.push(l.setBudget(line.id, 5000 + i));
  });
  // 같은 칸을 동시에 저장하면 마지막 값 하나만 남는다(두 값이 더해지지 않는다).
  const target = (await l.month(2026, 1)).find(r => r.name === '보너스')!;
  jobs.push(l.setAmount(target.id, 777), other.setAmount(target.id, 888));
  const results = await Promise.allSettled(jobs);
  expect(results.filter(r => r.status === 'rejected')).toEqual([]);
  const snap = await l.snapshot(2026, 1);
  const computed = computeLines(snap.lines, snap.entries, snap.adjustments);
  expect([777, 888]).toContain(computed.find(r => r.id === target.id)!.actual);
  // 자동 줄은 금액 저장이 예산도 맞추므로, 예산은 마지막에 저장된 쪽(예산 5000+i 또는 금액 1000+i)이다.
  lines.forEach((line, i) => expect(line.input_mode === 'fixed' ? [5000 + i, 1000 + i] : [5000 + i]).toContain(computed.find(r => r.id === line.id)!.budget));
  // 금액 칸 저장과 빠른 입력이 섞여도 빠른 입력 10원은 사라지지 않는다: 최종 금액은 (저장한 값) 또는 (저장한 값 + 10)
  lines.forEach((line, i) => expect([1000 + i, 1010 + i]).toContain(computed.find(r => r.id === line.id)!.actual));
});

it('예전 DB 파일(마이그레이션 기록 없음, 이체 묶음 열 없음)도 그대로 올라온다', async () => {
  const url = tempDb(); const path = url.slice(5);
  const legacy = createClient({ url });
  await legacy.executeMultiple(`
    CREATE TABLE ledger_months (year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), special_prompt_seen INTEGER NOT NULL DEFAULT 0, UNIQUE(year,month));
    CREATE TABLE month_lines (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, series_id TEXT NOT NULL, section TEXT NOT NULL, name TEXT NOT NULL, category_id TEXT, payment_method_id TEXT, pay_day INTEGER, budget INTEGER NOT NULL, input_mode TEXT NOT NULL, saving_owner TEXT, one_off INTEGER NOT NULL, sort INTEGER NOT NULL, UNIQUE(year,month,series_id));
    INSERT INTO ledger_months VALUES (2026, 9, 1);`);
  legacy.close();
  const l = make(url); await l.init();
  const migrations = readdirSync('migrations').filter(f => f.endsWith('.sql')).sort();
  expect((await l.client.execute('SELECT name FROM d1_migrations ORDER BY name')).rows.map(r => r.name)).toEqual(migrations);
  expect((await l.snapshot(2026, 9)).months).toEqual([{ year: 2026, month: 9, special_prompt_seen: true, auto_filled: true }]);
  const columns = (await l.client.execute('PRAGMA table_info(month_lines)')).rows.map(c => c.name);
  expect(columns).toContain('transfer_key');
  // 다시 열어도 마이그레이션을 두 번 적용하지 않는다.
  const again = new Ledger(url, clock); opened.push(again.client); await again.init();
  expect((await again.client.execute('SELECT count(*) AS c FROM d1_migrations')).rows[0].c).toBe(migrations.length);
  expect(dirname(path)).toBeTruthy();
});

it('저축 명의 마이그레이션은 참조를 켠 상태에서도 행과 금액을 유지한다', async () => {
  const url = tempDb();
  const legacy = createClient({ url });
  opened.push(legacy);
  await legacy.execute('PRAGMA foreign_keys = ON');
  await legacy.executeMultiple(`
    CREATE TABLE members (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')));
    INSERT INTO members VALUES ('local-owner', '', '사용자', 'owner');
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL);
    CREATE TABLE payment_methods (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('card','account')), owner TEXT NOT NULL);
    CREATE TABLE month_lines (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, series_id TEXT NOT NULL, section TEXT NOT NULL, name TEXT NOT NULL, category_id TEXT, payment_method_id TEXT, pay_day INTEGER, budget INTEGER NOT NULL, input_mode TEXT NOT NULL, saving_owner TEXT, one_off INTEGER NOT NULL, sort INTEGER NOT NULL, transfer_key TEXT, UNIQUE(year,month,series_id));
    INSERT INTO month_lines VALUES
      ('line-a', 2026, 1, 'series-a', 'saving', '저축 앞', NULL, NULL, 5, 0, 'fixed', 'z-legacy', 0, 0, NULL),
      ('line-b', 2026, 1, 'series-b', 'saving', '저축 뒤', NULL, NULL, 5, 0, 'fixed', 'm-legacy', 0, 1, NULL),
      ('line-keep', 2026, 1, 'series-keep', 'saving', '저축 유지', NULL, NULL, 5, 0, 'fixed', 'a', 0, 2, NULL),
      ('line-spend', 2026, 1, 'series-spend', 'fixed', '지출', NULL, NULL, NULL, 0, 'manual', NULL, 0, 3, NULL);
    CREATE TABLE entries (id TEXT PRIMARY KEY, month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE, amount INTEGER NOT NULL, source TEXT NOT NULL, raw_text TEXT, dedupe_key TEXT, created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL);
    INSERT INTO entries VALUES ('entry-1', 'line-spend', 30, 'manual', NULL, NULL, 'local-owner', '2026-01-01T00:00:00.000Z');
    CREATE TABLE special_expenses (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, name TEXT NOT NULL, amount INTEGER NOT NULL, funding TEXT NOT NULL, from_line_id TEXT REFERENCES month_lines(id), calendar_event_id TEXT);
    INSERT INTO special_expenses VALUES ('special-1', 2026, 1, '경조사', 10, 'line', 'line-spend', NULL);
    CREATE TABLE budget_adjustments (id TEXT PRIMARY KEY, month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE, amount INTEGER NOT NULL, special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE);
    INSERT INTO budget_adjustments VALUES ('adjust-1', 'line-spend', -10, 'special-1');
    CREATE TABLE saving_uses (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL, amount INTEGER NOT NULL, memo TEXT NOT NULL, special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE);
    INSERT INTO saving_uses VALUES ('use-1', 2026, 1, 10, '', 'special-1');
    CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO d1_migrations (name) VALUES ('0001_init.sql'), ('0002_ledger_months_auto_filled.sql'), ('0003_capture.sql'), ('0004_notifications.sql');
  `);
  // 부분 스키마인 이 fixture는 명의 변환만 검증한다. 이후의 전체 앱 마이그레이션과 격리한다.
  mkdirSync(resolve('_scratch'), { recursive: true });
  const migrationDir = mkdtempSync(resolve('_scratch/owner-migration-'));
  writeFileSync(join(migrationDir, '0005_saving_owner_keys.sql'), readFileSync(resolve('migrations/0005_saving_owner_keys.sql'), 'utf8'), 'utf8');
  await migrateLocal(legacy, migrationDir);
  const owners = (await legacy.execute("SELECT saving_owner AS owner, count(*) AS c FROM month_lines GROUP BY saving_owner ORDER BY owner")).rows.map(row => [row.owner, Number(row.c)]);
  expect(owners).toEqual([[null, 1], ['a', 2], ['b', 1]]);
  expect(Number((await legacy.execute('SELECT count(*) AS c FROM entries')).rows[0].c)).toBe(1);
  expect(Number((await legacy.execute('SELECT count(*) AS c FROM entries e LEFT JOIN month_lines l ON l.id = e.month_line_id WHERE l.id IS NULL')).rows[0].c)).toBe(0);
  expect(Number((await legacy.execute('SELECT count(*) AS c FROM special_expenses')).rows[0].c)).toBe(1);
  expect(Number((await legacy.execute('SELECT count(*) AS c FROM budget_adjustments')).rows[0].c)).toBe(1);
  expect(Number((await legacy.execute('SELECT count(*) AS c FROM saving_uses')).rows[0].c)).toBe(1);
  expect(Number((await legacy.execute('SELECT amount AS c FROM entries WHERE id = \'entry-1\'')).rows[0].c)).toBe(30);
  await expect(legacy.execute("INSERT INTO month_lines (id, year, month, series_id, section, name, budget, input_mode, saving_owner, one_off, sort) VALUES ('nope', 2026, 1, 'nope', 'saving', '거부', 0, 'fixed', 'legacy', 0, 9)")).rejects.toThrow();
});

it('D1 어댑터로도 같은 흐름이 돈다 (값 100개 제한·batch만 사용)', async () => {
  const d1 = new FakeD1(); opened.push(d1.client); await d1.migrate();
  now = { year: 2026, month: 10 };
  const l = createD1Ledger(d1, clock);
  const [first] = await l.month(2026, 1);
  await l.setAmount(first.id, 1200);
  const donor = (await l.month(2026, 1)).find(r => r.name === '생활비')!;
  await l.setBudget(donor.id, 1_000_000);
  await l.addSpecial(2026, 1, '경조사', 100_000, 'line', donor.id);
  await l.updateLine(first.id, { ...fieldsOf(first), name: '쇼핑' }, true, 'A은행');
  await l.ensureMonth(2026, 10);
  const snap = await l.snapshot(2026, 10);
  expect(snap.lines.filter(r => r.month === 10)).toHaveLength(29);
  expect(snap.transfers.filter(t => t.month === 10).map(t => t.account)).toEqual(['A은행']);
  // 9개월치가 한 번에 만들어져도 문장당 값 100개 제한 안에서 나눠 보낸다.
  const archive = await l.exportArchive();
  expect(archive.data.month_lines.length).toBeGreaterThan(29 * 9);
  const restored = createD1Ledger((() => { const d = new FakeD1(); opened.push(d.client); return d; })(), clock);
  await (restored.store as unknown as { d1: FakeD1 }).d1.migrate();
  await restored.importArchive(archive);
  expect((await restored.exportArchive()).data).toEqual(archive.data);
  expect(await restored.importArchive(archive)).toBeNull(); // Workers에는 백업 파일이 없다
});

it('Workers용 모듈(ledger-d1)은 node 전용 모듈을 가져오지 않는다', () => {
  const seen = new Set<string>(); const banned: string[] = [];
  const visit = (file: string) => {
    if (seen.has(file)) return; seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, spec] of source.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      if (spec.startsWith('node:') || spec.startsWith('@libsql') || spec === 'drizzle-orm/libsql') banned.push(`${file} → ${spec}`);
      else if (spec.startsWith('.')) visit(resolve(dirname(file), spec.endsWith('.ts') ? spec : `${spec}.ts`));
    }
    expect(source).not.toMatch(/\.transaction\(/);
  };
  visit(resolve('src/db/ledger-d1.ts'));
  expect(banned).toEqual([]);
  expect([...seen].some(f => f.endsWith('ledger-core.ts'))).toBe(true);
});
