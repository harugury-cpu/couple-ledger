-- 직접 입력 계좌의 달별 입금(월별 표에 없는 돈, 예: 다른 사람이 매달 보내 주는 돈). 적은 달 값이 뒤 달로 이어지는 것은 화면 계산이 맡는다.
CREATE TABLE IF NOT EXISTS account_deposits (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, year INTEGER NOT NULL CHECK(year BETWEEN 1900 AND 2200), month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12), amount INTEGER NOT NULL, UNIQUE(account_id,year,month));
CREATE TRIGGER history_account_deposits_insert AFTER INSERT ON account_deposits WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_deposits', NULL, json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;
CREATE TRIGGER history_account_deposits_update AFTER UPDATE ON account_deposits WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount) <> json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_deposits', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount), json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount) FROM edit_context WHERE slot=1;
END;
CREATE TRIGGER history_account_deposits_delete AFTER DELETE ON account_deposits WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_deposits', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount), NULL FROM edit_context WHERE slot=1;
END;
