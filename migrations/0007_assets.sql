-- 자산 탭: 계좌에 시작 원금(묶인 돈은 금액)·돌려받는 날·연결한 저축 줄(series id JSON 배열), 평가금액에 확인한 날을 둔다.
-- 계좌 종류 값은 그대로 쓰고 뜻만 바꾼다: ready=저축(평가금액=원금), invest=투자(평가금액을 적음), reserved=묶인 돈.
ALTER TABLE accounts ADD COLUMN principal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN due_on TEXT;
ALTER TABLE accounts ADD COLUMN series TEXT NOT NULL DEFAULT '[]';
ALTER TABLE account_balances ADD COLUMN checked_on TEXT;
-- 실행 취소 기록 트리거가 새 열까지 담도록 다시 만든다.
DROP TRIGGER IF EXISTS history_accounts_insert;
CREATE TRIGGER history_accounts_insert AFTER INSERT ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', NULL, json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_update;
CREATE TRIGGER history_accounts_update AFTER UPDATE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series) <> json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series), json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_delete;
CREATE TRIGGER history_accounts_delete AFTER DELETE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series), NULL FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_account_balances_insert;
CREATE TRIGGER history_account_balances_insert AFTER INSERT ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', NULL, json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'checked_on', NEW.checked_on) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_account_balances_update;
CREATE TRIGGER history_account_balances_update AFTER UPDATE ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'checked_on', OLD.checked_on) <> json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'checked_on', NEW.checked_on) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'checked_on', OLD.checked_on), json_object('id', NEW.id, 'account_id', NEW.account_id, 'year', NEW.year, 'month', NEW.month, 'amount', NEW.amount, 'checked_on', NEW.checked_on) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_account_balances_delete;
CREATE TRIGGER history_account_balances_delete AFTER DELETE ON account_balances WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'account_balances', json_object('id', OLD.id, 'account_id', OLD.account_id, 'year', OLD.year, 'month', OLD.month, 'amount', OLD.amount, 'checked_on', OLD.checked_on), NULL FROM edit_context WHERE slot=1;
END;
