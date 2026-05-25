CREATE TABLE rti_officers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_type VARCHAR(50) NOT NULL CHECK (officer_type IN (
    'public_information_officer',
    'first_appellate_officer'
  )),
  name VARCHAR(255) NOT NULL,
  designation VARCHAR(255),
  address TEXT,
  phone VARCHAR(50),
  email VARCHAR(255),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE rti_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(500) NOT NULL,
  file_path VARCHAR(500),
  file_size INTEGER,
  file_type VARCHAR(50),
  display_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
