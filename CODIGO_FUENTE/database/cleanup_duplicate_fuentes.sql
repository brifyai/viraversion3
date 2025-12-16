-- ==================================================
-- Script para limpiar fuentes duplicadas
-- Ejecutar en Supabase SQL Editor
-- ==================================================

-- PASO 1: Ver duplicados antes de limpiar
-- (Solo para verificar, no modifica nada)
WITH normalized_urls AS (
    SELECT 
        id,
        nombre_fuente,
        url,
        region,
        created_at,
        -- Normalizar: quitar trailing slash, convertir a minúsculas
        LOWER(REGEXP_REPLACE(url, '/$', '')) as normalized_url
    FROM fuentes_final
),
duplicates AS (
    SELECT 
        normalized_url,
        COUNT(*) as count,
        array_agg(id ORDER BY created_at) as ids,
        array_agg(nombre_fuente ORDER BY created_at) as nombres,
        array_agg(url ORDER BY created_at) as urls
    FROM normalized_urls
    GROUP BY normalized_url
    HAVING COUNT(*) > 1
)
SELECT * FROM duplicates;

-- ==================================================
-- PASO 2: Migrar suscripciones de duplicados al original
-- (El original es el más antiguo - primer ID del array)
-- ==================================================

-- Primero, actualizar suscripciones para que apunten al original
WITH normalized_urls AS (
    SELECT 
        id,
        LOWER(REGEXP_REPLACE(url, '/$', '')) as normalized_url,
        created_at
    FROM fuentes_final
),
original_fuentes AS (
    SELECT DISTINCT ON (normalized_url)
        id as original_id,
        normalized_url
    FROM normalized_urls
    ORDER BY normalized_url, created_at ASC
),
duplicate_fuentes AS (
    SELECT 
        n.id as duplicate_id,
        o.original_id
    FROM normalized_urls n
    JOIN original_fuentes o ON n.normalized_url = o.normalized_url
    WHERE n.id != o.original_id
)
UPDATE user_fuentes_suscripciones SET fuente_id = d.original_id
FROM duplicate_fuentes d
WHERE user_fuentes_suscripciones.fuente_id = d.duplicate_id;

-- ==================================================
-- PASO 3: Eliminar fuentes duplicadas
-- (Solo después de migrar suscripciones)
-- ==================================================

WITH normalized_urls AS (
    SELECT 
        id,
        LOWER(REGEXP_REPLACE(url, '/$', '')) as normalized_url,
        created_at
    FROM fuentes_final
),
original_fuentes AS (
    SELECT DISTINCT ON (normalized_url)
        id as original_id,
        normalized_url
    FROM normalized_urls
    ORDER BY normalized_url, created_at ASC
),
duplicates_to_delete AS (
    SELECT n.id
    FROM normalized_urls n
    JOIN original_fuentes o ON n.normalized_url = o.normalized_url
    WHERE n.id != o.original_id
)
DELETE FROM fuentes_final
WHERE id IN (SELECT id FROM duplicates_to_delete);

-- ==================================================
-- PASO 4: Normalizar URLs de fuentes restantes
-- ==================================================

UPDATE fuentes_final
SET url = LOWER(REGEXP_REPLACE(url, '/$', ''))
WHERE url LIKE '%/';

-- Verificar resultado final
SELECT 
    nombre_fuente, 
    url, 
    region,
    created_at
FROM fuentes_final
ORDER BY region, nombre_fuente;
