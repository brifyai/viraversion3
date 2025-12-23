-- ==================================================
-- MIGRACIÓN: newscast_jobs
-- Tabla para Background Functions de Netlify
-- Ejecutar en Supabase SQL Editor
-- ==================================================

-- Crear función de trigger si no existe
CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Tabla de jobs
CREATE TABLE IF NOT EXISTS "newscast_jobs" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "status" TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    "progress" INTEGER DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    "progress_message" TEXT,
    "newscast_id" UUID REFERENCES "noticieros"("id") ON DELETE SET NULL,
    "config" JSONB DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS "idx_newscast_jobs_user_id" ON "newscast_jobs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_newscast_jobs_status" ON "newscast_jobs"("status");
CREATE INDEX IF NOT EXISTS "idx_newscast_jobs_created_at" ON "newscast_jobs"("created_at");

-- RLS
ALTER TABLE "newscast_jobs" ENABLE ROW LEVEL SECURITY;

-- Política (usar DO para evitar error si ya existe)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'newscast_jobs' 
        AND policyname = 'Acceso completo para autenticados'
    ) THEN
        CREATE POLICY "Acceso completo para autenticados" ON "newscast_jobs" FOR ALL USING (true);
    END IF;
END $$;

-- Trigger (usar DROP IF EXISTS para evitar duplicados)
DROP TRIGGER IF EXISTS trigger_newscast_jobs_updated_at ON "newscast_jobs";
CREATE TRIGGER trigger_newscast_jobs_updated_at 
BEFORE UPDATE ON "newscast_jobs" 
FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

COMMENT ON TABLE "newscast_jobs" IS 'Jobs de generación de noticieros para Background Functions en Netlify';
