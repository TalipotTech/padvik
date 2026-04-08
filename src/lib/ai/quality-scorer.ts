/**
 * Coverage-Based Quality Scoring for Content Items
 *
 * Evaluates AI-generated or scraped content against structural quality criteria.
 * Replaces the hardcoded 0.70 score with an automated analysis.
 *
 * Scoring criteria (weights sum to 1.00):
 * - Has H1/H2 headings (0.15) — structured content has section headings
 * - Has definitions (0.10) — contains definition patterns, bold key terms
 * - Has formulas/equations (0.10) — contains LaTeX math notation
 * - Has examples (0.10) — contains example patterns
 * - Has summary/key points (0.10) — contains summary section
 * - Body length ratio (0.20) — AI output relative to source text length
 * - Minimum body length (0.15) — absolute body size check
 * - Has multiple paragraphs (0.10) — content is well-structured
 */

// ---------------------------------------------------------------------------
// Scoring criteria with weights
// ---------------------------------------------------------------------------

interface ScoringCriterion {
  name: string;
  weight: number;
  check: (body: string, sourceTextLength?: number) => number;
}

const CRITERIA: ScoringCriterion[] = [
  {
    name: "has_headings",
    weight: 0.15,
    check: (body) => {
      const h1Count = (body.match(/^# .+$/gm) ?? []).length;
      const h2Count = (body.match(/^## .+$/gm) ?? []).length;
      const h3Count = (body.match(/^### .+$/gm) ?? []).length;
      const totalHeadings = h1Count + h2Count + h3Count;
      if (totalHeadings >= 5) return 1.0;
      if (totalHeadings >= 3) return 0.8;
      if (totalHeadings >= 1) return 0.5;
      return 0;
    },
  },
  {
    name: "has_definitions",
    weight: 0.10,
    check: (body) => {
      const lower = body.toLowerCase();
      const patterns = [
        /\*\*[^*]+\*\*/g,               // bold key terms
        /definition[:\s]/gi,             // "Definition:"
        /is defined as/gi,               // "is defined as"
        /refers to/gi,                   // "refers to"
        /means /gi,                      // "means"
        /can be described as/gi,         // "can be described as"
      ];
      let matches = 0;
      for (const p of patterns) {
        matches += (body.match(p) ?? []).length;
      }
      if (matches >= 5) return 1.0;
      if (matches >= 3) return 0.7;
      if (matches >= 1) return 0.4;
      return 0;
    },
  },
  {
    name: "has_formulas",
    weight: 0.10,
    check: (body) => {
      const inlineMath = (body.match(/\$[^$]+\$/g) ?? []).length;
      const blockMath = (body.match(/\$\$[\s\S]+?\$\$/g) ?? []).length;
      const total = inlineMath + blockMath;
      if (total >= 3) return 1.0;
      if (total >= 1) return 0.6;
      // Some subjects (English, History) won't have formulas — don't penalize too much
      return 0.2;
    },
  },
  {
    name: "has_examples",
    weight: 0.10,
    check: (body) => {
      const lower = body.toLowerCase();
      const patterns = [
        /example[:\s]/gi,
        /for example/gi,
        /e\.g\./gi,
        /such as/gi,
        /consider /gi,
        /solved example/gi,
        /illustration/gi,
      ];
      let matches = 0;
      for (const p of patterns) {
        matches += (body.match(p) ?? []).length;
      }
      if (matches >= 3) return 1.0;
      if (matches >= 1) return 0.5;
      return 0;
    },
  },
  {
    name: "has_summary",
    weight: 0.10,
    check: (body) => {
      const lower = body.toLowerCase();
      const hasSummary = lower.includes("summary") || lower.includes("key points") ||
        lower.includes("important points") || lower.includes("quick revision") ||
        lower.includes("remember") || lower.includes("takeaway") ||
        lower.includes("recap");
      return hasSummary ? 1.0 : 0;
    },
  },
  {
    name: "body_length_ratio",
    weight: 0.20,
    check: (body, sourceTextLength) => {
      if (!sourceTextLength || sourceTextLength === 0) {
        // No source text length available — score based on absolute length only
        if (body.length > 3000) return 1.0;
        if (body.length > 1500) return 0.7;
        if (body.length > 500) return 0.4;
        return 0.2;
      }
      // AI output should be roughly 10-20% of source text (summarized/structured)
      const targetLength = sourceTextLength * 0.15;
      const ratio = body.length / targetLength;
      if (ratio >= 0.8) return 1.0;    // At least 80% of target
      if (ratio >= 0.5) return 0.7;    // 50-80% of target
      if (ratio >= 0.2) return 0.4;    // 20-50%
      return 0.1;                      // Very short relative to source
    },
  },
  {
    name: "minimum_body_length",
    weight: 0.15,
    check: (body) => {
      const len = body.trim().length;
      if (len >= 3000) return 1.0;     // Comprehensive content
      if (len >= 2000) return 0.85;
      if (len >= 1000) return 0.6;
      if (len >= 500) return 0.4;
      if (len >= 100) return 0.2;
      return 0;                        // Almost empty
    },
  },
  {
    name: "has_paragraphs",
    weight: 0.10,
    check: (body) => {
      const paragraphs = body.split(/\n\n+/).filter((p) => p.trim().length > 20);
      if (paragraphs.length >= 8) return 1.0;
      if (paragraphs.length >= 5) return 0.8;
      if (paragraphs.length >= 3) return 0.5;
      if (paragraphs.length >= 1) return 0.2;
      return 0;
    },
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a quality score for content body.
 *
 * @param body - The content body (markdown text)
 * @param sourceTextLength - Optional: length of the original source text (e.g., extracted PDF text)
 * @returns Score between 0.00 and 1.00
 */
export function computeQualityScore(body: string, sourceTextLength?: number): number {
  if (!body || body.trim().length === 0) return 0;

  let totalScore = 0;

  for (const criterion of CRITERIA) {
    const score = criterion.check(body, sourceTextLength);
    totalScore += score * criterion.weight;
  }

  // Clamp to 0.00 - 1.00 and round to 2 decimal places
  return Math.round(Math.min(1.0, Math.max(0, totalScore)) * 100) / 100;
}

/**
 * Get a detailed breakdown of quality scores per criterion.
 * Useful for admin dashboards and debugging.
 */
export function computeQualityBreakdown(
  body: string,
  sourceTextLength?: number
): Array<{ name: string; weight: number; score: number; weighted: number }> {
  if (!body || body.trim().length === 0) {
    return CRITERIA.map((c) => ({ name: c.name, weight: c.weight, score: 0, weighted: 0 }));
  }

  return CRITERIA.map((criterion) => {
    const score = criterion.check(body, sourceTextLength);
    return {
      name: criterion.name,
      weight: criterion.weight,
      score: Math.round(score * 100) / 100,
      weighted: Math.round(score * criterion.weight * 100) / 100,
    };
  });
}

/**
 * Format a quality score as a string descriptor.
 */
export function qualityLabel(score: number): string {
  if (score >= 0.85) return "Excellent";
  if (score >= 0.70) return "Good";
  if (score >= 0.50) return "Adequate";
  if (score >= 0.30) return "Needs improvement";
  return "Poor";
}
