-- ==================================================
-- Migración: Agregar soporte para Google Drive
-- ==================================================
-- Fecha: 2024-12-25
-- Descripción: Agrega columnas para tokens de Google OAuth
-- ==================================================

-- Agregar columnas de Google a tabla users
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS google_refresh_token TEXT,
ADD COLUMN IF NOT EXISTS google_email TEXT,
ADD COLUMN IF NOT EXISTS google_connected_at TIMESTAMPTZ;

COMMENT ON COLUMN users.google_refresh_token IS 'Refresh token para acceder a Google Drive del usuario';
COMMENT ON COLUMN users.google_email IS 'Email de la cuenta Google vinculada';
COMMENT ON COLUMN users.google_connected_at IS 'Fecha de vinculación de cuenta Google';

-- Agregar columna drive_file_id a biblioteca_audio
ALTER TABLE biblioteca_audio
ADD COLUMN IF NOT EXISTS drive_file_id TEXT;

COMMENT ON COLUMN biblioteca_audio.drive_file_id IS 'ID del archivo en Google Drive (si aplica)';

-- Índice para buscar usuarios con Google vinculado
CREATE INDEX IF NOT EXISTS idx_users_google_connected 
ON users(google_refresh_token) 
WHERE google_refresh_token IS NOT NULL;
