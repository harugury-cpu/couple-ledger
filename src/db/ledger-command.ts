// 가계부 변경 명령 하나를 실행한다. /api/ledger와 데모 화면(브라우저 안 가계부)이 같이 쓴다.
import type { z } from 'zod';
import type { LedgerCore } from './ledger-core';
import type { commandSchema } from '../lib/validation';

export async function runLedgerCommand(l: LedgerCore, cmd: z.infer<typeof commandSchema>): Promise<string | undefined> {
  let entry_id: string | undefined;
  switch (cmd.type) {
    case 'amount': await l.setAmount(cmd.id, cmd.amount); break;
    case 'budget': await l.setBudget(cmd.id, cmd.amount, cmd.future); break;
    case 'create': await l.createLine(cmd.year, cmd.month, cmd.fields, cmd.amount, cmd.transfer_account, cmd.future); break;
    case 'update': await l.updateLine(cmd.id, cmd.fields, cmd.future, cmd.transfer_account); break;
    case 'payment': await l.setPayment(cmd.ids, cmd.pay_day, cmd.payment_method_id, cmd.future); break;
    case 'move': await l.moveLine(cmd.id, cmd.direction); break;
    case 'transfer': await l.saveTransfer(cmd.id, { account: cmd.account, amount: cmd.amount }); break;
    case 'category-save': await l.saveCategory(cmd.name, cmd.id); break;
    case 'category-delete': await l.deleteCategory(cmd.id); break;
    case 'payment-save': await l.savePayment(cmd.name, cmd.kind, cmd.owner, cmd.id, {
      ...(cmd.notify_app !== undefined && { notify_app: cmd.notify_app }),
      ...(cmd.notify_keyword !== undefined && { notify_keyword: cmd.notify_keyword }),
      ...(cmd.billing_kind !== undefined && { billing_kind: cmd.billing_kind }),
      ...(cmd.cutoff_day !== undefined && { cutoff_day: cmd.cutoff_day }),
    }); break;
    case 'payment-delete': await l.deletePayment(cmd.id); break;
    case 'prompt': await l.markPrompt(cmd.year, cmd.month); break;
    case 'special': await l.addSpecial(cmd.year, cmd.month, cmd.name, cmd.amount, cmd.funding, cmd.from_line_id); break;
    case 'special-delete': await l.deleteSpecial(cmd.id); break;
    case 'opening': await l.setOpening(cmd.year, cmd.amount); break;
    case 'use': await l.setUse(cmd.year, cmd.month, cmd.amount); break;
    case 'quick': entry_id = await l.quickEntry(cmd.id, cmd.amount, cmd.raw); break;
    case 'undo': await l.undoQuick(cmd.entry_id); break;
    case 'delete': await l.deleteLine(cmd.id, cmd.future); break;
    case 'account-save': await l.saveAccount(cmd.name, cmd.kind, cmd.target, cmd.id); break;
    case 'account-delete': await l.deleteAccount(cmd.id); break;
    case 'balance': await l.setBalance(cmd.id, cmd.year, cmd.month, cmd.amount); break;
  }
  return entry_id;
}
