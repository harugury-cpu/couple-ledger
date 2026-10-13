// 로컬 실행·테스트용 저장소: libSQL 파일(data/ledger.db) 또는 :memory:.
// node:fs를 쓰는 코드는 여기에만 둔다. Workers 빌드는 이 파일을 가져오지 않는다.
import { createClient, type Client, type InArgs } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import type { LedgerDb, LedgerStore, Statement } from './store';

export class LibsqlStore implements LedgerStore {
  readonly client: Client;
  readonly db: LedgerDb;
  readonly backupDirectory: string;
  readonly maxParams = 10000;
  private readonly migrationsDirectory: string;
  constructor(url: string, migrationsDirectory = resolve(/* turbopackIgnore: true */ process.env.LEDGER_MIGRATIONS_DIR || 'migrations')) {
    if (url.startsWith('file:')) mkdirSync(dirname(url.slice(5)), { recursive: true });
    this.backupDirectory = url.startsWith('file:') ? resolve(/* turbopackIgnore: true */ dirname(url.slice(5)), 'backups') : resolve('_scratch/test-backups');
    this.migrationsDirectory = migrationsDirectory;
    // timeout: 연결마다 걸리는 잠금 대기 시간(ms). PRAGMA는 연결 하나에만 걸려 새 연결에는 빠졌었다.
    // 다른 프로세스(예: 동시에 띄운 스크립트)가 쓰는 중일 때만 쓰인다. 이 앱 안의 쓰기는 batch 하나로 끝나 서로 겹치지 않는다.
    this.client = createClient({ url, timeout: 5000 });
    this.db = drizzle(this.client, { schema }) as unknown as LedgerDb;
  }
  async batch(statements: Statement[]) {
    if (!statements.length) return;
    // 'write' = BEGIN IMMEDIATE: 시작할 때 쓰기 잠금을 잡고, 끝까지 한 번에 실행한 뒤 COMMIT. 실패하면 전부 되돌린다.
    await this.client.batch(statements.map(s => ({ sql: s.sql, args: s.params as InArgs })), 'write');
  }
  async prepare() { await migrateLocal(this.client, this.migrationsDirectory); }
  async saveBackup(json: string) {
    mkdirSync(this.backupDirectory, { recursive: true });
    const path = `${this.backupDirectory}/ledger-before-import-${Date.now()}-${crypto.randomUUID()}.json`;
    await writeFile(path, json, { encoding: 'utf8', flag: 'wx' });
    return path;
  }
  close() { this.client.close(); }
}

// migrations/*.sql 을 이름 순서로 한 번씩 적용한다. 적용 기록은 wrangler와 같은 d1_migrations 표에 남긴다.
export async function migrateLocal(client: Client, directory: string) {
  await client.execute('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  // 마이그레이션 파일이 생기기 전에 만든 DB: 이체 묶음 열이 없을 수 있다(예전 init의 보정을 그대로 옮김).
  const legacy = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'month_lines'");
  if (legacy.rows.length) {
    const columns = await client.execute('PRAGMA table_info(month_lines)');
    if (!columns.rows.some(c => c.name === 'transfer_key')) await client.execute('ALTER TABLE month_lines ADD COLUMN transfer_key TEXT');
  }
  const applied = new Set((await client.execute('SELECT name FROM d1_migrations')).rows.map(r => String(r.name)));
  const files = readdirSync(directory).filter(f => /^\d+_.+\.sql$/.test(f)).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const body = readFileSync(resolve(directory, file), 'utf8');
    // 파일 하나와 적용 기록을 한 트랜잭션으로. 실패하면 연결을 돌려줄 때 되돌려진다.
    await client.executeMultiple(`BEGIN IMMEDIATE;\n${body}\n;INSERT INTO d1_migrations (name) VALUES ('${file.replaceAll("'", "''")}');\nCOMMIT;`);
  }
}
