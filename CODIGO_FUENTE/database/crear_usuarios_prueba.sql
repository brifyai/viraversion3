-- ============================================
-- CREAR USUARIO DE PRUEBA PARA VIRA
-- ============================================
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- Asegurar que la extensión pgcrypto está habilitada
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Insertar usuario de prueba con contraseña hasheada
-- Email: admin@vira.app
-- Password: vira2024
INSERT INTO users (
    id,
    email,
    password_hash,
    nombre_completo,
    email_verified,
    role,
    company,
    is_active,
    created_at,
    updated_at
) VALUES (
    'b97e393f-7410-42be-9c4b-f69887beb9c8'::uuid,
    'admin@vira.app',
    crypt('vira2024', gen_salt('bf', 10)),  -- Hashear con bcrypt
    'Admin VIRA',
    NOW(),
    'admin',
    'VIRA',
    true,
    NOW(),
    NOW()
) ON CONFLICT (id) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- Verificar que se creó correctamente
SELECT 
    id,
    email,
    nombre_completo,
    role,
    company,
    is_active,
    password_hash IS NOT NULL as has_password,
    created_at
FROM users
WHERE email = 'admin@vira.app';

-- ============================================
-- USUARIO ADICIONAL (Operador)
-- ============================================
INSERT INTO users (
    email,
    password_hash,
    nombre_completo,
    email_verified,
    role,
    company,
    is_active
) VALUES (
    'operador@vira.app',
    crypt('vira2024', gen_salt('bf', 10)),
    'Operador VIRA',
    NOW(),
    'operator',
    'VIRA',
    true
) ON CONFLICT (email) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- ============================================
-- USUARIO ADICIONAL (Usuario Regular)
-- ============================================
INSERT INTO users (
    email,
    password_hash,
    nombre_completo,
    email_verified,
    role,
    company,
    is_active
) VALUES (
    'usuario@vira.app',
    crypt('vira2024', gen_salt('bf', 10)),
    'Usuario VIRA',
    NOW(),
    'user',
    'VIRA',
    true
) ON CONFLICT (email) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- ============================================
-- VERIFICAR TODOS LOS USUARIOS
-- ============================================
SELECT 
    email,
    nombre_completo,
    role,
    is_active,
    password_hash LIKE '$2%' as password_is_hashed,
    created_at
FROM users
ORDER BY created_at DESC;

-- ============================================
-- CREDENCIALES PARA LOGIN
-- ============================================
-- Email: admin@vira.app
-- Password: vira2024
-- Role: admin
--
-- Email: operador@vira.app
-- Password: vira2024
-- Role: operator
--
-- Email: usuario@vira.app
-- Password: vira2024
-- Role: user
-- ============================================
