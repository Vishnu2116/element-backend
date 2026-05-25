CREATE TABLE site_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  website_title VARCHAR(500) DEFAULT 'ELEMENT — Enhancing Landscape and Ecosystem Management',
  office_address TEXT DEFAULT 'Aranya Bhawan, Agartala, Tripura — 799006',
  contact_email VARCHAR(255) DEFAULT 'info@element.tripura.gov.in',
  contact_phone VARCHAR(50) DEFAULT '+91 381 2416403',
  helpline_number VARCHAR(50) DEFAULT '1800-345-3666',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert single default row
INSERT INTO site_settings (id) VALUES (gen_random_uuid());
