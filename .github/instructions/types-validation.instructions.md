---
applyTo: "src/types/**/*,src/lib/validators.ts"
---
# Types & Validation Rules

- Types: PascalCase (`BoardWithStandards`, `ExamAttemptResult`)
- Zod schemas: camelCase + Schema suffix (`createExamSchema`, `loginSchema`)
- Infer types from Zod: `type CreateExam = z.infer<typeof createExamSchema>`
- Derive DB types from Drizzle: `type User = InferSelectModel<typeof users>`
- IDs are `z.number().int().positive()` (BIGINT as number)
- Pagination: `z.object({ page: z.coerce.number().min(1).default(1), pageSize: z.coerce.number().min(1).max(100).default(20) })`
- Status enums: use `z.enum([...])` not `z.string()`
- API response type: discriminated union `{ success: true, data: T } | { success: false, error: {...} }`
- Shared schemas in `src/lib/validators.ts`; route-specific schemas stay in route files
