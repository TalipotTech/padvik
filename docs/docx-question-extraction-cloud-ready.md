# Docx Question Extraction — Cloud-Ready Implementation
## No LibreOffice dependency in production

---

## THE LIBREOFFICE PROBLEM

LibreOffice works on your dev machine but creates these issues in production:
- **Docker image bloat:** adds 500MB-1GB to container images
- **AWS App Runner / ECS:** need custom Docker images with it baked in
- **Cold starts:** in Lambda/serverless = 5-10 second cold start
- **ARM compatibility:** needs separate builds for Graviton
- **Windows vs Linux:** different binaries, different font rendering

---

## SOLUTION: Multi-Strategy Converter

The converter is pluggable — tries the best method available in the current environment. No single point of failure.

### Strategy Priority:

**1. MAMMOTH + PUPPETEER (default — zero native deps, works everywhere)**
mammoth converts docx → HTML with inline base64 images (preserving positions) → Puppeteer renders HTML → screenshots as page images → AI Vision parses.
- Works anywhere Node.js runs: App Runner, ECS, Cloud Run, Vercel, Railway
- Puppeteer auto-downloads Chromium (~170MB, much lighter than LibreOffice's 800MB)
- For Lambda: use puppeteer-core + @sparticuz/chromium (~50MB)

**2. CLOUD CONVERSION API (for serverless where even Puppeteer is heavy)**
Send docx to ConvertAPI / CloudConvert → receive PDF → convert pages to images.
- ~$0.01-0.03 per conversion
- Zero deps, just a REST call
- ConvertAPI gives 1500 free conversions on signup

**3. LIBREOFFICE IN DOCKER (only for ECS/EKS where it's pre-installed)**
Best formatting fidelity but heaviest. Check if soffice binary exists at runtime — use if available, skip otherwise.

**4. DIRECT TO AI VISION (last resort)**
Send mammoth HTML text + extracted images to AI. Least reliable for image-to-question association but zero conversion overhead.

### Strategy auto-selector logic:
```
1. Input is PDF? → skip conversion, go to page-to-image directly
2. Input is image? → use directly as single "page"
3. Input is docx?
   a. env DOCX_CONVERTER_STRATEGY set? → use that
   b. soffice binary found? → use LibreOffice
   c. CONVERT_API_SECRET env set? → use cloud API
   d. default → mammoth + puppeteer (always available)
```

---

## WHY MAMMOTH + PUPPETEER IS THE SWEET SPOT

The current approach (sending docx text + separate images to Gemini) fails because the AI can't associate images with questions. Mammoth + Puppeteer fixes this:

1. **mammoth** converts docx to HTML with images INLINE as base64 data URIs — the images stay exactly where Word placed them
2. We wrap the HTML in an A4-width template with proper styling
3. **Puppeteer** renders this HTML to a PDF (like a browser print)
4. We convert each PDF page to a PNG image
5. AI Vision receives page screenshots — it SEES questions and diagrams together, exactly as a student would

This is fundamentally different from "extract text + extract images separately + hope AI figures out the mapping."

---

## CLAUDE CODE PROMPT

```
Read the existing question parsing code and src/lib/ai/provider.ts.

I need a reusable document-to-questions extraction module that:
1. Handles docx files WITH embedded images correctly
2. Works in any cloud environment (NO LibreOffice dependency required)
3. Is reusable across Padvik and ExamForge
4. Uses the existing AI provider with auto language routing

Create a NEW directory: src/lib/document-parser/
With these files: types.ts, converter.ts, extract-questions.ts, index.ts

Install: pnpm add mammoth puppeteer sharp adm-zip

=== types.ts ===

Define: DocumentInput (filePath, fileType, language?, provider?),
ExtractedQuestion (questionNumber, section, questionText, questionType,
options, marks, hasImage, images[], subQuestions[], pageNumber, language),
ExtractionResult (questions, metadata including conversionStrategy, 
rawImages, warnings), ConverterStrategy union type, PageImage type.

=== converter.ts ===

Implement a convertDocument() function with pluggable strategies:

STRATEGY 1 — MAMMOTH + PUPPETEER (default):
a. mammoth.convertToHtml() with convertImage option that keeps images 
   as inline base64 data URIs:
   
   const result = await mammoth.convertToHtml(
     { path: docxPath },
     {
       convertImage: mammoth.images.imgElement(function(image) {
         return image.read("base64").then(function(imageBuffer) {
           return { 
             src: "data:" + image.contentType + ";base64," + imageBuffer 
           };
         });
       })
     }
   );

b. Wrap HTML in a proper A4-width document template (794px width,
   proper fonts, margins, line spacing)

c. Launch Puppeteer headless:
   const browser = await puppeteer.launch({
     headless: true,
     args: ['--no-sandbox', '--disable-setuid-sandbox']
   });

d. Set page to A4 viewport, load the HTML, generate full-page PDF

e. Convert each PDF page to PNG using sharp. Resize to max 1568px 
   on longest side (Claude Vision optimal size)

f. Close browser, return page images

STRATEGY 2 — CLOUD API:
Send docx to ConvertAPI (POST https://v2.convertapi.com/convert/docx/to/pdf),
receive PDF, convert pages to images. Only used if CONVERT_API_SECRET 
env var is set.

STRATEGY 3 — LIBREOFFICE:
Check if soffice binary exists. If yes, use it:
  soffice --headless --convert-to pdf --outdir /tmp input.docx
If not found, fall back to Strategy 1.

AUTO-SELECTOR: check env vars and binary availability at runtime to 
pick the best available strategy. Default is always mammoth+puppeteer.

ALSO extract embedded images at full resolution:
Use adm-zip to open docx, read word/media/ directory, upload originals 
to S3 for attaching to question records later.

=== extract-questions.ts ===

Main function:
export async function extractQuestionsFromDocument(
  input: DocumentInput,
  options?: { board?, grade?, subject?, year?, uploadToS3?, 
              maxPagesPerAICall?, converterStrategy? }
): Promise<ExtractionResult>

Steps:
1. Convert document to page images via convertDocument()
2. Detect language if not provided (send first page to Haiku, fast+cheap)
3. Send page images to AI Vision in batches of 2-3 pages
   - Use existing AI provider with language param
   - Provider auto-routes: English→Claude, Indic→Gemini
   - System prompt tells AI to flag hasImage, describe diagrams,
     extract all question structure including MCQ options and marks
4. Validate AI response with Zod
5. Match AI-identified images to extracted high-res embedded images
   using page number and position
6. Deduplicate questions that span page boundaries
7. Return ExtractionResult

=== index.ts ===
Export extractQuestionsFromDocument, convertDocument, and all types.

=== Environment Variables ===
Add to .env.example (all OPTIONAL — module works with zero config):
DOCX_CONVERTER_STRATEGY=    # auto | mammoth_puppeteer | cloud_api | libreoffice
CONVERT_API_SECRET=          # only needed for cloud_api strategy
LIBREOFFICE_PATH=            # custom soffice path (auto-detected if not set)

=== API Endpoint ===
POST /api/admin/extract-questions
- Multipart file upload
- Body: language?, provider?, board?, grade?, subject?, year?, 
        converterStrategy?
- Returns ExtractionResult (preview only — does NOT save to DB)
- Admin role required

=== Test Script ===
scripts/test-extract.ts — accepts docx path as CLI arg, runs extraction,
prints formatted JSON results.
Usage: pnpm tsx scripts/test-extract.ts path/to/paper.docx

=== CRITICAL DESIGN RULES ===
- src/lib/document-parser/ has ZERO imports from src/db/ or src/app/
- Depends ONLY on: src/lib/ai/provider.ts, src/lib/s3.ts, npm packages
- To reuse in ExamForge: copy directory, wire AI provider + S3
- Module works with ZERO env vars configured (defaults to mammoth+puppeteer)
- Verify with pnpm build after creation
```

---

## DEPLOYMENT MATRIX

| Environment | Strategy | Extra Setup |
|-------------|----------|-------------|
| Windows dev (your machine) | mammoth+puppeteer | Just works |
| AWS App Runner | mammoth+puppeteer | Just works |
| AWS ECS / Fargate | mammoth+puppeteer (or LibreOffice in Dockerfile) | Just works |
| AWS Lambda | cloud_api or puppeteer-core + @sparticuz/chromium | Set CONVERT_API_SECRET or add chromium layer |
| Vercel | mammoth+puppeteer | Works in serverless functions |
| Google Cloud Run | mammoth+puppeteer | Just works |
| Railway / Render | mammoth+puppeteer | Just works |

The default strategy (mammoth+puppeteer) requires zero configuration and works in every environment where Node.js runs. You only need to think about alternatives for Lambda or extreme edge cases.

---

## COST COMPARISON

| Strategy | Cost/Doc | Cloud-Ready | Image Fidelity | Setup |
|----------|----------|-------------|----------------|-------|
| mammoth+puppeteer | Free | Everywhere | Good (95%) | Zero config |
| ConvertAPI | ~$0.01 | Everywhere | Excellent (99%) | API key only |
| LibreOffice | Free | Docker only | Excellent (99%) | Heavy |
| Direct AI (skip convert) | ~$0.02 | Everywhere | Poor for images | Zero config |

**Start with mammoth+puppeteer.** Use ConvertAPI ($0.01/doc) for rare edge cases where mammoth formatting is insufficient.

For the AI Vision call itself:
- A 10-page paper, 30 questions, 8 images: ~$0.02-0.04 per paper
- 100 papers: ~$2-4 total
