-- =============================================================
-- 001_initial_schema.sql
-- Government Project CMS — initial schema
-- =============================================================

-- 1. ADMINS
CREATE TABLE admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. HERO SLIDES
CREATE TABLE hero_slides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  subtitle TEXT,
  badge_text VARCHAR(255),
  cta1_label VARCHAR(255),
  cta1_link VARCHAR(500),
  cta2_label VARCHAR(255),
  cta2_link VARCHAR(500),
  image_path VARCHAR(500),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. HOME LEADERSHIP (4 fixed slots)
CREATE TABLE home_leadership (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_number INTEGER UNIQUE NOT NULL CHECK (slot_number BETWEEN 1 AND 4),
  name VARCHAR(255) NOT NULL,
  designation VARCHAR(255),
  organisation VARCHAR(255),
  photo_path VARCHAR(500),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. HOME SOCIAL MEDIA (single row)
CREATE TABLE home_social_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_handle VARCHAR(255),
  facebook_post_text TEXT,
  twitter_handle VARCHAR(255),
  twitter_post_text TEXT,
  youtube_video_url VARCHAR(500),
  youtube_video_title VARCHAR(500),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO home_social_media (id) VALUES (gen_random_uuid());

-- 5. OFFICIAL CATEGORIES
CREATE TABLE official_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. OFFICIALS
CREATE TABLE officials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  designation VARCHAR(255),
  organisation VARCHAR(255),
  division_office VARCHAR(255),
  phone VARCHAR(50),
  mobile VARCHAR(50),
  email VARCHAR(255),
  photo_path VARCHAR(500),
  bio TEXT,
  category_id UUID REFERENCES official_categories(id) ON DELETE SET NULL,
  show_in_whos_who BOOLEAN DEFAULT FALSE,
  show_in_directory BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. PROJECT COMPONENTS
CREATE TABLE project_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_number INTEGER NOT NULL,
  label VARCHAR(255),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  icon_name VARCHAR(100),
  stat1_label VARCHAR(255),
  stat1_value VARCHAR(255),
  stat2_label VARCHAR(255),
  stat2_value VARCHAR(255),
  stat3_label VARCHAR(255),
  stat3_value VARCHAR(255),
  stat4_label VARCHAR(255),
  stat4_value VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. PROJECTS
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id UUID REFERENCES project_components(id) ON DELETE SET NULL,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  subtitle TEXT,
  status VARCHAR(50) DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'pilot_phase', 'completed')),
  thumbnail_image_path VARCHAR(500),
  objective TEXT,
  beneficiaries TEXT,
  timeline_start VARCHAR(100),
  timeline_end VARCHAR(100),
  coverage TEXT,
  about TEXT,
  community_impact TEXT,
  livelihood_opportunities TEXT,
  landscape_development_benefits TEXT,
  key_activities JSONB DEFAULT '[]',
  expected_outcomes JSONB DEFAULT '[]',
  area_covered VARCHAR(255),
  households VARCHAR(255),
  districts VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. PROJECT GALLERY
CREATE TABLE project_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  caption VARCHAR(500),
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. KNOWLEDGE HUB DOCUMENTS
CREATE TABLE knowledge_hub_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL CHECK (type IN (
    'publication', 'report', 'iec_material', 'newsletter',
    'success_story', 'thematic_study', 'documentation',
    'case_study', 'notification', 'lessons_learned'
  )),
  title VARCHAR(500) NOT NULL,
  description TEXT,
  file_path VARCHAR(500),
  file_size INTEGER,
  file_type VARCHAR(50),
  language VARCHAR(100) DEFAULT 'English',
  thumbnail_path VARCHAR(500),
  published_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 11. GALLERY IMAGES (standalone)
CREATE TABLE gallery_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_path VARCHAR(500) NOT NULL,
  caption VARCHAR(500),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 12. EVENTS
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(500) UNIQUE NOT NULL,
  description TEXT,
  event_date DATE,
  cover_image_path VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 13. EVENT IMAGES
CREATE TABLE event_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  caption VARCHAR(500),
  show_in_gallery BOOLEAN DEFAULT FALSE,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 14. SOCIAL MEDIA EMBEDS (for /media/social page)
CREATE TABLE social_media_embeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facebook_embed_code TEXT,
  twitter_embed_code TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO social_media_embeds (id) VALUES (gen_random_uuid());

-- 15. YOUTUBE VIDEOS
CREATE TABLE youtube_videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500),
  youtube_url VARCHAR(500) NOT NULL,
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 16. PROCUREMENTS (Tenders + RFPs)
CREATE TABLE procurements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(10) NOT NULL CHECK (type IN ('tender', 'rfp')),
  title VARCHAR(500) NOT NULL,
  published_date DATE,
  deadline DATE,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closing_soon', 'closed', 'cancelled')),
  file_path VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- INDEXES
-- =============================================================
CREATE INDEX idx_projects_component_id     ON projects(component_id);
CREATE INDEX idx_projects_slug             ON projects(slug);
CREATE INDEX idx_projects_created_at       ON projects(created_at DESC);
CREATE INDEX idx_officials_category_id     ON officials(category_id);
CREATE INDEX idx_knowledge_hub_type        ON knowledge_hub_documents(type);
CREATE INDEX idx_knowledge_hub_created_at  ON knowledge_hub_documents(created_at DESC);
CREATE INDEX idx_event_images_event_id     ON event_images(event_id);
CREATE INDEX idx_procurements_type         ON procurements(type);
CREATE INDEX idx_procurements_created_at   ON procurements(created_at DESC);
