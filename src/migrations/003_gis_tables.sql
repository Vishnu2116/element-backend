CREATE TABLE gis_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(500) NOT NULL,
  district VARCHAR(100) NOT NULL CHECK (district IN (
    'Dhalai', 'Gomati', 'Khowai', 'North Tripura',
    'Sepahijala', 'South Tripura', 'Unakoti', 'West Tripura'
  )),
  year INTEGER NOT NULL,
  area_covered VARCHAR(255),
  species_products VARCHAR(500),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE gis_kml_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES gis_sites(id) ON DELETE CASCADE,
  file_name VARCHAR(500) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  file_size INTEGER,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_gis_sites_year ON gis_sites(year);
CREATE INDEX idx_gis_sites_district ON gis_sites(district);
CREATE INDEX idx_gis_kml_files_site_id ON gis_kml_files(site_id);
