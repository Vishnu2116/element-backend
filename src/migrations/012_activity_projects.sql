CREATE TABLE IF NOT EXISTS activity_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  paragraph TEXT,
  bullet_points JSONB DEFAULT '[]'::jsonb,
  stats JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity_project_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_project_id UUID NOT NULL REFERENCES activity_projects(id) ON DELETE CASCADE,
  image_path VARCHAR(500) NOT NULL,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_projects_project_id ON activity_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_activity_project_images_activity_project_id ON activity_project_images(activity_project_id);
