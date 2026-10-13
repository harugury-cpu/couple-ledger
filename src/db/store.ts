// 저장소 어댑터: 로컬(libSQL 파일)과 배포(Cloudflare D1)가 같은 모양을 갖게 한다.
// 이 파일과 ledger-core.ts는 node 전용 모듈(node:fs 등)을 가져오지 않는다. Workers 빌드에 그대로 들어간다.
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LedgerDb = BaseSQLiteDatabase<'async', any, typeof schema>;
// 쓰기 한 줄. drizzle 쿼리의 toSQL() 결과와 같은 모양이다.
export type Statement = { sql: string; params: unknown[] };

export interface LedgerStore {
  // 읽기 전용으로 쓴다. 쓰기는 반드시 batch로 보낸다. (D1은 "읽고-판단하고-쓰기" 묶음 처리를 받지 않는다)
  readonly db: LedgerDb;
  // 쓰기를 한 번에 보낸다. 전부 반영되거나, 하나라도 실패하면 아무것도 반영되지 않는다.
  batch(statements: Statement[]): Promise<void>;
  // 표 준비. 로컬은 migrations/ 를 적용하고, D1은 `wrangler d1 migrations apply`가 맡으므로 아무것도 하지 않는다.
  prepare(): Promise<void>;
  // JSON 가져오기 직전의 내용을 보관한다. 파일을 쓸 수 없는 곳(D1/Workers)은 null을 돌려준다.
  saveBackup(json: string): Promise<string | null>;
  // 한 문장에 넣을 수 있는 값(?) 개수. D1은 100개로 제한된다.
  readonly maxParams: number;
  close(): void;
}

export function toStatement(query: { toSQL(): { sql: string; params: unknown[] } }): Statement {
  const { sql, params } = query.toSQL();
  return { sql, params };
}
