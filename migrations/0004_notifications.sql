-- MacroDroid는 app/title/text만 보낸다. 카드 설정과 청구월은 서버가 관리한다.
ALTER TABLE payment_methods ADD COLUMN notify_app TEXT;
ALTER TABLE payment_methods ADD COLUMN notify_keyword TEXT;
ALTER TABLE payment_methods ADD COLUMN billing_kind TEXT NOT NULL DEFAULT 'debit' CHECK(billing_kind IN ('credit','debit','transfer'));
ALTER TABLE payment_methods ADD COLUMN cutoff_day INTEGER NOT NULL DEFAULT 31 CHECK(cutoff_day BETWEEN 1 AND 31);
UPDATE payment_methods SET billing_kind='transfer' WHERE kind='account';

-- entry 삭제 뒤에도 원문과 중복 방지 흔적을 유지한다. entry_id는 의도적으로 FK가 아니다.
CREATE TABLE notification_events (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  transaction_json TEXT,
  fingerprint TEXT NOT NULL,
  approval_key TEXT,
  received_at INTEGER NOT NULL,
  payment_method_id TEXT,
  billing_kind TEXT NOT NULL CHECK(billing_kind IN ('credit','debit','transfer')),
  cutoff_day INTEGER NOT NULL CHECK(cutoff_day BETWEEN 1 AND 31),
  year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2200),
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('review','saved','undone','discarded')),
  entry_id TEXT,
  line_name TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX notification_approval_unique ON notification_events(approval_key);
CREATE INDEX notification_fingerprint_idx ON notification_events(fingerprint, received_at);
CREATE INDEX notification_status_month_idx ON notification_events(status, year, month);
