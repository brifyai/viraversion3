-- ==================================================
-- VIRA - Fase 1: Estandarización de Roles y Permisos
-- ==================================================

-- 1. Crear tipo ENUM para roles estandarizados
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'user');

-- 2. Actualizar tabla de usuarios para usar el nuevo tipo
-- Nota: Esto requiere recrear la tabla o hacer una migración gradual
-- Como alternativa, agregamos una constraint CHECK por ahora

ALTER TABLE "users" 
ADD CONSTRAINT check_user_role 
CHECK (role IN ('admin', 'operator', 'user'));

-- 3. Crear tabla de permisos por rol
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "role" user_role NOT NULL,
    "permission" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("role", "permission")
);

-- 4. Insertar permisos por defecto
INSERT INTO "role_permissions" ("role", "permission", "description") VALUES
-- Permisos de Administrador
('admin', 'users:read', 'Ver lista de usuarios'),
('admin', 'users:write', 'Crear y editar usuarios'),
('admin', 'users:delete', 'Eliminar usuarios'),
('admin', 'system:read', 'Ver configuración del sistema'),
('admin', 'system:write', 'Modificar configuración del sistema'),
('admin', 'system:config', 'Configurar parámetros globales'),
('admin', 'billing:read', 'Ver facturación y pagos'),
('admin', 'billing:write', 'Gestionar facturación'),
('admin', 'reports:global', 'Ver reportes de todo el sistema'),
('admin', 'templates:global', 'Gestionar plantillas globales'),
('admin', 'integrations:manage', 'Configurar integraciones del sistema'),
('admin', 'metrics:global', 'Ver métricas globales'),

-- Permisos de Operador
('operator', 'news:read', 'Ver noticias'),
('operator', 'news:write', 'Crear y editar noticias'),
('operator', 'news:publish', 'Publicar noticias'),
('operator', 'templates:read', 'Ver plantillas'),
('operator', 'templates:write', 'Crear y editar plantillas'),
('operator', 'automation:manage', 'Gestionar automatizaciones'),
('operator', 'library:manage', 'Gestionar biblioteca de audio'),
('operator', 'reports:read', 'Ver reportes propios'),

-- Permisos de Usuario Normal
('user', 'news:read_own', 'Ver sus propias noticias'),
('user', 'news:write_own', 'Crear y editar sus noticias'),
('user', 'templates:read_own', 'Ver sus propias plantillas'),
('user', 'templates:write_own', 'Crear y editar sus plantillas'),
('user', 'profile:manage', 'Gestionar su perfil')
ON CONFLICT (role, permission) DO NOTHING;

-- 5. Crear función para verificar permisos
CREATE OR REPLACE FUNCTION has_permission(user_uuid UUID, required_permission TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_role_value TEXT;
    permission_exists BOOLEAN;
BEGIN
    -- Obtener el rol del usuario
    SELECT role INTO user_role_value
    FROM "users"
    WHERE id = user_uuid;
    
    -- Verificar si el usuario tiene el permiso requerido
    SELECT EXISTS(
        SELECT 1 FROM "role_permissions"
        WHERE role = user_role_value::user_role 
        AND permission = required_permission
    ) INTO permission_exists;
    
    RETURN COALESCE(permission_exists, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Crear vista de permisos de usuario
CREATE OR REPLACE VIEW "user_permissions_view" AS
SELECT 
    u.id as user_id,
    u.email,
    u.role,
    array_agg(rp.permission) as permissions,
    array_agg(rp.description) as permission_descriptions
FROM "users" u
LEFT JOIN "role_permissions" rp ON u.role::text = rp.role::text
GROUP BY u.id, u.email, u.role;

-- 7. Actualizar políticas RLS para usar permisos
-- Eliminar políticas existentes
DROP POLICY IF EXISTS "Users can view own profile" ON "users";
DROP POLICY IF EXISTS "Users can update own profile" ON "users";
DROP POLICY IF EXISTS "Admins can view all users" ON "users";
DROP POLICY IF EXISTS "Admins can manage all users" ON "users";

-- Crear nuevas políticas basadas en permisos
CREATE POLICY "Users can view own profile" ON "users" FOR SELECT USING (
    auth.uid() = id OR 
    has_permission(auth.uid(), 'users:read')
);

CREATE POLICY "Users can update own profile" ON "users" FOR UPDATE USING (
    auth.uid() = id OR 
    has_permission(auth.uid(), 'users:write')
);

CREATE POLICY "Admins can manage all users" ON "users" FOR ALL USING (
    has_permission(auth.uid(), 'users:write')
);

-- 8. Crear índices para optimización
CREATE INDEX IF NOT EXISTS "idx_role_permissions_role" ON "role_permissions"("role");
CREATE INDEX IF NOT EXISTS "idx_role_permissions_permission" ON "role_permissions"("permission");

-- ==================================================
-- COMENTARIOS PARA EL DESARROLLADOR
-- ==================================================

/*
PASOS MANUALES REQUERIDOS:

1. ACTUALIZAR ROLES EXISTENTES:
   Ejecutar estos comandos SQL para actualizar los 3 usuarios existentes:

   -- Para convertir 'administrador' a 'admin'
   UPDATE "users" SET role = 'admin' WHERE role = 'administrador' OR role = 'super-administrador';
   
   -- Para convertir 'operator' (si existe)
   UPDATE "users" SET role = 'operator' WHERE role = 'operator';
   
   -- Para mantener 'user' como está
   UPDATE "users" SET role = 'user' WHERE role NOT IN ('admin', 'operator');

2. VERIFICAR CAMBIOS:
   SELECT id, email, role FROM "users";

3. ACTUALIZAR CÓDIGO FRONTEND:
   - Cambiar 'administrador' -> 'admin'
   - Cambiar 'super-administrador' -> 'admin'
   - Usar 'operator' para operadores
   - Usar 'user' para usuarios normales

4. PROBAR PERMISOS:
   SELECT * FROM has_permission('user_uuid', 'users:read');
   SELECT * FROM "user_permissions_view" WHERE user_id = 'user_uuid';
*/