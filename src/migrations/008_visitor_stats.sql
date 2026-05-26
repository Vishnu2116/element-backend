CREATE TABLE visitor_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  total_count BIGINT DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO visitor_stats (id, total_count)
VALUES (gen_random_uuid(), 0);
