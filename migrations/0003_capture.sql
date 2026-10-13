-- 0003: 명세서 캡처 입력과 중복 방지
-- SQLite CHECK/FK 열을 바꾸기 위해 관련 표를 새로 만들어 옮긴다.

CREATE TABLE entries_new (
  id TEXT PRIMARY KEY,
  month_line_id TEXT NOT NULL REFERENCES month_lines(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('manual','quick','auto','paste','notification','capture')),
  raw_text TEXT,
  dedupe_key TEXT,
  created_by TEXT NOT NULL REFERENCES members(id),
  created_at TEXT NOT NULL
);

INSERT INTO entries_new (id, month_line_id, amount, source, raw_text, created_by, created_at)
SELECT id, month_line_id, amount, source, raw_text, created_by, created_at FROM entries;

DROP TABLE entries;
ALTER TABLE entries_new RENAME TO entries;
CREATE INDEX entries_line_idx ON entries(month_line_id);
CREATE UNIQUE INDEX entries_dedupe_unique ON entries(dedupe_key);

CREATE TABLE match_rules_new (
  id TEXT PRIMARY KEY,
  payment_method_id TEXT REFERENCES payment_methods(id),
  keyword TEXT,
  series_id TEXT NOT NULL
);

INSERT INTO match_rules_new (id, payment_method_id, keyword, series_id)
SELECT id, payment_method_id, keyword, series_id FROM match_rules;

DROP TABLE match_rules;
ALTER TABLE match_rules_new RENAME TO match_rules;
