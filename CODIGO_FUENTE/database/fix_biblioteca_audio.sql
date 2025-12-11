-- ==================================================
-- FIX PARA TABLA BIBLIOTECA_AUDIO
-- ==================================================
-- Este script crea la tabla biblioteca_audio que el código espera
-- basándose en la estructura de audio_library existente

-- Crear tabla biblioteca_audio si no existe
CREATE TABLE IF NOT EXISTS "biblioteca_audio" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,                    -- Campo en español como lo usa el código
    "audio" TEXT,                              -- URL del audio (como lo usa el código)
    "tipo" TEXT NOT NULL,                      -- Tipo: voz, musica, efecto, etc.
    "genero" TEXT,                             -- Género de la voz (masculino, femenino)
    "idioma" TEXT,                             -- Idioma (español, inglés)
    "duracion" TEXT,                           -- Duración formateada
    "descripcion" TEXT,                        -- Descripción del audio
    "category" TEXT,                           -- Categoría (cortinas, efectos, musica_fondo)
    "s3_key" TEXT,
    "duration_seconds" INTEGER,
    "volume_level" NUMERIC(3,2) DEFAULT 1.0,
    "fade_in" INTEGER DEFAULT 0,
    "fade_out" INTEGER DEFAULT 0,
    "reproductions" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices para la nueva tabla
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_tipo" ON "biblioteca_audio"("tipo");
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_user_id" ON "biblioteca_audio"("user_id");
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_is_active" ON "biblioteca_audio"("is_active");

-- Habilitar RLS para la nueva tabla
ALTER TABLE "biblioteca_audio" ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS para biblioteca_audio
CREATE POLICY "Enable all for authenticated users on biblioteca_audio" ON "biblioteca_audio" FOR ALL USING (true);
CREATE POLICY "Enable select for anonymous users" on "biblioteca_audio" FOR SELECT USING (true);

-- Trigger para updated_at
CREATE TRIGGER update_biblioteca_audio_updated_at BEFORE UPDATE ON "biblioteca_audio" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Migrar datos existentes de audio_library si es necesario
INSERT INTO "biblioteca_audio" (
    "id", "nombre", "audio", "tipo", "category", "s3_key", 
    "duration_seconds", "volume_level", "fade_in", "fade_out", 
    "reproductions", "is_active", "metadata", "user_id", 
    "created_at", "updated_at"
)
SELECT 
    "id", 
    "name" as "nombre",
    "audio_url" as "audio",
    "type" as "tipo",
    "category",
    "s3_key",
    "duration_seconds",
    "volume_level",
    "fade_in",
    "fade_out",
    "reproductions",
    "is_active",
    "metadata",
    "user_id",
    "created_at",
    "updated_at"
FROM "audio_library"
WHERE NOT EXISTS (
    SELECT 1 FROM "biblioteca_audio" ba WHERE ba.id = "audio_library".id
);

-- Insertar algunas voces de ejemplo si la tabla está vacía
INSERT INTO "biblioteca_audio" ("nombre", "audio", "tipo", "genero", "idioma", "is_active") VALUES
('Voz Masculina Chilena', 'https://bbshnncbrpzahuckphtu.supabase.co/storage/v1/object/public/biblioteca_audio/f48ad3de.mp3', 'voz', 'masculino', 'español', true),
('Voz Femenina Chilena', 'https://bbshnncbrpzahuckphtu.supabase.co/storage/v1/object/public/biblioteca_audio/voice_female.mp3', 'voz', 'femenino', 'español', true),
('Voz Neutra Español', 'https://bbshnncbrpzahuckphtu.supabase.co/storage/v1/object/public/biblioteca_audio/voice_neutral.mp3', 'voz', 'neutro', 'español', true)
ON CONFLICT (id) DO NOTHING;

-- Comentario sobre la tabla
COMMENT ON TABLE "biblioteca_audio" IS 'Biblioteca de archivos de audio para VIRA (voces, música, efectos)';