---
applyTo: "src/lib/scraper/**/*,src/lib/queue/**/*,scripts/**/*"
---
# Scraper & Pipeline Rules

- All scrapers extend BaseScraper with rate limiting (1 req/2s), retry (3 attempts), and robots.txt respect
- Pipeline stages: SCRAPE → PARSE → TAG → SCORE → REVIEW → PUBLISH — each logs to content_pipeline_logs
- PDF text extraction: pdf.js for digital, Claude Vision for scanned (resize to max 1568px)
- Question paper parsing: split into individual questions, tag to topic_id, generate solutions
- BullMQ workers: 3 attempts with exponential backoff, graceful SIGTERM handling
- Store raw downloads in S3 before processing (audit trail)
- Never crash worker on single job failure — log error, mark failed, continue
