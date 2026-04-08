-- Backfill quality scores based on content analysis
UPDATE content_items SET quality_score = (
  -- has_headings (0.15)
  CASE
    WHEN (SELECT count(*) FROM regexp_matches(body, '^#{1,3} .+', 'gm')) >= 5 THEN 0.15
    WHEN (SELECT count(*) FROM regexp_matches(body, '^#{1,3} .+', 'gm')) >= 3 THEN 0.12
    WHEN (SELECT count(*) FROM regexp_matches(body, '^#{1,3} .+', 'gm')) >= 1 THEN 0.075
    ELSE 0
  END
  +
  -- has_definitions (0.10)
  CASE
    WHEN body LIKE '%**%**%' AND body ~* 'definition|is defined as|refers to' THEN 0.10
    WHEN body LIKE '%**%**%' THEN 0.07
    ELSE 0
  END
  +
  -- has_formulas (0.10)
  CASE
    WHEN body LIKE '%$$%$$%' THEN 0.10
    WHEN body LIKE '%$%$%' THEN 0.06
    ELSE 0.02
  END
  +
  -- has_examples (0.10)
  CASE
    WHEN body ~* 'example|e\.g\.|such as|consider ' THEN 0.10
    ELSE 0
  END
  +
  -- has_summary (0.10)
  CASE
    WHEN body ~* 'summary|key points|important|quick revision|remember' THEN 0.10
    ELSE 0
  END
  +
  -- body_length (0.20)
  CASE
    WHEN length(body) >= 5000 THEN 0.20
    WHEN length(body) >= 3000 THEN 0.16
    WHEN length(body) >= 1500 THEN 0.10
    WHEN length(body) >= 500 THEN 0.06
    ELSE 0.02
  END
  +
  -- min_body_length (0.15)
  CASE
    WHEN length(body) >= 3000 THEN 0.15
    WHEN length(body) >= 2000 THEN 0.13
    WHEN length(body) >= 1000 THEN 0.09
    WHEN length(body) >= 500 THEN 0.06
    ELSE 0
  END
  +
  -- has_paragraphs (0.10)
  CASE
    WHEN array_length(regexp_split_to_array(body, E'\n\n+'), 1) >= 8 THEN 0.10
    WHEN array_length(regexp_split_to_array(body, E'\n\n+'), 1) >= 5 THEN 0.08
    WHEN array_length(regexp_split_to_array(body, E'\n\n+'), 1) >= 3 THEN 0.05
    ELSE 0
  END
)::numeric(3,2);

SELECT id, title, quality_score, length(body) as body_len FROM content_items ORDER BY id;
