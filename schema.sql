CREATE TABLE IF NOT EXISTS csk22_store (
  id TEXT PRIMARY KEY DEFAULT 'main',
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT NOT NULL DEFAULT 'SK22 Member'
);

CREATE TABLE IF NOT EXISTS csk22_images (
  filename TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL DEFAULT 'image/webp',
  base64_data TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  label TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS csk22_history (
  id BIGSERIAL PRIMARY KEY,
  payload JSONB NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csk22_images_created_at ON csk22_images (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csk22_history_saved_at ON csk22_history (saved_at DESC);
