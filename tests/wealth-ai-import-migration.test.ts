import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function sqlite(db: string, sql: string) {
  return execFileSync('sqlite3', [db], { input: sql, encoding: 'utf8' });
}

const migrations = ['db/migrations/0001_init.sql','db/migrations/0002_balance_history.sql','db/migrations/0003_movements.sql','db/migrations/0004_drop_legacy_ledgers.sql','db/migrations/0005_extend_portfolios_for_investment_accounts.sql','db/migrations/0006_investment_assets.sql','db/migrations/0007_investment_transactions.sql','db/migrations/0008_investment_prices.sql','db/migrations/0009_wealth_imports.sql','db/migrations/0010_link_wealth_imports.sql','db/migrations/0011_net_worth_snapshot_breakdown.sql','db/migrations/0012_ai_document_extractions.sql','db/migrations/0013_ai_extraction_status_fields.sql'];

describe('AI document extraction migration 0013', () => {
  it('applies after 0012 and exposes every route status column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kotecash-ai-migration-'));
    const db = join(dir, 'test.sqlite');
    try {
      for (const migration of migrations) sqlite(db, readFileSync(migration, 'utf8'));
      const columns = sqlite(db, "PRAGMA table_info(ai_document_extractions);");
      for (const name of ['error_code','error_message','processing_started_at','completed_at','retry_count','last_error_at','updated_at','status']) {
        expect(columns).toContain(`|${name}|`);
      }
      sqlite(db, `INSERT INTO users (id,email,password_hash) VALUES (1,'u@example.com','x');`);
      sqlite(db, `INSERT INTO ai_document_extractions (user_id,file_name,file_hash,document_type_requested,status,schema_version,prompt_version,processing_started_at) VALUES (1,'a.pdf','hash','unknown','processing','v','p',datetime('now','-10 minutes'));`);
      sqlite(db, `UPDATE ai_document_extractions SET status='failed', error_code='stale_processing', error_message='stale', last_error_at=datetime('now'), updated_at=datetime('now') WHERE user_id=1 AND status='processing' AND datetime(COALESCE(processing_started_at,updated_at,created_at)) <= datetime('now','-5 minutes');`);
      const row = sqlite(db, `SELECT status,error_code,retry_count FROM ai_document_extractions WHERE id=1;`).trim();
      expect(row).toBe('failed|stale_processing|0');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
