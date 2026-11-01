-- 셀 병합과 작업별 실행 취소. 트랜잭션 안의 context가 지정된 쓰기만 기록한다.
CREATE TABLE cell_merges (
 id TEXT PRIMARY KEY, year INTEGER NOT NULL, month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
 section TEXT NOT NULL CHECK(section IN ('fixed','variable','saving','income')),
 line_ids TEXT NOT NULL CHECK(json_valid(line_ids)), first_col INTEGER NOT NULL CHECK(first_col BETWEEN 0 AND 7),
 last_col INTEGER NOT NULL CHECK(last_col BETWEEN first_col AND 7)
);
CREATE INDEX cell_merges_month_idx ON cell_merges(year, month);
CREATE TABLE edit_operations (id TEXT PRIMARY KEY, request_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'applied' CHECK(state IN ('applied','undone')), complete INTEGER NOT NULL DEFAULT 0, result_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE edit_context (slot INTEGER PRIMARY KEY CHECK(slot=1), operation_id TEXT);
INSERT INTO edit_context VALUES (1, NULL);
CREATE TABLE edit_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT NOT NULL REFERENCES edit_operations(id) ON DELETE CASCADE, table_name TEXT NOT NULL, before_json TEXT, after_json TEXT);
CREATE INDEX edit_changes_operation_idx ON edit_changes(operation_id, seq);
CREATE TABLE edit_guards (id TEXT PRIMARY KEY, okay INTEGER NOT NULL CHECK(okay=1));

