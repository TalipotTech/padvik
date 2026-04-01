---
applyTo: "src/db/**/*"
---
# Database Rules

- All PKs: `bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity()`
- Foreign keys: `bigint` with `.references()` and `{ onDelete: 'cascade' }`
- Timestamps: `timestamp('created_at', { withTimezone: true }).defaultNow().notNull()`
- Metadata: `jsonb('metadata').default({})`
- Status columns: `varchar` with explicit length, not PostgreSQL ENUM
- Booleans: prefix with `is_` (is_active, is_published)
- Scores/money: `decimal` with precision, never float
- Queries: always parameterized, always add LIMIT (default 50, max 100)
- Derive types from schema with `InferSelectModel` and `InferInsertModel`
