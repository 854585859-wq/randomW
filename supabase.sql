-- Add IP tracking columns to page_views
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS user_agent TEXT;

-- Original tables
CREATE TABLE subscriptions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  artist TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Email sending log
CREATE TABLE sent_emails (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  artist TEXT NOT NULL,
  concert_artist TEXT,
  concert_date TEXT,
  venue_name TEXT,
  type TEXT NOT NULL DEFAULT 'subscription',
  sent_at TIMESTAMPTZ DEFAULT now()
);
