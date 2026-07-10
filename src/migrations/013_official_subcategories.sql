ALTER TABLE official_categories
  ADD COLUMN IF NOT EXISTS is_district_based BOOLEAN DEFAULT false;

ALTER TABLE officials
  ADD COLUMN IF NOT EXISTS district VARCHAR(100);
