ALTER TABLE projects
  DROP COLUMN IF EXISTS subtitle,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS objective,
  DROP COLUMN IF EXISTS beneficiaries,
  DROP COLUMN IF EXISTS timeline_start,
  DROP COLUMN IF EXISTS timeline_end,
  DROP COLUMN IF EXISTS coverage,
  DROP COLUMN IF EXISTS about,
  DROP COLUMN IF EXISTS community_impact,
  DROP COLUMN IF EXISTS livelihood_opportunities,
  DROP COLUMN IF EXISTS landscape_development_benefits,
  DROP COLUMN IF EXISTS key_activities,
  DROP COLUMN IF EXISTS expected_outcomes,
  DROP COLUMN IF EXISTS area_covered,
  DROP COLUMN IF EXISTS households,
  DROP COLUMN IF EXISTS districts;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS bullet_points JSONB DEFAULT '[]'::jsonb;