-- 자산 계좌의 기록 시작 달(YYYY-MM). 시작 원금은 이 달 전까지 넣은 원금이고, 이 달부터 연결한 저축 줄 금액을 더한다. 비어 있으면 처음부터 센다.
ALTER TABLE accounts ADD COLUMN start_month TEXT;
DROP TRIGGER IF EXISTS history_accounts_insert;
CREATE TRIGGER history_accounts_insert AFTER INSERT ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', NULL, json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_update;
CREATE TRIGGER history_accounts_update AFTER UPDATE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month) <> json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month), json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_delete;
CREATE TRIGGER history_accounts_delete AFTER DELETE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month), NULL FROM edit_context WHERE slot=1;
END;