CREATE TRIGGER history_categories_insert AFTER INSERT ON categories WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'categories', NULL, json_object('id', NEW.id, 'name', NEW.name, 'sort', NEW.sort) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_categories_update AFTER UPDATE ON categories WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'sort', OLD.sort) <> json_object('id', NEW.id, 'name', NEW.name, 'sort', NEW.sort) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'categories', json_object('id', OLD.id, 'name', OLD.name, 'sort', OLD.sort), json_object('id', NEW.id, 'name', NEW.name, 'sort', NEW.sort) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_categories_delete AFTER DELETE ON categories WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'categories', json_object('id', OLD.id, 'name', OLD.name, 'sort', OLD.sort), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_payment_methods_insert AFTER INSERT ON payment_methods WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'payment_methods', NULL, json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'owner', NEW.owner, 'notify_app', NEW.notify_app, 'notify_keyword', NEW.notify_keyword, 'billing_kind', NEW.billing_kind, 'cutoff_day', NEW.cutoff_day) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_payment_methods_update AFTER UPDATE ON payment_methods WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'owner', OLD.owner, 'notify_app', OLD.notify_app, 'notify_keyword', OLD.notify_keyword, 'billing_kind', OLD.billing_kind, 'cutoff_day', OLD.cutoff_day) <> json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'owner', NEW.owner, 'notify_app', NEW.notify_app, 'notify_keyword', NEW.notify_keyword, 'billing_kind', NEW.billing_kind, 'cutoff_day', NEW.cutoff_day) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'payment_methods', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'owner', OLD.owner, 'notify_app', OLD.notify_app, 'notify_keyword', OLD.notify_keyword, 'billing_kind', OLD.billing_kind, 'cutoff_day', OLD.cutoff_day), json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'owner', NEW.owner, 'notify_app', NEW.notify_app, 'notify_keyword', NEW.notify_keyword, 'billing_kind', NEW.billing_kind, 'cutoff_day', NEW.cutoff_day) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_payment_methods_delete AFTER DELETE ON payment_methods WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'payment_methods', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'owner', OLD.owner, 'notify_app', OLD.notify_app, 'notify_keyword', OLD.notify_keyword, 'billing_kind', OLD.billing_kind, 'cutoff_day', OLD.cutoff_day), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_month_lines_insert AFTER INSERT ON month_lines WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'month_lines', NULL, json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'section', NEW.section, 'name', NEW.name, 'category_id', NEW.category_id, 'payment_method_id', NEW.payment_method_id, 'pay_day', NEW.pay_day, 'budget', NEW.budget, 'input_mode', NEW.input_mode, 'saving_owner', NEW.saving_owner, 'one_off', NEW.one_off, 'sort', NEW.sort, 'transfer_key', NEW.transfer_key) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_month_lines_update AFTER UPDATE ON month_lines WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'section', OLD.section, 'name', OLD.name, 'category_id', OLD.category_id, 'payment_method_id', OLD.payment_method_id, 'pay_day', OLD.pay_day, 'budget', OLD.budget, 'input_mode', OLD.input_mode, 'saving_owner', OLD.saving_owner, 'one_off', OLD.one_off, 'sort', OLD.sort, 'transfer_key', OLD.transfer_key) <> json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'section', NEW.section, 'name', NEW.name, 'category_id', NEW.category_id, 'payment_method_id', NEW.payment_method_id, 'pay_day', NEW.pay_day, 'budget', NEW.budget, 'input_mode', NEW.input_mode, 'saving_owner', NEW.saving_owner, 'one_off', NEW.one_off, 'sort', NEW.sort, 'transfer_key', NEW.transfer_key) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'month_lines', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'section', OLD.section, 'name', OLD.name, 'category_id', OLD.category_id, 'payment_method_id', OLD.payment_method_id, 'pay_day', OLD.pay_day, 'budget', OLD.budget, 'input_mode', OLD.input_mode, 'saving_owner', OLD.saving_owner, 'one_off', OLD.one_off, 'sort', OLD.sort, 'transfer_key', OLD.transfer_key), json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'section', NEW.section, 'name', NEW.name, 'category_id', NEW.category_id, 'payment_method_id', NEW.payment_method_id, 'pay_day', NEW.pay_day, 'budget', NEW.budget, 'input_mode', NEW.input_mode, 'saving_owner', NEW.saving_owner, 'one_off', NEW.one_off, 'sort', NEW.sort, 'transfer_key', NEW.transfer_key) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_month_lines_delete AFTER DELETE ON month_lines WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'month_lines', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'section', OLD.section, 'name', OLD.name, 'category_id', OLD.category_id, 'payment_method_id', OLD.payment_method_id, 'pay_day', OLD.pay_day, 'budget', OLD.budget, 'input_mode', OLD.input_mode, 'saving_owner', OLD.saving_owner, 'one_off', OLD.one_off, 'sort', OLD.sort, 'transfer_key', OLD.transfer_key), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_entries_insert AFTER INSERT ON entries WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'entries', NULL, json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'source', NEW.source, 'raw_text', NEW.raw_text, 'dedupe_key', NEW.dedupe_key, 'created_by', NEW.created_by, 'created_at', NEW.created_at) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_entries_update AFTER UPDATE ON entries WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'source', OLD.source, 'raw_text', OLD.raw_text, 'dedupe_key', OLD.dedupe_key, 'created_by', OLD.created_by, 'created_at', OLD.created_at) <> json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'source', NEW.source, 'raw_text', NEW.raw_text, 'dedupe_key', NEW.dedupe_key, 'created_by', NEW.created_by, 'created_at', NEW.created_at) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'entries', json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'source', OLD.source, 'raw_text', OLD.raw_text, 'dedupe_key', OLD.dedupe_key, 'created_by', OLD.created_by, 'created_at', OLD.created_at), json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'source', NEW.source, 'raw_text', NEW.raw_text, 'dedupe_key', NEW.dedupe_key, 'created_by', NEW.created_by, 'created_at', NEW.created_at) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_entries_delete AFTER DELETE ON entries WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'entries', json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'source', OLD.source, 'raw_text', OLD.raw_text, 'dedupe_key', OLD.dedupe_key, 'created_by', OLD.created_by, 'created_at', OLD.created_at), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_budget_adjustments_insert AFTER INSERT ON budget_adjustments WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'budget_adjustments', NULL, json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'special_expense_id', NEW.special_expense_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_budget_adjustments_update AFTER UPDATE ON budget_adjustments WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'special_expense_id', OLD.special_expense_id) <> json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'special_expense_id', NEW.special_expense_id) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'budget_adjustments', json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'special_expense_id', OLD.special_expense_id), json_object('id', NEW.id, 'month_line_id', NEW.month_line_id, 'amount', NEW.amount, 'special_expense_id', NEW.special_expense_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_budget_adjustments_delete AFTER DELETE ON budget_adjustments WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'budget_adjustments', json_object('id', OLD.id, 'month_line_id', OLD.month_line_id, 'amount', OLD.amount, 'special_expense_id', OLD.special_expense_id), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_special_expenses_insert AFTER INSERT ON special_expenses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'special_expenses', NULL, json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'name', NEW.name, 'amount', NEW.amount, 'funding', NEW.funding, 'from_line_id', NEW.from_line_id, 'calendar_event_id', NEW.calendar_event_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_special_expenses_update AFTER UPDATE ON special_expenses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'name', OLD.name, 'amount', OLD.amount, 'funding', OLD.funding, 'from_line_id', OLD.from_line_id, 'calendar_event_id', OLD.calendar_event_id) <> json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'name', NEW.name, 'amount', NEW.amount, 'funding', NEW.funding, 'from_line_id', NEW.from_line_id, 'calendar_event_id', NEW.calendar_event_id) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'special_expenses', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'name', OLD.name, 'amount', OLD.amount, 'funding', OLD.funding, 'from_line_id', OLD.from_line_id, 'calendar_event_id', OLD.calendar_event_id), json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'name', NEW.name, 'amount', NEW.amount, 'funding', NEW.funding, 'from_line_id', NEW.from_line_id, 'calendar_event_id', NEW.calendar_event_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_special_expenses_delete AFTER DELETE ON special_expenses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'special_expenses', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'name', OLD.name, 'amount', OLD.amount, 'funding', OLD.funding, 'from_line_id', OLD.from_line_id, 'calendar_event_id', OLD.calendar_event_id), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_years_insert AFTER INSERT ON saving_years WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_years', NULL, json_object('year', NEW.year, 'opening_balance', NEW.opening_balance) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_years_update AFTER UPDATE ON saving_years WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('year', OLD.year, 'opening_balance', OLD.opening_balance) <> json_object('year', NEW.year, 'opening_balance', NEW.opening_balance) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_years', json_object('year', OLD.year, 'opening_balance', OLD.opening_balance), json_object('year', NEW.year, 'opening_balance', NEW.opening_balance) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_years_delete AFTER DELETE ON saving_years WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_years', json_object('year', OLD.year, 'opening_balance', OLD.opening_balance), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_uses_insert AFTER INSERT ON saving_uses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_uses', NULL, json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'memo', NEW.memo, 'special_expense_id', NEW.special_expense_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_uses_update AFTER UPDATE ON saving_uses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'memo', OLD.memo, 'special_expense_id', OLD.special_expense_id) <> json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'memo', NEW.memo, 'special_expense_id', NEW.special_expense_id) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_uses', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'memo', OLD.memo, 'special_expense_id', OLD.special_expense_id), json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'memo', NEW.memo, 'special_expense_id', NEW.special_expense_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_saving_uses_delete AFTER DELETE ON saving_uses WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'saving_uses', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'memo', OLD.memo, 'special_expense_id', OLD.special_expense_id), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_match_rules_insert AFTER INSERT ON match_rules WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'match_rules', NULL, json_object('id', NEW.id, 'payment_method_id', NEW.payment_method_id, 'keyword', NEW.keyword, 'series_id', NEW.series_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_match_rules_update AFTER UPDATE ON match_rules WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'payment_method_id', OLD.payment_method_id, 'keyword', OLD.keyword, 'series_id', OLD.series_id) <> json_object('id', NEW.id, 'payment_method_id', NEW.payment_method_id, 'keyword', NEW.keyword, 'series_id', NEW.series_id) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'match_rules', json_object('id', OLD.id, 'payment_method_id', OLD.payment_method_id, 'keyword', OLD.keyword, 'series_id', OLD.series_id), json_object('id', NEW.id, 'payment_method_id', NEW.payment_method_id, 'keyword', NEW.keyword, 'series_id', NEW.series_id) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_match_rules_delete AFTER DELETE ON match_rules WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'match_rules', json_object('id', OLD.id, 'payment_method_id', OLD.payment_method_id, 'keyword', OLD.keyword, 'series_id', OLD.series_id), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_ledger_months_insert AFTER INSERT ON ledger_months WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'ledger_months', NULL, json_object('year', NEW.year, 'month', NEW.month, 'special_prompt_seen', NEW.special_prompt_seen, 'auto_filled', NEW.auto_filled) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_ledger_months_update AFTER UPDATE ON ledger_months WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('year', OLD.year, 'month', OLD.month, 'special_prompt_seen', OLD.special_prompt_seen, 'auto_filled', OLD.auto_filled) <> json_object('year', NEW.year, 'month', NEW.month, 'special_prompt_seen', NEW.special_prompt_seen, 'auto_filled', NEW.auto_filled) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'ledger_months', json_object('year', OLD.year, 'month', OLD.month, 'special_prompt_seen', OLD.special_prompt_seen, 'auto_filled', OLD.auto_filled), json_object('year', NEW.year, 'month', NEW.month, 'special_prompt_seen', NEW.special_prompt_seen, 'auto_filled', NEW.auto_filled) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_ledger_months_delete AFTER DELETE ON ledger_months WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'ledger_months', json_object('year', OLD.year, 'month', OLD.month, 'special_prompt_seen', OLD.special_prompt_seen, 'auto_filled', OLD.auto_filled), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_transfers_insert AFTER INSERT ON transfers WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'transfers', NULL, json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'account', NEW.account, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_transfers_update AFTER UPDATE ON transfers WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'account', OLD.account, 'amount', OLD.amount) <> json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'account', NEW.account, 'amount', NEW.amount) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'transfers', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'account', OLD.account, 'amount', OLD.amount), json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'series_id', NEW.series_id, 'account', NEW.account, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_transfers_delete AFTER DELETE ON transfers WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'transfers', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'series_id', OLD.series_id, 'account', OLD.account, 'amount', OLD.amount), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_accounts_insert AFTER INSERT ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', NULL, json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_accounts_update AFTER UPDATE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort) <> json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort), json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_accounts_delete AFTER DELETE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_account_balances_insert AFTER INSERT ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', NULL, json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_account_balances_update AFTER UPDATE ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount) <> json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount), json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_account_balances_delete AFTER DELETE ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount), NULL FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_cell_merges_insert AFTER INSERT ON cell_merges WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'cell_merges', NULL, json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'section', NEW.section, 'line_ids', NEW.line_ids, 'first_col', NEW.first_col, 'last_col', NEW.last_col) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_cell_merges_update AFTER UPDATE ON cell_merges WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'section', OLD.section, 'line_ids', OLD.line_ids, 'first_col', OLD.first_col, 'last_col', OLD.last_col) <> json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'section', NEW.section, 'line_ids', NEW.line_ids, 'first_col', NEW.first_col, 'last_col', NEW.last_col) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'cell_merges', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'section', OLD.section, 'line_ids', OLD.line_ids, 'first_col', OLD.first_col, 'last_col', OLD.last_col), json_object('id', NEW.id, 'year', NEW.year, 'month', NEW.month, 'section', NEW.section, 'line_ids', NEW.line_ids, 'first_col', NEW.first_col, 'last_col', NEW.last_col) FROM edit_context WHERE slot=1;
END;

CREATE TRIGGER history_cell_merges_delete AFTER DELETE ON cell_merges WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'cell_merges', json_object('id', OLD.id, 'year', OLD.year, 'month', OLD.month, 'section', OLD.section, 'line_ids', OLD.line_ids, 'first_col', OLD.first_col, 'last_col', OLD.last_col), NULL FROM edit_context WHERE slot=1;
END;
