# Padvik Creators — Feature Spec, Monetization & AWS Infrastructure

---

## 1. CREATORS FEATURE OVERVIEW

### What is a Creator?

A Creator is any education professional or institution that produces and publishes learning content on Padvik, mapped to the curriculum. Think of it as "LinkedIn for educators meets YouTube for learning" — but every piece of content is tagged to a specific Board → Class → Subject → Chapter → Topic.

### Creator Types

| Type | Examples | Typical Content |
|------|----------|----------------|
| Independent Teacher | Tuition teacher, retired school teacher, subject expert | Video lessons, notes, question sets |
| Tuition Center | Coaching center, tuition batch | Structured courses, batch-specific content, live doubt sessions |
| School | CBSE/ICSE/State school | Official notes, worksheets, internal exam papers |
| Student Creator | Top-performing student | Handwritten notes, study tips, peer explanations |
| Publisher/Author | Textbook authors, content houses | Premium study materials, reference guides |

### Creator Profile

Each creator gets a public profile page (like LinkedIn) with: display name, bio, institution, subjects they teach, boards they cover, classes they cover, total content published, student followers, rating/reviews, Ask AI badge (if enabled), verification badge (for schools/institutions).

---

## 2. CREATOR CONTENT MODEL

### What Creators Can Upload

| Content Type | Format | Storage | Processing |
|-------------|--------|---------|------------|
| Video Lessons | MP4, WebM (max 2GB) | S3 + CloudFront | Transcode to HLS (adaptive bitrate) |
| Audio Lessons | MP3, WAV, M4A (max 500MB) | S3 + CloudFront | Transcode to AAC |
| Text Notes | Markdown editor in-app | PostgreSQL (body column) | Direct, no processing |
| Documents | PDF, DOCX (max 50MB) | S3 | Parse to text via document-parser |
| Images/Diagrams | PNG, JPG, SVG (max 20MB) | S3 + CloudFront | Resize + optimize via sharp |
| Question Sets | In-app question builder | PostgreSQL | Direct, with AI assist |
| Live Sessions | WebRTC / embedded meet link | No storage (or record to S3) | Optional recording |

### Curriculum Mapping (Critical)

Every piece of creator content MUST be tagged to at least:
- Board (CBSE, ICSE, Kerala, etc.)
- Class (1-12)
- Subject
- Chapter (recommended)
- Topic (optional but encouraged)

This is what makes Padvik different from YouTube — content is discoverable by students navigating their syllabus tree. When a student opens "CBSE Class 10 Physics Chapter 12 Electricity", they see official content AND creator content for that exact topic.

### Content Pipeline for Creator Uploads

```
Creator uploads file
  → File validation (type, size, virus scan)
  → Store original in S3: creators/{creatorId}/{contentId}/original.*
  → Queue processing job:
      Video → MediaConvert (HLS adaptive) → S3 + CloudFront
      Audio → MediaConvert (AAC) → S3 + CloudFront
      PDF/DOCX → document-parser → extract text → content_items
      Image → sharp resize → S3 + CloudFront
  → AI quality check (Haiku — rate content quality 0-1)
  → Auto-tag to curriculum if creator didn't fully tag
  → Set review_status = 'pending' (or 'approved' if verified creator)
  → Available to students once approved
```

---

## 3. STUDENT-CREATOR INTERACTION

### Doubt Clearance (Creator-Answered)

Students can post doubts on any creator's content. The creator (or their team) responds. This is NOT the Ask AI feature — this is human-to-human interaction.

- Student taps "Ask Doubt" on a video/note
- Writes question (text + optional image of their work)
- Doubt goes to creator's inbox
- Creator responds (text, audio clip, or short video)
- Other students can upvote helpful doubts (FAQ effect)
- Unanswered doubts after 24h get flagged

### Ask AI (Creator's Own AI Tutor)

Each creator can enable an AI tutor trained on their content. This is the same Ask AI from ExamForge but scoped to a creator's published content.

