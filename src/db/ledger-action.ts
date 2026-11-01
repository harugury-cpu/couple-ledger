import { InputError } from '../lib/input-error';
import * as z from 'zod/mini';
import type { commandSchema } from '../lib/validation';
import type { LedgerCore } from './ledger-core';
import { runLedgerCommand } from './ledger-command';
import { recordEdit } from './edit-history';

export async function runLedgerAction(core: LedgerCore, command: z.infer<typeof commandSchema>, operationId?: string | null) {
  if (!operationId || command.type === 'history') return { entry_id: await runLedgerCommand(core, command) };
  if (!/^[\w-]{1,128}$/.test(operationId)) throw new InputError('작업 식별자가 올바르지 않습니다.');
  return recordEdit(core, operationId, command, tracked => runLedgerCommand(tracked, command));
}
