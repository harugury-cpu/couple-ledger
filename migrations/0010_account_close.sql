-- 계좌 해지: 해지한 날, 받은 금액, 어디로 보냈는지·어떻게 썼는지 메모. 해지한 달 뒤로는 그 계좌에 적지 않는다.
ALTER TABLE accounts ADD COLUMN closed_on TEXT;
ALTER TABLE accounts ADD COLUMN closed_amount INTEGER;
ALTER TABLE accounts ADD COLUMN closed_note TEXT;
DROP TRIGGER IF EXISTS history_accounts_insert;
CREATE TRIGGER history_accounts_insert AFTER INSERT ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', NULL, json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month, 'closed_on', NEW.closed_on, 'closed_amount', NEW.closed_amount, 'closed_note', NEW.closed_note) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_update;
CREATE TRIGGER history_accounts_update AFTER UPDATE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL AND json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month, 'closed_on', OLD.closed_on, 'closed_amount', OLD.closed_amount, 'closed_note', OLD.closed_note) <> json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month, 'closed_on', NEW.closed_on, 'closed_amount', NEW.closed_amount, 'closed_note', NEW.closed_note) BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month, 'closed_on', OLD.closed_on, 'closed_amount', OLD.closed_amount, 'closed_note', OLD.closed_note), json_object('id', NEW.id, 'name', NEW.name, 'kind', NEW.kind, 'target', NEW.target, 'sort', NEW.sort, 'principal', NEW.principal, 'due_on', NEW.due_on, 'series', NEW.series, 'start_month', NEW.start_month, 'closed_on', NEW.closed_on, 'closed_amount', NEW.closed_amount, 'closed_note', NEW.closed_note) FROM edit_context WHERE slot=1;
END;
DROP TRIGGER IF EXISTS history_accounts_delete;
CREATE TRIGGER history_accounts_delete AFTER DELETE ON accounts WHEN (SELECT operation_id FROM edit_context WHERE slot=1) IS NOT NULL BEGIN
 INSERT INTO edit_changes(operation_id,table_name,before_json,after_json) SELECT operation_id, 'accounts', json_object('id', OLD.id, 'name', OLD.name, 'kind', OLD.kind, 'target', OLD.target, 'sort', OLD.sort, 'principal', OLD.principal, 'due_on', OLD.due_on, 'series', OLD.series, 'start_month', OLD.start_month, 'closed_on', OLD.closed_on, 'closed_amount', OLD.closed_amount, 'closed_note', OLD.closed_note), NULL FROM edit_context WHERE slot=1;
END;