- Student opens creator's profile or content → taps "Ask AI"
- AI chat is context-injected with that creator's notes/content for the topic
- Uses RAG: query creator's content in vector store → inject relevant chunks → Claude answers
- Creator's content becomes the "knowledge base" for their AI tutor
- Branding: "Ask [Creator Name]'s AI" — feels like the teacher's own assistant
- Free tier: 5 AI questions/day. Premium: unlimited

### Ask AI (Student's Own — from ExamForge)

Separate from creator AI. This is the general Padvik AI tutor that answers from the curriculum database (NCERT, DIKSHA, all boards). Same implementation as ExamForge.

---

## 4. MONETIZATION MODEL

### Revenue Streams

```
┌─────────────────────────────────────────────────────────────┐
│                    PADVIK REVENUE MODEL                      │
│                                                              │
│  ┌─── STUDENT SUBSCRIPTIONS (primary revenue) ────────────┐  │
│  │                                                         │  │
│  │  Free Tier:                                             │  │
│  │  - Syllabus browse, limited notes, 3 exams/month       │  │
│  │  - 5 AI questions/day, limited creator content          │  │
│  │  - Ad-supported (non-intrusive banner ads)              │  │
│  │                                                         │  │
│  │  Padvik Plus (₹99/month or ₹799/year):                 │  │
│  │  - Unlimited notes, exams, AI questions                 │  │
│  │  - All free creator content                             │  │
│  │  - Performance analytics, study planner                 │  │
│  │  - No ads                                               │  │
│  │                                                         │  │
│  │  Padvik Pro (₹299/month or ₹2,499/year):               │  │
│  │  - Everything in Plus                                   │  │
│  │  - Access to ALL premium creator content                │  │
│  │  - Unlimited doubt clearance with creators              │  │
│  │  - Priority AI (faster, Opus model)                     │  │
│  │  - Downloadable content for offline                     │  │
│  │  - Parent dashboard access                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌─── CREATOR MONETIZATION ──────────────────────────────┐   │
│  │                                                        │   │
│  │  Free Creator Account:                                 │   │
│  │  - Publish unlimited free content                      │   │
│  │  - Basic analytics (views, likes)                      │   │
│  │  - Doubt inbox (limited)                               │   │
│  │                                                        │   │
│  │  Creator Plus (₹499/month):                            │   │
│  │  - Publish premium (paid) content                      │   │
│  │  - Detailed analytics + student insights               │   │
│  │  - AI tutor on their content (Ask AI branded)          │   │
│  │  - Unlimited doubt management                          │   │
│  │  - Classroom features (assign, grade)                  │   │
│  │  - Revenue share on premium content                    │   │
│  │                                                        │   │
│  │  Creator Pro (₹1,999/month):                           │   │
│  │  - Everything in Plus                                  │   │
│  │  - White-label AI tutor                                │   │
│  │  - API access to their content analytics               │   │
│  │  - Featured placement in student browse                │   │
│  │  - Priority content review (faster approval)           │   │
│  │  - Team accounts (for tuition centers with staff)      │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── REVENUE SHARING (creator premium content) ─────────┐   │
│  │                                                        │   │
│  │  When a Creator Plus/Pro publishes premium content:    │   │
│  │                                                        │   │
│  │  Revenue Split:                                        │   │
│  │  ├─ Creator gets 70%                                   │   │
│  │  ├─ Padvik gets 30%                                    │   │
│  │  │                                                     │   │
│  │  How premium content works:                            │   │
│  │  ├─ Creator marks specific content as "Premium"        │   │
│  │  ├─ Students on Pro plan get it included               │   │
│  │  ├─ Free/Plus students can buy individually            │   │
│  │  │  (₹29-499 per course/bundle, creator sets price)   │   │
│  │  ├─ Padvik pools Pro subscription revenue              │   │
│  │  │  and distributes to creators by consumption         │   │
│  │  │  (minutes watched, exercises completed)             │   │
│  │  └─ Monthly payout to creators via UPI/bank            │   │
│  │                                                        │   │
│  │  Pro subscription pool distribution formula:           │   │
│  │  Creator's share = (creator's consumed minutes /       │   │
│  │    total consumed minutes across all creators) × 70%   │   │
│  │    of total Pro subscription revenue                   │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌─── ADDITIONAL REVENUE ─────────────────────────────────┐  │
│  │                                                         │  │
│  │  School/Institution Licenses:                           │  │
│  │  ₹15,000-50,000/year per school (bulk student access)  │  │
│  │                                                         │  │
│  │  Advertising (Free tier only):                          │  │
│  │  Non-intrusive banner ads from education brands         │  │
│  │  ₹50-200 CPM for education-targeted audience            │  │
│  │                                                         │  │
│  │  API/White-label:                                       │  │
│  │  License Padvik's engine to other platforms              │  │
│  │  (coaching chains, school ERP providers)                 │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Payment Integration

- Razorpay (India standard — UPI, cards, netbanking, wallets)
- Subscription management: Razorpay Subscriptions API
- Creator payouts: Razorpay Route (split payments) or manual monthly UPI
- GST: 18% on subscription (Ensate collects and remits)
- TDS: 1% on creator payouts > ₹50 lakh/year (Section 194-O)

---

## 5. DATABASE ADDITIONS FOR CREATORS

```sql
-- Add to existing users table (or create separate)
ALTER TABLE users ADD COLUMN is_creator BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN creator_tier VARCHAR(20); -- free, plus, pro
ALTER TABLE users ADD COLUMN creator_verified BOOLEAN DEFAULT FALSE;

