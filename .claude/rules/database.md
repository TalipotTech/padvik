# Database Rules for Padvik

## Primary Keys
- ALWAYS use BIGINT with GENERATED ALWAYS AS IDENTITY
- NEVER use UUID, SERIAL, or application-generated IDs
- Example: `id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY`

## Drizzle ORM
- Use `bigint` mode: `'number'` for IDs in Drizzle schema
- Define schemas in `/src/db/schema/` — one file per domain
- Export all tables from `/src/db/schema/index.ts`
- Use `drizzle-kit` for migrations: `npx drizzle-kit generate` then `npx drizzle-kit migrate`

## Column Conventions
- Timestamps: `TIMESTAMPTZ DEFAULT NOW()` — always use timezone-aware
- Boolean flags: prefix with `is_` (is_active, is_published, is_verified)
- Status enums: use VARCHAR with CHECK constraint, not PostgreSQL ENUM (easier to extend)
- Metadata: use JSONB with DEFAULT '{}' for flexible extension
- Arrays: use PostgreSQL native arrays (TEXT[], BIGINT[]) for simple lists
- Money/scores: use DECIMAL(precision, scale), never FLOAT

## Naming
- Tables: plural snake_case (users, content_items, exam_attempts)
- Columns: singular snake_case (user_id, created_at, review_status)
- Indexes: idx_{table}_{columns} (idx_questions_topic_id)
- Foreign keys: {referenced_table_singular}_id (user_id, board_id, topic_id)

## Queries
- Always use parameterized queries — never string interpolation
- Use Drizzle's query builder for SELECT, raw SQL for complex aggregations
- Add indexes for all foreign keys and commonly filtered columns
- Use EXPLAIN ANALYZE to verify query plans for complex queries
