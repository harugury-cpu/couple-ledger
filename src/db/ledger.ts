// 로컬 실행용 진입점: libSQL 파일(data/ledger.db). API 라우트와 화면은 여기서 가져온다.
// 배포(Workers + D1)에서는 ledger-d1.ts의 createD1Ledger(env.DB)를 쓴다. 이 파일은 node:fs를 쓰는 저장소를 가져오므로 Workers 빌드에 넣지 않는다.
import { resolve } from 'node:path';
import { LedgerCore, type LedgerOptions } from './ledger-core';
import { LibsqlStore } from './store-libsql';

export class Ledger extends LedgerCore {
  declare readonly store: LibsqlStore;
  constructor(url = `file:${resolve(/* turbopackIgnore: true */ process.env.LEDGER_DB_PATH || 'data/ledger.db')}`, options?: LedgerOptions) {
    super(new LibsqlStore(url), options);
  }
  get client() { return this.store.client; }
  get backupDirectory() { return this.store.backupDirectory; }
  // 로컬은 가져오기 전 백업 파일을 항상 남기므로 경로가 있다.
  override async importArchive(input: unknown): Promise<string> { return (await super.importArchive(input))!; }
}
const globalLedger = globalThis as typeof globalThis & { ledger?: Ledger };
export function getLedger() { return globalLedger.ledger ??= new Ledger(); }
