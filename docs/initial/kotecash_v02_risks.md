# Risk Register — kotecash v0.2

Source context: Revisi dari v0.1 (kot, 2026-06-21)
Source spec: `kotecash_v02_spec.md`
Generated: 2026-06-21

## 1. Technical Risks

### RISK-1: D1 cold start latency on first request
- **Description:** Cloudflare D1 has a cold start penalty (50-200ms per query after idle), which could push health metrics and dashboard aggregation queries past the 500ms NFR.
- **Category:** Technical
- **Likelihood:** High
- **Impact:** Medium
- **Severity:** High
- **Mitigation:** Periodic warm-up cron (every 5 min); consolidate dashboard into single endpoint; client-side loading skeletons.
- **Owner:** Dev

### RISK-2: D1 concurrent query limits on dashboard load
- **Description:** Dashboard now loads more queries (health metrics, cicilan summary, 50/30/20, net worth, variance) — D1 free tier limits concurrency.
- **Category:** Technical
- **Likelihood:** Medium
- **Impact:** High
- **Severity:** High
- **Mitigation:** Single `/api/dashboard` endpoint; cache health metrics in memory for 5 min; KV cache dashboard response.
- **Owner:** Dev

### RISK-3: API token leakage via logs/error messages (unchanged)
- **Category:** Technical | **Likelihood:** Low | **Impact:** High | **Severity:** Medium
- **Mitigation:** Redact Authorization header from all logs; never include token in error responses.

### RISK-4: D1 storage quota exceeded over time (unchanged)
- **Category:** Technical | **Likelihood:** Low | **Impact:** Medium | **Severity:** Low
- **Mitigation:** ~100 tx/month × 100 bytes → decades of headroom. Storage indicator on dashboard.

### RISK-5: Chart.js performance on large datasets (NEW)
- **Description:** Net worth line chart and spending trend over 5+ years could degrade Chart.js rendering performance on mobile.
- **Category:** Technical
- **Likelihood:** Low
- **Impact:** Low
- **Severity:** Low
- **Mitigation:** Aggregate data server-side, max 50 data points per chart; use Chart.js decimation plugin; lazy-load charts below fold.

### RISK-6: CSV import parsing failures (NEW)
- **Description:** Indonesian bank CSV exports vary wildly in format, encoding, and column names. Parsing could fail silently, creating garbage transactions.
- **Category:** Technical
- **Likelihood:** High
- **Impact:** Medium
- **Severity:** High
- **Mitigation:** Preview-first workflow (show parsed rows before import); support BCA, Mandiri, BRI presets; auto-detect encoding (UTF-8/Latin-1); allow manual column mapping fallback; require user confirmation before final import.

### RISK-7: What-If scenario logic inconsistency (NEW)
- **Description:** Scenario calculations might diverge from actual metrics formula, giving misleading projections.
- **Category:** Technical
- **Likelihood:** Medium
- **Impact:** Medium
- **Severity:** Medium
- **Mitigation:** Scenario engine reuses the same health calculation functions as live dashboard; unit test both paths; show formula used in scenario description.

## 2. Business Risks

### RISK-8: Low motivation to maintain data entry habit (unchanged, severity increased)
- **Description:** If recording every transaction becomes tedious, the user stops logging, rendering all modules useless. With more features (cicilan, net worth, health), the value proposition is stronger, but also requires MORE data entry.
- **Category:** Business
- **Likelihood:** Medium
- **Impact:** High
- **Severity:** High
- **Mitigation:** Minimize friction — quick-add, CSV import, AI agent API, mobile PWA. **New:** weekly summary notification (Telegram) with health score to reinforce habit. Cicilan auto-decrement on linked transactions reduces manual updates.

### RISK-9: Feature creep slowing initial delivery (unchanged)
- **Description:** v0.2 adds 5 new modules — if all are built before launch, the first usable version is delayed. User has no tool in the meantime.
- **Category:** Business
- **Likelihood:** High
- **Impact:** Medium
- **Severity:** High
- **Mitigation:** **Phased delivery:**
  - **Phase 1 (MVP):** Auth + Transaction + Category + Dashboard basic → 1 week, usable immediately
  - **Phase 2:** Budget + Stats + Cicilan → +1 week
  - **Phase 3:** Health + Net Worth + CSV + AI Assistant → +1 week
  - **Phase 4:** What-If + Share + Polish → +1 week
  - Each phase delivers working, deployable software.

### RISK-13: AI agent token misuse or prompt injection (NEW)
- **Description:** If AI agent prompt is manipulated (jailbroken), the agent could be tricked into deleting transactions, modifying budgets, or exfiltrating financial data via the API. Since tokens carry full authorization, a compromised agent has full account access.
- **Category:** Security
- **Likelihood:** Low
- **Impact:** High
- **Severity:** High
- **Mitigation:** Token can be revoked instantly from kotecash UI; token shown only once, can't be retrieved; AI agents should use dedicated token (not user session); add optional IP restriction on token creation; audit log of all API operations per token.

## 3. Schedule Risks

### RISK-10: Cloudflare API/configuration complexity delays deployment (unchanged)
- **Category:** Schedule | **Likelihood:** Medium | **Impact:** Low | **Severity:** Low
- **Mitigation:** Start with skeleton; iterate; use wrangler templates.

## 4. Dependency Risks

### RISK-11: D1 breaking changes (unchanged)
- **Category:** Dependency | **Likelihood:** Low | **Impact:** High | **Severity:** Medium
- **Mitigation:** Abstract DB layer; keep Turso migration path documented.

### RISK-12: Free tier limits reached (unchanged, impact increased)
- **Category:** Dependency | **Likelihood:** Medium | **Impact:** Medium | **Severity:** Medium
- **Mitigation:** CSV import + AI agent traffic could push past 100k/day. Add request monitoring dashboard. Workers Paid is $5/mo if needed.

## 5. Summary

| Risk ID | Title | Category | Severity | Owner |
|---|---|---|---|---|
| RISK-1 | D1 cold start latency | Technical | High | Dev |
| RISK-2 | D1 concurrent query limits | Technical | High | Dev |
| RISK-6 | CSV import parsing failures | Technical | High | Dev |
| RISK-8 | Low data entry motivation | Business | High | Client |
| RISK-9 | Feature creep slowing delivery | Business | High | PM |
| RISK-13 | AI agent token misuse (NEW) | Security | High | Dev |
| RISK-3 | API token leakage | Technical | Medium | Dev |
| RISK-7 | What-If logic inconsistency | Technical | Medium | Dev |
| RISK-11 | D1 breaking changes | Dependency | Medium | Dev |
| RISK-12 | Free tier limits | Dependency | Medium | Dev |
| RISK-4 | D1 storage quota | Technical | Low | Dev |
| RISK-5 | Chart.js performance | Technical | Low | Dev |
| RISK-10 | Cloudflare config complexity | Schedule | Low | Dev |

**Critical:** 0 | **High:** 6 | **Medium:** 4 | **Low:** 3

### Key change from v0.1:
- +3 new risks (CSV parsing, What-If logic, Feature creep)
- RISK-8 (motivation) severity increased due to more data entry needs
- New mitigation: **phased delivery** to address feature creep (RISK-9)
