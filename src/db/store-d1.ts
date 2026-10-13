// 배포용 저장소: Cloudflare D1. node 전용 모듈을 가져오지 않는다.
import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';
import type { LedgerDb, LedgerStore, Statement } from './store';

// @cloudflare/workers-types를 의존성에 넣지 않으려고 쓰는 부분만 적었다. 실제 값은 Workers의 env.DB.
export interface D1PreparedStatementLike { bind(...values: unknown[]): D1PreparedStatementLike }
export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
  batch(statements: D1PreparedStatementLike[]): Promise<unknown>;
}

export class D1Store implements LedgerStore {
  readonly db: LedgerDb;
  readonly maxParams = 100;
  constructor(private readonly d1: D1DatabaseLike) {
    this.db = drizzle(d1 as never, { schema }) as unknown as LedgerDb;
  }
  // D1의 batch는 하나의 트랜잭션으로 실행된다. 하나라도 실패하면 전부 되돌린다.
  async batch(statements: Statement[]) {
    if (!statements.length) return;
    await this.d1.batch(statements.map(s => this.d1.prepare(s.sql).bind(...s.params)));
  }
  async prepare() { /* wrangler d1 migrations apply 가 표를 만든다 */ }
  async saveBackup() { return null; }
  close() { /* 연결은 Workers 런타임이 관리한다 */ }
}