-- Creator profiles (extended info)
creator_profiles (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id) UNIQUE,
  display_name    VARCHAR(255) NOT NULL,
  bio             TEXT,
  institution     VARCHAR(255),
  institution_type VARCHAR(30),  -- school, tuition, independent, publisher
  boards          TEXT[],        -- boards they cover
  subjects        TEXT[],        -- subjects they teach
  classes_from    SMALLINT,
  classes_to      SMALLINT,
  website_url     TEXT,
  social_links    JSONB DEFAULT '{}',
  rating          DECIMAL(3,2) DEFAULT 0,
  follower_count  BIGINT DEFAULT 0,
  content_count   BIGINT DEFAULT 0,
  is_featured     BOOLEAN DEFAULT FALSE,
  payout_upi      VARCHAR(100),
  payout_bank     JSONB,         -- {account, ifsc, name}
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

-- Creator content (extends content_items or separate table)
creator_content (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  creator_id      BIGINT REFERENCES users(id),
  content_type    VARCHAR(30) NOT NULL, -- video, audio, note, document,
                                        -- question_set, image, live_session
  title           VARCHAR(500) NOT NULL,
  description     TEXT,
  body            TEXT,                  -- for text content
  file_upload_id  BIGINT REFERENCES file_uploads(id),
  media_url       TEXT,                  -- processed media (HLS/CDN URL)
  thumbnail_url   TEXT,
  duration_seconds INT,                  -- for video/audio
  board_id        BIGINT REFERENCES boards(id),
  standard_id     BIGINT REFERENCES standards(id),
  subject_id      BIGINT REFERENCES subjects(id),
  chapter_id      BIGINT REFERENCES chapters(id),
  topic_id        BIGINT REFERENCES topics(id),
  is_premium      BOOLEAN DEFAULT FALSE,
  price           DECIMAL(8,2),          -- individual purchase price (INR)
  language        VARCHAR(10) DEFAULT 'en',
  view_count      BIGINT DEFAULT 0,
  like_count      BIGINT DEFAULT 0,
  share_count     BIGINT DEFAULT 0,
  avg_rating      DECIMAL(3,2) DEFAULT 0,
  review_status   VARCHAR(20) DEFAULT 'pending',
  is_published    BOOLEAN DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
)

-- Student-Creator interactions
creator_followers (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  creator_id      BIGINT REFERENCES users(id),
  student_id      BIGINT REFERENCES users(id),
  followed_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(creator_id, student_id)
)

