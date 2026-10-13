-- 0005: 저축 명의 키를 a, b로 맞춘다.
-- 이미 a, b, extra인 값은 그대로 둔다. 그 외 키는 사전순으로 p 앞이면 b, 아니면 a로 옮긴다.
-- 참조가 켜져 있으면 부모 표를 바로 지우면 자식 행이 따라 지워지므로, 자식 행을 먼저 빼 두고 표를 다시 만든다.

PRAGMA defer_foreign_keys = on;

CREATE TABLE month_lines_new (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2200),
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  series_id TEXT NOT NULL,
  section TEXT NOT NULL CHECK(section IN ('fixed','variable','saving','income')),
  name TEXT NOT NULL,
  category_id TEXT REFERENCES categories(id),
  payment_method_id TEXT REFERENCES payment_methods(id),
  pay_day INTEGER CHECK(pay_day BETWEEN 1 AND 31),
  budget INTEGER NOT NULL CHECK(budget >= 0),
  input_mode TEXT NOT NULL CHECK(input_mode IN ('card','fixed','manual')),
  saving_owner TEXT CHECK(saving_owner IN ('a','b','extra')),
  one_off INTEGER NOT NULL CHECK(one_off IN (0,1)),
  sort INTEGER NOT NULL,
  transfer_key TEXT,
  UNIQUE(year, month, series_id)
);

INSERT INTO month_lines_new (id, year, month, series_id, section, name, category_id, payment_method_id, pay_day, budget, input_mode, saving_owner, one_off, sort, transfer_key)
SELECT id, year, month, series_id, section, name, category_id, payment_method_id, pay_day, budget, input_mode,
  CASE
    WHEN saving_owner IS NULL OR saving_owner IN ('a', 'b', 'extra') THEN saving_owner
    WHEN saving_owner < 'p' THEN 'b'
    ELSE 'a'
  END,
  one_off, sort, transfer_key
FROM month_lines;

CREATE TABLE entries_keep (
  id TEXT PRIMARY KEY,
  month_line_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL,
  raw_text TEXT,
  dedupe_key TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO entries_keep (id, month_line_id, amount, source, raw_text, dedupe_key, created_by, created_at)
SELECT id, month_line_id, amount, source, raw_text, dedupe_key, created_by, created_at FROM entries;

CREATE TABLE special_expenses_keep (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  funding TEXT NOT NULL,
  from_line_id TEXT,
  calendar_event_id TEXT
);
INSERT INTO special_expenses_keep (id, year, month, name, amount, funding, from_line_id, calendar_event_id)
SELECT id, year, month, name, amount, funding, from_line_id, calendar_event_id FROM special_expenses;

CREATE TABLE budget_adjustments_keep (
  id TEXT PRIMARY KEY,
  month_line_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  special_expense_id TEXT
);
INSERT INTO budget_adjustments_keep (id, month_line_id, amount, special_expense_id)
SELECT id, month_line_id, amount, special_expense_id FROM budget_adjustments;

CREATE TABLE saving_uses_keep (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  memo TEXT NOT NULL,
  special_expense_id TEXT
);
INSERT INTO saving_uses_keep (id, year, month, amount, memo, special_expense_id)
SELECT id, year, month, amount, memo, special_expense_id FROM saving_uses;

DROP TABLE budget_adjustments;
DROP TABLE saving_uses;
DROP TABLE special_expenses;
DROP TABLE entries;
DROP TABLE month_lines;
ALTER TABLE month_lines_new RENAME TO month_lines;

CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','quick','auto','paste','notification','capture')),
  raw_text TEXT,
  dedupe_key TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);
INSERT INTO entries (id, month_line_id, amount, source, raw_text, dedupe_key, created_by, created_at)
SELECT id, month_line_id, amount, source, raw_text, dedupe_key, created_by, created_at FROM entries_keep;
CREATE INDEX entries_line_idx ON entries(month_line_id);
CREATE UNIQUE INDEX entries_dedupe_unique ON entries(dedupe_key);

CREATE TABLE special_expenses (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  funding TEXT NOT NULL CHECK(funding IN ('line','saving')),
  from_line_id TEXT REFERENCES month_lines(id),
  calendar_event_id TEXT
);
INSERT INTO special_expenses (id, year, month, name, amount, funding, from_line_id, calendar_event_id)
SELECT id, year, month, name, amount, funding, from_line_id, calendar_event_id FROM special_expenses_keep;

CREATE TABLE budget_adjustments (
  id TEXT PRIMARY KEY,
  month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE
);
INSERT INTO budget_adjustments (id, month_line_id, amount, special_expense_id)
SELECT id, month_line_id, amount, special_expense_id FROM budget_adjustments_keep;
CREATE INDEX adjustments_line_idx ON budget_adjustments(month_line_id);

CREATE TABLE saving_uses (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  amount INTEGER NOT NULL CHECK(amount >= 0),
  memo TEXT NOT NULL,
  special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE
);
INSERT INTO saving_uses (id, year, month, amount, memo, special_expense_id)
SELECT id, year, month, amount, memo, special_expense_id FROM saving_uses_keep;

DROP TABLE entries_keep;
DROP TABLE special_expenses_keep;
DROP TABLE budget_adjustments_keep;
DROP TABLE saving_uses_keep;

PRAGMA defer_foreign_keys = off;
