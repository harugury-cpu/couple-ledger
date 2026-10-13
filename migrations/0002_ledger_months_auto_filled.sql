-- 0002: 달마다 "매달 같은 금액" 줄의 자동 금액을 넣었는지 기록한다.
-- 앞으로 올 달을 미리 만들면 0으로 두고, 그 달이 되어 처음 고칠 때 자동 금액을 넣고 1로 바꾼다.
-- 이미 있는 달은 예전 방식대로 만들 때 채워졌으므로 1로 둔다.
ALTER TABLE ledger_months ADD COLUMN auto_filled INTEGER NOT NULL DEFAULT 1;
