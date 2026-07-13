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
  estimated_cost INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX idx_ai_document_extractions_user_status ON ai_document_extractions (user_id, status);
CREATE INDEX idx_ai_document_extractions_user_hash ON ai_document_extractions (user_id, file_hash);
