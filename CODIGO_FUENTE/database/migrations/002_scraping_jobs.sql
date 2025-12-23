-- Migración: Tabla scraping_jobs
-- Ejecutar en Supabase SQL Editor

-- Crear tabla para jobs de scraping asíncrono
CREATE TABLE IF NOT EXISTS "scraping_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "status" VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  "progress" INTEGER DEFAULT 0,
  "total" INTEGER DEFAULT 0,
  "noticias_procesadas" INTEGER DEFAULT 0,
  "noticias_fallidas" INTEGER DEFAULT 0,
  "result" JSONB,
  "error" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "completed_at" TIMESTAMPTZ
);

-- Desactivar RLS para evitar problemas de permisos (usamos service role)
ALTER TABLE "scraping_jobs" DISABLE ROW LEVEL SECURITY;

-- Índice para buscar jobs por usuario
CREATE INDEX IF NOT EXISTS idx_scraping_jobs_user ON "scraping_jobs" (user_id);

-- Comentario
COMMENT ON TABLE "scraping_jobs" IS 'Jobs de scraping asíncrono para evitar timeouts en Netlify';
