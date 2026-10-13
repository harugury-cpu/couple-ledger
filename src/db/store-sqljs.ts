// 데모용 저장소: 브라우저 메모리 안의 SQLite(sql.js). 서버·D1과 연결되지 않고, 새로고침하면 사라진다.
// 표 구조는 실제 앱과 같은 migrations/*.sql 을 그대로 적용한다.
import type { Database } from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import * as schema from './schema';
import type { LedgerDb, LedgerStore, Statement } from './store';

export type Migration = { name: string; sql: string };

export class SqlJsStore implements LedgerStore {
  readonly db: LedgerDb;
  readonly maxParams = 10000;
  constructor(private readonly client: Database, private readonly migrations: Migration[]) {
    // sql.js 드라이버는 동기식이지만 LedgerCore는 모든 조회를 await 하므로 그대로 쓸 수 있다.
    this.db = drizzle(client, { schema }) as unknown as LedgerDb;
  }
  async batch(statements: Statement[]) {
    if (!statements.length) return;
    this.client.exec('BEGIN');
    try {
      for (const s of statements) this.client.run(s.sql, s.params as never);
      this.client.exec('COMMIT');
    } catch (error) { this.client.exec('ROLLBACK'); throw error; }
  }
  async prepare() {
    for (const m of [...this.migrations].sort((a, b) => a.name.localeCompare(b.name))) this.client.exec(m.sql);
  }
  async saveBackup() { return null; }
  close() { this.client.close(); }
}
