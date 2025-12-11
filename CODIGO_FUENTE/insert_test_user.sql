-- Insertar usuario de prueba
-- Ejecutar en Supabase SQL Editor

INSERT INTO "users" (id, email, full_name, created_at)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'test@vira.app',
  'Usuario de Prueba',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Verificar que existe
SELECT * FROM "users" WHERE id = '00000000-0000-0000-0000-000000000000';
