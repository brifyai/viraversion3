-- ============================================
-- DIAGNÓSTICO Y CORRECCIÓN DE CONTRASEÑAS
-- ============================================
-- Ejecutar en Supabase SQL Editor
-- ============================================

-- PASO 1: Ver estado actual de usuarios
SELECT 
    email,
    nombre_completo,
    role,
    password_hash,
    CASE 
        WHEN password_hash IS NULL THEN '❌ Sin contraseña'
        WHEN password_hash LIKE '$2%' THEN '✅ Hasheada (bcrypt)'
        ELSE '⚠️ Texto plano o hash incorrecto'
    END as password_status,
    is_active,
    created_at
FROM users
ORDER BY created_at DESC;

-- ============================================
-- PASO 2: ELIMINAR usuarios con contraseñas incorrectas
-- ============================================
-- Solo si quieres empezar de cero
-- DELETE FROM users WHERE email IN ('usuario@correo.com', 'admin@vira.cl');

-- ============================================
-- PASO 3: CREAR usuarios correctamente hasheados
-- ============================================

-- Asegurar extensión pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- USUARIO 1: Admin principal
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
    crypt('vira2024', gen_salt('bf', 10)),
    'Admin VIRA',
    NOW(),
    'admin',
    'VIRA',
    true,
    NOW(),
    NOW()
) 
ON CONFLICT (email) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- USUARIO 2: Operador
INSERT INTO users (
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
    'operador@vira.app',
    crypt('vira2024', gen_salt('bf', 10)),
    'Operador VIRA',
    NOW(),
    'operator',
    'VIRA',
    true,
    NOW(),
    NOW()
) 
ON CONFLICT (email) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- USUARIO 3: Usuario regular
INSERT INTO users (
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
    'usuario@vira.app',
    crypt('vira2024', gen_salt('bf', 10)),
    'Usuario VIRA',
    NOW(),
    'user',
    'VIRA',
    true,
    NOW(),
    NOW()
) 
ON CONFLICT (email) DO UPDATE SET
    password_hash = crypt('vira2024', gen_salt('bf', 10)),
    updated_at = NOW();

-- ============================================
-- PASO 4: VERIFICAR que se crearon correctamente
-- ============================================
SELECT 
    email,
    nombre_completo,
    role,
    password_hash LIKE '$2%' as password_ok,
    LENGTH(password_hash) as hash_length,
    is_active
FROM users
WHERE email IN ('admin@vira.app', 'operador@vira.app', 'usuario@vira.app')
ORDER BY role DESC;

-- ============================================
-- PASO 5: PROBAR validación de contraseña
-- ============================================
-- Esto debería devolver TRUE si la contraseña es correcta
SELECT 
    email,
    password_hash = crypt('vira2024', password_hash) as password_matches
FROM users
WHERE email = 'admin@vira.app';

-- ============================================
-- RESULTADO ESPERADO:
-- ============================================
-- email: admin@vira.app
-- password_matches: true
-- ============================================

-- ============================================
-- CREDENCIALES FINALES
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
