// 테스트용 가짜 D1: libSQL 메모리 DB 위에 D1의 prepare/bind/all/raw/run/batch 모양만 흉내 낸다.
// 실제 D1처럼 한 문장의 값(?)이 100개를 넘으면 거절하고, batch는 전부 되거나 전부 안 된다.
import { createClient, type Client, type InArgs } from '@libsql/client';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

class FakeStatement {
  constructor(private readonly client: Client, readonly sql: string, readonly params: unknown[] = []) {
    if (params.length > 100) throw new Error(`D1 limit: too many SQL variables (${params.length})`);
  }
  bind(...values: unknown[]) { return new FakeStatement(this.client, this.sql, values); }
  private async exec() { return this.client.execute({ sql: this.sql, args: this.params as InArgs }); }
  async all() { const r = await this.exec(); return { results: r.rows.map(row => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))), success: true, meta: {} }; }
  async raw() { const r = await this.exec(); return r.rows.map(row => r.columns.map((_, i) => row[i])); }
  async first() { return (await this.all()).results[0] ?? null; }
  async run() { await this.exec(); return { results: [], success: true, meta: {} }; }
}

export class FakeD1 {
  readonly client = createClient({ url: ':memory:' });
  batches = 0;
  prepare(sql: string) { return new FakeStatement(this.client, sql); }
  async batch(statements: FakeStatement[]) {
    this.batches++;
    await this.client.batch(statements.map(s => ({ sql: s.sql, args: s.params as InArgs })), 'write');
    return statements.map(() => ({ results: [], success: true, meta: {} }));
  }
  // wrangler d1 migrations apply 대신
  async migrate() {
    const dir = resolve('migrations');
    for (const file of readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) await this.client.executeMultiple(readFileSync(resolve(dir, file), 'utf8'));
  }
}
