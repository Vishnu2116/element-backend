DROP TABLE IF EXISTS gis_kml_files;
DROP TABLE IF EXISTS gis_sites;

CREATE TABLE gis_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sl_no INT,
  district VARCHAR(100) NOT NULL,
  sub_division VARCHAR(255),
  range VARCHAR(255),
  beat VARCHAR(255),
  jfmc_name VARCHAR(255) NOT NULL,
  area_sanction NUMERIC,
  area_kobo NUMERIC,
  remarks VARCHAR(255),
  overlapping_area VARCHAR(255),
  display_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE gis_kml_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES gis_sites(id) ON DELETE CASCADE,
  file_name VARCHAR(255),
  file_path VARCHAR(500) NOT NULL,
  file_size INT,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gis_sites_district ON gis_sites(district);
CREATE INDEX IF NOT EXISTS idx_gis_kml_files_site_id ON gis_kml_files(site_id);
