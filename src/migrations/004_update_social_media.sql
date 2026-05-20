ALTER TABLE home_social_media 
ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(500);

ALTER TABLE home_social_media 
ADD COLUMN IF NOT EXISTS twitter_url VARCHAR(500);
