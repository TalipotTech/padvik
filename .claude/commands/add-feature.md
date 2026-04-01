---
description: Add a new feature to Padvik following project conventions
allowed-tools: Read, Edit, Write, Bash
---

Follow these steps to add the feature described below:

1. Read CLAUDE.md and relevant schema files in src/db/schema/
2. Plan the implementation (list files to create/modify)
3. Create/update Drizzle schema if new tables needed (BIGINT PKs only)
4. Generate migration with `pnpm drizzle-kit generate` if schema changed
5. Create API route(s) in src/app/api/
6. Add Zod validation schemas in the route or src/lib/validators.ts
7. Create any needed AI prompts in src/lib/ai/prompts/
8. Update types in src/types/ if needed
9. Run `pnpm build` to verify no TypeScript errors
10. Commit with conventional commit message: feat(scope): description

Feature to add: $ARGUMENTS