doubts (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  student_id      BIGINT REFERENCES users(id),
  creator_id      BIGINT REFERENCES users(id),
  content_id      BIGINT REFERENCES creator_content(id),
  topic_id        BIGINT REFERENCES topics(id),
  question_text   TEXT NOT NULL,
  question_images JSONB DEFAULT '[]',
  status          VARCHAR(20) DEFAULT 'open', -- open, answered, closed
  upvote_count    INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

doubt_responses (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  doubt_id        BIGINT REFERENCES doubts(id) ON DELETE CASCADE,
  responder_id    BIGINT REFERENCES users(id), -- creator or AI
  response_text   TEXT NOT NULL,
  response_type   VARCHAR(20) DEFAULT 'text', -- text, audio, video
  media_url       TEXT,
  is_ai           BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

-- Subscriptions & Payments
subscriptions (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  user_id         BIGINT REFERENCES users(id),
  plan            VARCHAR(20) NOT NULL,  -- free, plus, pro
  user_type       VARCHAR(20) NOT NULL,  -- student, creator
  razorpay_sub_id VARCHAR(100),
  status          VARCHAR(20) DEFAULT 'active',
  amount_inr      DECIMAL(8,2),
  billing_cycle   VARCHAR(10),           -- monthly, yearly
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

creator_earnings (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  creator_id      BIGINT REFERENCES users(id),
  period_month    DATE NOT NULL,          -- first of month
  total_views     BIGINT DEFAULT 0,
  total_minutes   BIGINT DEFAULT 0,       -- consumed minutes
  subscription_share DECIMAL(10,2),       -- from Pro pool
  direct_sales    DECIMAL(10,2),          -- individual purchases
  gross_earnings  DECIMAL(10,2),
  platform_fee    DECIMAL(10,2),          -- 30%
  net_earnings    DECIMAL(10,2),          -- 70%
  payout_status   VARCHAR(20) DEFAULT 'pending',
  payout_ref      VARCHAR(100),           -- UPI/bank ref
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
)

content_purchases (
  id              BIGINT PK GENERATED ALWAYS AS IDENTITY,
  student_id      BIGINT REFERENCES users(id),
  content_id      BIGINT REFERENCES creator_content(id),
  amount_inr      DECIMAL(8,2) NOT NULL,
  razorpay_payment_id VARCHAR(100),
  status          VARCHAR(20) DEFAULT 'completed',
  created_at      TIMESTAMPTZ DEFAULT NOW()
)
```

---

## 6. AWS INFRASTRUCTURE — MINIMUM BUDGET, SHARED WITH EXAMFORGE

### Shared AWS Account Architecture

Both Padvik and ExamForge run in the same AWS account (ap-south-1 Mumbai). Use resource tagging and separate S3 buckets/prefixes to keep costs trackable.

```
AWS Account (ap-south-1 Mumbai)
├── SHARED SERVICES (both apps use)
│   ├── RDS PostgreSQL (1 instance, 2 databases: examforge, padvik)
│   ├── ElastiCache Redis (1 cluster, 2 logical databases: db0=examforge, db1=padvik)
│   ├── Route 53 (DNS for both domains)
│   ├── ACM (SSL certs for both domains)
│   ├── CloudWatch (monitoring both)
│   ├── IAM (shared roles with resource-level policies)
│   └── SES (email for both)
│
├── EXAMFORGE
│   ├── App Runner: examforge-api (examforge.in)
│   ├── S3: ensate-examforge-uploads
│   └── CloudFront: examforge CDN
│
├── PADVIK
│   ├── App Runner: padvik-api (padvik.in)
│   ├── S3: ensate-padvik-uploads (syllabus, notes, questions)
│   ├── S3: ensate-padvik-media (creator videos, audio — BIG bucket)
│   ├── CloudFront: padvik CDN (static + media delivery)
│   └── MediaConvert: on-demand video/audio transcoding
│
└── COST TAGS
    ├── Project: examforge | padvik
    ├── Environment: production | staging
    └── Component: compute | storage | database | cdn | ai
```

### Phase 1: Minimum Budget (0-1,000 students, 0-50 creators)

**Target: ₹3,000-5,000/month ($35-60/month) for Padvik's share**

| Service | Config | Monthly Cost |
|---------|--------|-------------|
| **App Runner** | 0.25 vCPU, 0.5GB RAM, 1 instance (scales to 2) | ~$5-7 |
| **RDS PostgreSQL** | SHARED with ExamForge — db.t4g.micro (2 vCPU, 1GB), already running. Add `padvik` database. | $0 incremental (already paid) |
| **ElastiCache Redis** | SHARED — cache.t4g.micro, already running. Use db1 for Padvik. | $0 incremental |
| **S3 (content)** | Syllabus, notes, questions. ~10GB. Standard tier. | ~$0.25 |
| **S3 (media)** | Creator videos. ~50GB initially. S3 Intelligent-Tiering. | ~$1.50 |
| **CloudFront** | First 1TB/month FREE. Serve static + media. | $0 (free tier) |
| **MediaConvert** | On-demand. ~50 videos/month × 5 min avg. | ~$2-5 |
| **SES** | Shared — transactional emails. | ~$0.10 |
| **Route 53** | 1 hosted zone for padvik.in | $0.50 |
| **Total Padvik** | | **~$10-15/month** |

Plus shared services already running for ExamForge (RDS + Redis) at ~$25-30/month total.

**Key savings:**
- RDS and Redis are SHARED — biggest cost items, already paid for ExamForge
- CloudFront 1TB free tier covers early traffic easily
- App Runner scales to zero when idle (provisioned instance only)
- S3 Intelligent-Tiering auto-moves old content to cheaper storage
- MediaConvert is pay-per-minute, no idle cost

### Phase 2: Growth (1,000-10,000 students, 50-500 creators)

**Target: ₹8,000-15,000/month ($100-180/month)**

| Change | Why | Cost Impact |
|--------|-----|-------------|
| App Runner → 0.5 vCPU, 1GB, max 5 instances | More traffic | +$10-20 |
| RDS → db.t4g.small (2 vCPU, 2GB) | More queries, bigger DB | +$15 |
| S3 media → 500GB-1TB | More creator videos | +$12-25 |
| CloudFront → 2-5TB/month | Video streaming traffic | +$20-50 |
| Add CloudFront Function | Video access control (signed URLs for premium) | +$1 |
| MediaConvert → 500 videos/month | More creators uploading | +$20-40 |

### Phase 3: Scale (10,000+ students, 500+ creators)

**Move to ECS Fargate when App Runner limits hit.**

| Change | Why |
|--------|-----|
| ECS Fargate (spot instances for background jobs) | Cost-efficient containers |
| RDS → db.t4g.medium + read replica | Handle read-heavy student traffic |
| ElastiCache → cache.t4g.small | More caching needed |
| S3 → 5-10TB with lifecycle policies | Video archive to Glacier after 1 year |
| CloudFront → Security bundle ($35/month flat) | WAF + DDoS protection |
| Add SQS for job queues | Replace BullMQ with managed service |
| Consider Aurora Serverless v2 | Auto-scaling database |

### Video Delivery Strategy (Biggest Cost Driver)

Creator videos are the #1 cost driver. Optimize aggressively:

1. **Transcode to HLS adaptive bitrate** via MediaConvert:
   - 360p (mobile, low bandwidth) — 500kbps
   - 480p (default) — 1Mbps
   - 720p (Plus/Pro students) — 2.5Mbps
   - 1080p (Pro only) — 5Mbps
   This alone cuts bandwidth 60% vs serving original MP4

2. **CloudFront** serves video segments from edge cache:
   - Popular videos get cached → origin requests drop → S3 costs drop
   - Set Cache-Control: max-age=31536000 for video segments (immutable)

3. **Signed URLs** for premium content:
   - CloudFront signed URLs with 4-hour expiry
   - Prevents hotlinking and unauthorized downloads
   - CloudFront Function validates access at edge (fast, cheap)

4. **S3 Lifecycle Policies:**
   - Videos not viewed in 90 days → S3 Infrequent Access (40% cheaper)
   - Videos not viewed in 365 days → S3 Glacier Instant Retrieval (68% cheaper)
   - Original uploads (pre-transcode) → delete after 30 days

5. **Lazy transcoding:** Don't transcode on upload. Transcode on first view.
   - Upload → store original → first student watches → trigger transcode → cache HLS
   - Saves transcoding cost on videos nobody watches

---

## 7. CLAUDE CODE PROMPTS FOR CREATORS FEATURE

### Prompt C1: Database Schema + Creator Profiles

```
Read the existing database schemas in src/db/schema/. 
Create NEW schema files for the creators feature:

src/db/schema/creators.ts — creator_profiles, creator_content, 
  creator_followers tables
src/db/schema/doubts.ts — doubts, doubt_responses tables
src/db/schema/subscriptions.ts — subscriptions, creator_earnings, 
  content_purchases tables

Add is_creator, creator_tier, creator_verified columns to the existing 
users table schema (extend, don't replace).

All PKs BIGINT. Generate migration. Run it.
```

### Prompt C2: Creator Registration + Profile

```
Build the creator onboarding flow:
- POST /api/creators/register — upgrade user to creator
- GET/PUT /api/creators/profile — manage profile
- Creator profile page at /creators/[id]
- Creator dashboard at /dashboard/creator/
Purple theme, shadcn/ui components.
```

### Prompt C3: Content Upload Pipeline

```
Build the creator content upload system:
- POST /api/creators/content/upload — multipart file upload
- Support video, audio, PDF, DOCX, images
- Curriculum tagging (board, class, subject, chapter, topic selectors)
- Queue processing: video→MediaConvert, PDF→document-parser, etc.
- Content management page at /dashboard/creator/content
```

### Prompt C4: Doubt Clearance System

```
Build the student-creator doubt system:
- POST /api/doubts — student asks doubt on creator content
- GET /api/doubts/inbox — creator's doubt inbox
- POST /api/doubts/[id]/respond — creator responds
- Real-time notifications when doubt is answered
- Doubt thread UI similar to comments
```

### Prompt C5: Subscriptions + Payments

```
Integrate Razorpay for subscriptions:
- pnpm add razorpay
- Student plans: Free, Plus (₹99/mo), Pro (₹299/mo)
- Creator plans: Free, Plus (₹499/mo), Pro (₹1,999/mo)
- POST /api/subscriptions/create — create Razorpay subscription
- POST /api/subscriptions/webhook — handle Razorpay webhooks
- Subscription management page at /dashboard/settings/subscription
- Gate premium features based on plan
```

### Prompt C6: Creator Earnings + Payouts

```
Build the creator earnings system:
- Monthly earnings calculation job (BullMQ cron, 1st of each month)
- Calculate: Pro pool share (by consumed minutes) + direct sales
- Apply 70/30 split
- Creator earnings dashboard at /dashboard/creator/earnings
- Admin payout management at /admin/payouts
```

---

## 8. REVENUE PROJECTIONS

### Conservative Year 1 Scenario

```
Students:     5,000 total (2,000 free, 2,000 Plus, 1,000 Pro)
Creators:     100 total (70 free, 25 Plus, 5 Pro)

Monthly Revenue:
├── Student Plus:    2,000 × ₹99  = ₹1,98,000
├── Student Pro:     1,000 × ₹299 = ₹2,99,000
├── Creator Plus:    25 × ₹499    = ₹12,475
├── Creator Pro:     5 × ₹1,999   = ₹9,995
├── Direct content:  ~₹50,000 (individual purchases)
├── Padvik's 30%:    ₹15,000
├── Ads (free tier): 2,000 × ₹5 CPM × 20 views/day × 30 = ₹60,000
├── TOTAL MONTHLY:   ~₹6,45,000 (~$7,700)
├── AWS costs:       ~₹12,000 ($145)
├── AI costs:        ~₹8,000 ($95)
├── NET MARGIN:      ~₹6,25,000/month before salaries
```

### The Flywheel

```
More creators → more content → more students attracted
  → more subscription revenue → bigger creator payouts
  → attracts more creators → flywheel spins faster
```

The key insight from the Indian edtech correction: edtech's next phase is about companies that can prove outcomes, not just promise them. Padvik's advantage is that creator content is mapped to the actual curriculum — students can see which creator's content improved their exam scores on specific topics. This outcome-linked model is what investors are looking for in 2026.
