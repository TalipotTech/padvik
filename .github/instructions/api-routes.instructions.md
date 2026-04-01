---
applyTo: "src/app/api/**/*"
---
# API Route Rules

- Export named functions: `GET`, `POST`, `PUT`, `DELETE` — not default exports
- Validate request body with Zod before processing
- Response shape: `NextResponse.json({ success: true, data })` or `{ success: false, error: { code, message } }`
- Status codes: 200 ok, 201 created, 400 bad input, 401 unauthorized, 403 forbidden, 404 not found, 500 server error
- Wrap all handler logic in try/catch — never let unhandled errors reach the client
- Check auth via `getServerSession(authOptions)` at top of protected routes
- Check role: return 403 if user lacks required role (student, teacher, admin, parent)
- Streaming AI responses: return `new Response(stream)` with `Content-Type: text/event-stream`
