-- Arreglar permisos para TODAS las tablas críticas
-- Ejecutar en Supabase SQL Editor

-- 1. Deshabilitar RLS en tablas de salida
ALTER TABLE "noticieros" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "logs_procesamiento" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "campanas_publicitarias" DISABLE ROW LEVEL SECURITY;

-- 2. Otorgar permisos explícitos a roles
GRANT ALL ON "noticieros" TO postgres, service_role, authenticated, anon;
GRANT ALL ON "logs_procesamiento" TO postgres, service_role, authenticated, anon;
GRANT ALL ON "campanas_publicitarias" TO postgres, service_role, authenticated, anon;

-- 3. Verificar estado
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('noticieros', 'logs_procesamiento', 'campanas_publicitarias');
