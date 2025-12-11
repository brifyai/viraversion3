-- Crear tabla noticias_scrapeadas si no existe
CREATE TABLE IF NOT EXISTS "noticias_scrapeadas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "titulo" TEXT NOT NULL,
    "contenido" TEXT,
    "resumen" TEXT,
    "fuente" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "categoria" TEXT,
    "region" TEXT NOT NULL,
    "fecha_publicacion" TIMESTAMPTZ DEFAULT NOW(),
    "fecha_scraping" TIMESTAMPTZ DEFAULT NOW(),
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Crear índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_noticias_region ON "noticias_scrapeadas"("region");
CREATE INDEX IF NOT EXISTS idx_noticias_categoria ON "noticias_scrapeadas"("categoria");
CREATE INDEX IF NOT EXISTS idx_noticias_fecha_pub ON "noticias_scrapeadas"("fecha_publicacion" DESC);
CREATE INDEX IF NOT EXISTS idx_noticias_fecha_scrap ON "noticias_scrapeadas"("fecha_scraping" DESC);
 
-- Deshabilitar RLS temporalmente para permitir inserciones
ALTER TABLE "noticias_scrapeadas" DISABLE ROW LEVEL SECURITY;

-- Comentario
COMMENT ON TABLE "noticias_scrapeadas" IS 'Noticias scrapeadas de fuentes externas';
