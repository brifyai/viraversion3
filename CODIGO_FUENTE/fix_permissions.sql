-- Otorgar permisos explícitos a la tabla noticias_scrapeadas
-- Ejecutar en Supabase SQL Editor

-- 1. Asegurar que RLS está deshabilitado (redundante pero seguro)
ALTER TABLE "noticias_scrapeadas" DISABLE ROW LEVEL SECURITY;

-- 2. Otorgar permisos al rol 'postgres' (admin)
GRANT ALL ON "noticias_scrapeadas" TO postgres;

-- 3. Otorgar permisos al rol 'service_role' (el que usa la API key del backend)
GRANT ALL ON "noticias_scrapeadas" TO service_role;

-- 4. Otorgar permisos a 'authenticated' y 'anon' (por si acaso)
GRANT ALL ON "noticias_scrapeadas" TO authenticated;
GRANT ALL ON "noticias_scrapeadas" TO anon;

-- 5. Verificar permisos
SELECT grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'noticias_scrapeadas';
