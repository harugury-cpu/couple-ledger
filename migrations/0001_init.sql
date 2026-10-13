-- 0001: 처음 표 구조 (기존 src/db/migration.ts와 같은 내용)
-- 로컬은 src/db/store-libsql.ts의 실행기가, 배포는 `wrangler d1 migrations apply`가 적용한다.

CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')));

CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, email TEXT NOT NULL, token TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT);

CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS payment_methods (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('card','account')), owner TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS month_lines (id TEXT PRIMARY KEY, year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2200), month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), series_id TEXT NOT NULL, section TEXT NOT NULL CHECK(section IN ('fixed','variable','saving','income')), name TEXT NOT NULL, category_id TEXT REFERENCES categories(id), payment_method_id TEXT REFERENCES payment_methods(id), pay_day INTEGER CHECK(pay_day BETWEEN 1 AND 31), budget INTEGER NOT NULL CHECK(budget >= 0), input_mode TEXT NOT NULL CHECK(input_mode IN ('card','fixed','manual')), saving_owner TEXT CHECK(saving_owner IN ('a','b','extra')), one_off INTEGER NOT NULL CHECK(one_off IN (0,1)), sort INTEGER NOT NULL, transfer_key TEXT, UNIQUE(year,month,series_id));

CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), series_id TEXT NOT NULL, account TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount >= 0), UNIQUE(year,month,series_id));

CREATE TABLE IF NOT EXISTS special_expenses (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount > 0), funding TEXT NOT NULL CHECK(funding IN ('line','saving')), from_line_id TEXT REFERENCES month_lines(id), calendar_event_id TEXT);

CREATE TABLE IF NOT EXISTS budget_adjustments (id TEXT PRIMARY KEY, month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE, amount INTEGER NOT NULL, special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE, amount INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('manual','quick','auto','paste','notification')), raw_text TEXT, created_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS saving_years (year INTEGER PRIMARY KEY, opening_balance INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS saving_uses (id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), amount INTEGER NOT NULL CHECK(amount >= 0), memo TEXT NOT NULL, special_expense_id TEXT REFERENCES special_expenses(id) ON DELETE CASCADE);

CREATE TABLE IF NOT EXISTS match_rules (id TEXT PRIMARY KEY, payment_method_id TEXT NOT NULL REFERENCES payment_methods(id), keyword TEXT, series_id TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ledger_months (year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), special_prompt_seen INTEGER NOT NULL DEFAULT 0, UNIQUE(year,month));

CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('ready','reserved','invest')), target INTEGER CHECK(target IS NULL OR target >= 0), sort INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS account_balances (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2200), month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), amount INTEGER NOT NULL, UNIQUE(account_id,year,month));

CREATE INDEX IF NOT EXISTS entries_line_idx ON entries(month_line_id);

CREATE INDEX IF NOT EXISTS adjustments_line_idx ON budget_adjustments(month_line_id);
