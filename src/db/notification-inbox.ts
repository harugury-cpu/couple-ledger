import { and, desc, eq, or } from 'drizzle-orm';
import type { LedgerCore } from './ledger-core';
import { entries, members, matchRules, notificationEvents, paymentMethods, type MonthLine, type NotificationEvent } from './schema';
import { toStatement, type Statement } from './store';
import {
  DUPLICATE_WINDOW_MS, identifyNotificationMethods, matchNotification, notificationKeys, notificationMonth, notificationRaw,
  notificationSchema, notificationTransactionSchema, readNotification, seoulDate,
  type IngestResult, type NotificationBilling, type NotificationInput, type NotificationTransaction,
} from '../lib/notification';

export class NotificationError extends Error {}
export class NotificationInbox {
  constructor(private readonly ledger: LedgerCore, private readonly now: () => Date = () => new Date()) {}

  private async event(id: string) {
    await this.ledger.init();
    const [event] = await this.ledger.db.select().from(notificationEvents).where(eq(notificationEvents.id, id));
    if (!event) throw new NotificationError('알림을 찾을 수 없습니다.');
    return event;
  }
  private view(event: NotificationEvent) {
    const input = notificationSchema.parse(JSON.parse(event.payload));
    const transaction = event.transaction_json ? notificationTransactionSchema.parse(JSON.parse(event.transaction_json)) : null;
    const read = readNotification(notificationRaw(input), event.created_at);
    return { id: event.id, status: event.status, app: input.app, raw: notificationRaw(input), transaction,
      date: transaction?.date ?? read.date ?? '', merchant: transaction?.merchant ?? read.merchant ?? '', amount: transaction?.amount ?? read.amount,
      year: event.year, month: event.month, lineName: event.line_name, paymentMethodId: event.payment_method_id,
      billing_kind: event.billing_kind, cutoff_day: event.cutoff_day, reason: event.reason, receivedAt: event.created_at };
  }
  async result(id: string) { return this.view(await this.event(id)); }
  async list(year: number, month: number) {
    await this.ledger.init();
    // 과거·다음 청구월의 미분류도 현재 화면에서 발견할 수 있게 모두 보인다.
    const events = await this.ledger.db.select().from(notificationEvents).where(or(
      eq(notificationEvents.status, 'review'), and(eq(notificationEvents.year, year), eq(notificationEvents.month, month)),
    )).orderBy(desc(notificationEvents.received_at));
    return { pending: events.filter(event => event.status === 'review').map(event => this.view(event)),
      history: events.filter(event => event.status !== 'review').map(event => this.view(event)) };
  }
  async receive(input: NotificationInput): Promise<IngestResult> {
    input = notificationSchema.parse(input);
    await this.ledger.init();
    const now = this.now(); const createdAt = now.toISOString();
    const methods = identifyNotificationMethods(input, await this.ledger.db.select().from(paymentMethods));
    const method = methods.length === 1 ? methods[0] : null;
    const { fingerprint, approvalKey, read } = await notificationKeys(input, method?.id ?? null, createdAt);
    const billing: NotificationBilling = method ?? { billing_kind: 'debit', cutoff_day: 31 };
    const target = notificationMonth(read.transaction?.date ?? seoulDate(now), billing);
    const raw = notificationRaw(input);
    let reason: string | null = !methods.length ? '카드 미지정' : methods.length > 1 ? '카드 설정이 겹칩니다' :
      /할부/.test(raw) ? '할부 금액을 확인하세요' : !read.transaction ? '원문을 확인하세요' : null;
    let line: MonthLine | null = null;
    if (!reason && read.transaction && method) {
      line = matchNotification(read.transaction, method.id, await this.ledger.month(target.year, target.month), await this.ledger.db.select().from(matchRules));
      if (!line) reason = '맞는 줄을 골라주세요';
    }
    const id = crypto.randomUUID();
    // dedupe를 위한 선행 SELECT가 없다. 조건 검사와 INSERT가 같은 SQL이며 batch의 쓰기 잠금 안에서 실행된다.
    const statements: Statement[] = [{
      sql: `INSERT INTO notification_events
        (id,payload,transaction_json,fingerprint,approval_key,received_at,payment_method_id,billing_kind,cutoff_day,year,month,reason,status,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,'review',?
        WHERE NOT EXISTS (SELECT 1 FROM notification_events WHERE
          (approval_key IS NOT NULL AND approval_key=?) OR
          (fingerprint=? AND (received_at>=? OR status IN ('undone','discarded'))))
        ON CONFLICT DO NOTHING`,
      params: [id, JSON.stringify(input), read.transaction ? JSON.stringify(read.transaction) : null, fingerprint, approvalKey,
        now.valueOf(), method?.id ?? null, billing.billing_kind, billing.cutoff_day, target.year, target.month, reason, createdAt,
        approvalKey, fingerprint, now.valueOf() - DUPLICATE_WINDOW_MS],
    }];
    if (line && read.transaction) {
      statements.push(...await this.ledger.planMonthWrites(target.year, target.month),
        ...await this.saveStatements(id, read.transaction, line, method!.id, false, raw, createdAt, target, billing));
    }
    await this.ledger.store.batch(statements);
    const [saved] = await this.ledger.db.select().from(notificationEvents).where(eq(notificationEvents.id, id));
    if (!saved) return { status: 'duplicate' };
    return saved.status === 'saved' ? { status: 'saved', lineName: saved.line_name ?? undefined } : { status: 'review' };
  }
  private async saveStatements(id: string, transaction: NotificationTransaction, line: MonthLine, methodId: string | null,
    remember: boolean, raw: string, createdAt: string, target: { year: number; month: number }, billing: NotificationBilling): Promise<Statement[]> {
    const [member] = await this.ledger.db.select().from(members).where(eq(members.role, 'owner')).limit(1);
    if (!member) throw new NotificationError('가계부 주인 정보가 없습니다.');
    const entryId = `notification:${id}`;
    const statements: Statement[] = [{
      sql: `INSERT INTO entries (id,month_line_id,amount,source,raw_text,dedupe_key,created_by,created_at)
        SELECT ?,?,?,'notification',?,?,?,? FROM notification_events WHERE id=? AND status='review'
        ON CONFLICT DO NOTHING`,
      params: [entryId, line.id, transaction.amount, raw, entryId, member.id, createdAt, id],
    }];
    if (remember) {
      statements.push({
        sql: `DELETE FROM match_rules WHERE payment_method_id=? AND keyword=?
          AND EXISTS (SELECT 1 FROM notification_events WHERE id=? AND status='review')`,
        params: [methodId, transaction.merchant, id],
      }, {
        sql: `INSERT INTO match_rules (id,payment_method_id,keyword,series_id)
          SELECT ?,?,?,? FROM notification_events WHERE id=? AND status='review'`,
        params: [crypto.randomUUID(), methodId, transaction.merchant, line.series_id, id],
      }, {
        sql: `UPDATE month_lines SET input_mode='card',payment_method_id=?
          WHERE series_id=? AND year*12+month>=? AND input_mode!='fixed'
          AND EXISTS (SELECT 1 FROM notification_events WHERE id=? AND status='review')`,
        params: [methodId, line.series_id, target.year * 12 + target.month, id],
      });
    }
    statements.push({
      sql: `UPDATE notification_events SET status='saved',entry_id=?,line_name=?,transaction_json=?,payment_method_id=?,
        billing_kind=?,cutoff_day=?,year=?,month=?,reason=NULL
        WHERE id=? AND status='review' AND EXISTS (SELECT 1 FROM entries WHERE id=?)`,
      params: [entryId, line.name, JSON.stringify(transaction), methodId, billing.billing_kind, billing.cutoff_day, target.year, target.month, id, entryId],
    });
    return statements;
  }
  async save(id: string, transaction: NotificationTransaction, lineId: string, remember: boolean, paymentMethodId: string | null) {
    transaction = notificationTransactionSchema.parse(transaction);
    const event = await this.event(id);
    if (event.status !== 'review') throw new NotificationError('이미 처리한 알림입니다. 목록을 다시 불러오세요.');
    const methods = await this.ledger.db.select().from(paymentMethods);
    const method = methods.find(m => m.id === paymentMethodId);
    if (paymentMethodId && !method) throw new NotificationError('결제수단을 다시 선택하세요.');
    const billing: NotificationBilling = paymentMethodId === event.payment_method_id ? event : method ?? { billing_kind: 'debit', cutoff_day: 31 };
    const target = notificationMonth(transaction.date, billing);
    const line = (await this.ledger.month(target.year, target.month)).find(l => l.id === lineId);
    if (!line || !['fixed', 'variable'].includes(line.section) || line.series_id.startsWith('special:'))
      throw new NotificationError('청구월의 지출 항목을 선택하세요.');
    if (remember && line.input_mode === 'fixed') throw new NotificationError('매달 같은 금액 항목은 가맹점을 기억할 수 없습니다.');
    if (remember && !method) throw new NotificationError('이 가맹점을 기억하려면 결제수단을 선택하세요.');
    const input = notificationSchema.parse(JSON.parse(event.payload));
    await this.ledger.store.batch([
      ...await this.ledger.planMonthWrites(target.year, target.month),
      ...await this.saveStatements(id, transaction, line, paymentMethodId, remember, notificationRaw(input), this.now().toISOString(), target, billing),
    ]);
    const result = await this.result(id);
    if (result.status !== 'saved') throw new NotificationError('이미 처리한 알림입니다. 목록을 다시 불러오세요.');
    return result;
  }
  async discard(id: string) {
    await this.event(id);
    await this.ledger.store.batch([toStatement(this.ledger.db.update(notificationEvents).set({ status: 'discarded' })
      .where(and(eq(notificationEvents.id, id), eq(notificationEvents.status, 'review'))))]);
    return this.result(id);
  }
  async undo(id: string) {
    await this.event(id);
    await this.ledger.store.batch([
      { sql: `DELETE FROM entries WHERE source='notification' AND id IN
          (SELECT entry_id FROM notification_events WHERE id=? AND status='saved')`, params: [id] },
      { sql: `UPDATE notification_events SET status='undone' WHERE id=? AND status='saved'`, params: [id] },
    ]);
    return this.result(id);
  }
}
export type NotificationList = Awaited<ReturnType<NotificationInbox['list']>>;
export type NotificationView = Awaited<ReturnType<NotificationInbox['result']>>;
