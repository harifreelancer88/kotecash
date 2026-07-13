-- Rebuild ai_document_extractions with the full status/error tracking schema.
-- Production had already applied an earlier 0012 shape, so this migration is
-- forward-only and does not assume optional error/status columns exist.
PRAGMA foreign_keys=off;

ALTER TABLE ai_document_extractions RENAME TO ai_document_extractions_0013_old;

CREATE TABLE ai_document_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  document_type_requested TEXT,
  document_type_detected TEXT,
  status TEXT NOT NULL CHECK (status IN ('processing','extracted','validation_failed','ready_for_import','imported','failed','deleted')),
  model TEXT,
  response_id TEXT,
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  extracted_json TEXT,
  validation_json TEXT,
  usage_json TEXT,
  error_code TEXT,
  error_message TEXT,
  processing_started_at TEXT,
  completed_at TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error_at TEXT,
  estimated_cost INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

INSERT INTO ai_document_extractions (
  id,user_id,file_name,file_hash,document_type_requested,document_type_detected,
  status,model,response_id,schema_version,prompt_version,extracted_json,
  validation_json,usage_json,estimated_cost,created_at,updated_at,deleted_at
)
SELECT
  id,user_id,file_name,file_hash,document_type_requested,document_type_detected,
  status,model,response_id,schema_version,prompt_version,extracted_json,
  validation_json,usage_json,estimated_cost,created_at,updated_at,deleted_at
FROM ai_document_extractions_0013_old;

DROP TABLE ai_document_extractions_0013_old;

CREATE INDEX idx_ai_document_extractions_user_status ON ai_document_extractions (user_id, status);
CREATE INDEX idx_ai_document_extractions_user_hash ON ai_document_extractions (user_id, file_hash);

PRAGMA foreign_keys=on;
