---
applyTo: "tests/**/*,**/*.test.ts,**/*.test.tsx,**/*.spec.ts"
---
# Testing Rules

- Unit/component tests: Vitest + React Testing Library. E2E: Playwright
- Test file naming: same as source with `.test.ts` / `.test.tsx` suffix
- Describe blocks: `describe('ComponentOrFunction')`. Tests: `it('should [behavior] when [condition]')`
- Mock db and AI calls — never hit real services in unit tests
- UI components: test loading, error, and success states
- Forms: test valid input, invalid input, and edge cases
- API routes: test unauthorized, bad input, happy path, error handling
- Coverage targets: 80%+ on `src/lib/`, 60%+ on API routes
- Component tests focus on user interactions, not implementation details
