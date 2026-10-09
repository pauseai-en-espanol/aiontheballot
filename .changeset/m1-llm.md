---
'@aiontheballot/migrations': minor
---

Add the LLM assistance schema (the feature is M4): `llm_runs`, refused once the tenant's monthly cap is reached (a cap
of 0 turns it off) and moving queued → running → done or failed; and `llm_suggestions`, with a rating of the tenant's
scale, accepted or rejected once by an editor.
