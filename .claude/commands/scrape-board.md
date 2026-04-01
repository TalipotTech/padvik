---
description: Scrape and parse syllabus for a specific education board
allowed-tools: Read, Edit, Write, Bash
---

Scrape the syllabus for the specified board. Follow the pipeline:

1. Read docs/seed-boards.md to find the board's source URL and scraping method
2. Read the existing scraper in src/lib/scraper/ for patterns
3. Create or update the board-specific scraper
4. Download syllabus PDFs or scrape HTML content
5. Use the AI syllabus parser (src/lib/ai/prompts/syllabus-parser.ts) 
   to extract structured data: subjects → chapters → topics
6. Validate extracted data against expected structure
7. Insert into database via Drizzle
8. Log results to scrape_jobs and content_pipeline_logs tables
9. Report: number of subjects, chapters, and topics extracted

Board to scrape: $ARGUMENTS
