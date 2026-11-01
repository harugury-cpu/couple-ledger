import { afterEach, expect, test } from 'vitest';
import { Ledger } from '../src/db/ledger';
import { runLedgerCommand } from '../src/db/ledger-command';
import { canonicalSavingOwner, commandSchema, lineFields } from '../src/lib/validation';

let ledger: Ledger | undefined;
afterEach(() => { ledger?.client.close(); ledger = undefined; });

test('이전 화면의 저축 수정 요청은 명의를 보존해 현재 달과 이후 달에 저장한다', async () => {
  ledger = new Ledger(':memory:');
  await ledger.ensureMonth(2026, 1);
  await ledger.ensureMonth(2026, 2);
  for (const [legacy, owner] of [['z-legacy', 'a'], ['m-legacy', 'b']] as const) {
    const line = (await ledger.month(2026, 1)).find(l => l.section === 'saving' && l.saving_owner === owner)!;
    const { id, year, month, series_id, sort, ...fields } = line;
    const command = commandSchema.parse({ type: 'update', id, fields: { ...fields, name: '저축 계좌 변경', budget: 1_200_000, saving_owner: legacy }, future: true, transfer_account: '' });
    expect(command.type === 'update' && command.fields.saving_owner).toBe(canonicalSavingOwner(legacy));
    await runLedgerCommand(ledger, command);
    for (const selected of [1, 2]) {
      expect((await ledger.month(2026, selected)).find(l => l.series_id === series_id)).toMatchObject({ name: '저축 계좌 변경', budget: 1_200_000, saving_owner: owner });
    }
  }
});

test('이전 화면의 새 저축도 같은 명의 변환을 쓰며 저장 형식은 현재 키만 허용한다', async () => {
  ledger = new Ledger(':memory:');
  const line = (await ledger.month(2026, 1)).find(l => l.section === 'saving')!;
  const { id, year, month, series_id, sort, ...fields } = line;
  const legacyFields = { ...fields, name: '새 저축', budget: 1_200_000, saving_owner: 'm-legacy' };
  const command = commandSchema.parse({ type: 'create', year, month, fields: legacyFields });
  await runLedgerCommand(ledger, command);
  expect((await ledger.month(year, month)).find(l => l.name === '새 저축')?.saving_owner).toBe('b');
  expect(lineFields.safeParse(legacyFields).success).toBe(false);
  for (const saving_owner of ['', 'x'.repeat(33), 123, {}]) {
    expect(commandSchema.safeParse({ type: 'update', id, fields: { ...fields, saving_owner } }).success).toBe(false);
  }
});
