-- ==================================================
-- VIRA - Políticas RLS Simplificadas (SIN RECURSIÓN)
-- ==================================================
-- Las políticas anteriores tenían recursión que bloqueaba las consultas
-- ==================================================

-- Primero, eliminar TODAS las políticas existentes en users
DROP POLICY IF EXISTS "users_self_select" ON "users";
DROP POLICY IF EXISTS "users_self_update" ON "users";
DROP POLICY IF EXISTS "users_admin_all" ON "users";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "users";

-- ==================================================
-- NUEVA POLÍTICA SIMPLE PARA TABLA: users
-- ==================================================
-- Cualquier usuario autenticado puede leer su propio registro
-- Sin recursión, usando directamente auth.uid()

CREATE POLICY "users_read_own" ON "users"
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON "users"
  FOR UPDATE USING (auth.uid() = id);

-- Para INSERT: permitir crear su propio perfil
CREATE POLICY "users_insert_own" ON "users"
  FOR INSERT WITH CHECK (auth.uid() = id);

-- NOTA: No agregamos política de admin que consulte la tabla users
-- porque crea recursión. En su lugar, el rol admin se maneja via user_metadata

-- ==================================================
-- VERIFICAR QUE RLS ESTÉ HABILITADO
-- ==================================================
-- Este comando fuerza RLS para la tabla users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- ==================================================
-- VERIFICACIÓN: Consultar las políticas creadas
-- ==================================================
-- SELECT * FROM pg_policies WHERE tablename = 'users';
