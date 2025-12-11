-- ==================================================
-- SCRIPT DE MIGRACIÓN: Schema Antiguo → Schema Nuevo
-- ==================================================
-- Ejecutar DESPUÉS de aplicar vira_schema_definitivo.sql
-- Este script migra datos del schema antiguo al nuevo
-- ==================================================

-- IMPORTANTE: Hacer backup antes de ejecutar
-- pg_dump -U postgres -d vira_db > backup_pre_migracion.sql

BEGIN;

-- ==================================================
-- 1. MIGRAR audio_library → biblioteca_audio
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'audio_library') THEN
        INSERT INTO "biblioteca_audio" (
            "id", "nombre", "audio", "tipo", "category", "s3_key",
            "duration_seconds", "volume_level", "fade_in", "fade_out",
            "reproductions", "is_active", "metadata", "user_id",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "name" as "nombre",
            "audio_url" as "audio",
            "type" as "tipo",
            "category",
            "s3_key",
            "duration_seconds",
            "volume_level",
            "fade_in",
            "fade_out",
            "reproductions",
            "is_active",
            "metadata",
            "user_id",
            "created_at",
            "updated_at"
        FROM "audio_library"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de audio_library → biblioteca_audio',
            (SELECT COUNT(*) FROM "audio_library");
    END IF;
END $$;

-- ==================================================
-- 2. MIGRAR newscast_templates → plantillas
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'newscast_templates') THEN
        INSERT INTO "plantillas" (
            "id", "nombre", "descripcion", "region", "radio_station",
            "duracion_minutos", "voz_proveedor", "voz_id",
            "incluir_clima", "incluir_hora", "frecuencia_anuncios",
            "categorias", "configuracion", "user_id",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "name" as "nombre",
            "description" as "descripcion",
            "region",
            "radio_station",
            "duration_minutes" as "duracion_minutos",
            "voice_provider" as "voz_proveedor",
            "voice_id" as "voz_id",
            "include_weather" as "incluir_clima",
            "include_time" as "incluir_hora",
            "ad_frequency" as "frecuencia_anuncios",
            "categories" as "categorias",
            "configuration" as "configuracion",
            "user_id",
            "created_at",
            "updated_at"
        FROM "newscast_templates"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de newscast_templates → plantillas',
            (SELECT COUNT(*) FROM "newscast_templates");
    END IF;
END $$;

-- ==================================================
-- 3. MIGRAR automation_jobs → programados
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'automation_jobs') THEN
        INSERT INTO "programados" (
            "id", "nombre", "tipo", "horario", "esta_activo",
            "configuracion", "ultima_ejecucion", "proxima_ejecucion",
            "total_ejecuciones", "ejecuciones_exitosas",
            "user_id", "created_at", "updated_at"
        )
        SELECT
            "id",
            "name" as "nombre",
            "type" as "tipo",
            "schedule" as "horario",
            "is_active" as "esta_activo",
            "configuration" as "configuracion",
            "last_run" as "ultima_ejecucion",
            "next_run" as "proxima_ejecucion",
            "run_count" as "total_ejecuciones",
            "success_count" as "ejecuciones_exitosas",
            "user_id",
            "created_at",
            "updated_at"
        FROM "automation_jobs"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de automation_jobs → programados',
            (SELECT COUNT(*) FROM "automation_jobs");
    END IF;
END $$;

-- ==================================================
-- 4. MIGRAR news_reports → noticieros
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'news_reports') THEN
        INSERT INTO "noticieros" (
            "id", "titulo", "contenido", "datos_timeline",
            "url_audio", "s3_key", "duracion_segundos", "estado",
            "costo_generacion", "total_tokens", "metadata",
            "user_id", "fecha_publicacion",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "title" as "titulo",
            "content" as "contenido",
            "timeline_data" as "datos_timeline",
            "audio_url" as "url_audio",
            "s3_key",
            "duration_seconds" as "duracion_segundos",
            "status" as "estado",
            "generation_cost" as "costo_generacion",
            "token_count" as "total_tokens",
            "metadata",
            "user_id",
            "published_at" as "fecha_publicacion",
            "created_at",
            "updated_at"
        FROM "news_reports"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de news_reports → noticieros',
            (SELECT COUNT(*) FROM "news_reports");
    END IF;
END $$;

-- ==================================================
-- 5. MIGRAR scraped_news → noticias_scrapeadas
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'scraped_news') THEN
        INSERT INTO "noticias_scrapeadas" (
            "id", "titulo", "contenido", "resumen", "url",
            "categoria", "sentimiento", "prioridad", "region",
            "autor", "imagen_url", "fecha_publicacion",
            "fecha_scraping", "fue_procesada", "embedding"
        )
        SELECT
            "id",
            "title" as "titulo",
            "content" as "contenido",
            "summary" as "resumen",
            "url",
            "category" as "categoria",
            "sentiment" as "sentimiento",
            "priority" as "prioridad",
            "region",
            "author" as "autor",
            "image_url" as "imagen_url",
            "published_date" as "fecha_publicacion",
            "scraped_at" as "fecha_scraping",
            "is_processed" as "fue_procesada",
            "embedding"
        FROM "scraped_news"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de scraped_news → noticias_scrapeadas',
            (SELECT COUNT(*) FROM "scraped_news");
    END IF;
END $$;

-- ==================================================
-- 6. MIGRAR ad_campaigns → campanas_publicitarias
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ad_campaigns') THEN
        INSERT INTO "campanas_publicitarias" (
            "id", "nombre", "descripcion", "url_audio", "s3_key",
            "duracion_segundos", "esta_activo", "reproducciones",
            "fecha_inicio", "fecha_fin", "user_id",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "name" as "nombre",
            "description" as "descripcion",
            "audio_url" as "url_audio",
            "s3_key",
            "duration_seconds" as "duracion_segundos",
            "is_active" as "esta_activo",
            "reproductions" as "reproducciones",
            "start_date" as "fecha_inicio",
            "end_date" as "fecha_fin",
            "user_id",
            "created_at",
            "updated_at"
        FROM "ad_campaigns"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de ad_campaigns → campanas_publicitarias',
            (SELECT COUNT(*) FROM "ad_campaigns");
    END IF;
END $$;

-- ==================================================
-- 7. MIGRAR invoices → facturas
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'invoices') THEN
        INSERT INTO "facturas" (
            "id", "user_id", "numero_factura", "monto", "impuesto",
            "total", "moneda", "estado", "fecha_vencimiento",
            "fecha_pago", "datos_facturacion", "url_pdf",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "user_id",
            "invoice_number" as "numero_factura",
            "amount" as "monto",
            "tax" as "impuesto",
            "total",
            "currency" as "moneda",
            "status" as "estado",
            "due_date" as "fecha_vencimiento",
            "paid_date" as "fecha_pago",
            "billing_data" as "datos_facturacion",
            "pdf_url" as "url_pdf",
            "created_at",
            "updated_at"
        FROM "invoices"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de invoices → facturas',
            (SELECT COUNT(*) FROM "invoices");
    END IF;
END $$;

-- ==================================================
-- 8. MIGRAR token_usage → uso_tokens
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'token_usage') THEN
        INSERT INTO "uso_tokens" (
            "id", "user_id", "servicio", "operacion",
            "tokens_usados", "costo", "moneda", "metadata", "created_at"
        )
        SELECT
            "id",
            "user_id",
            "service" as "servicio",
            "operation" as "operacion",
            "tokens_used" as "tokens_usados",
            "cost" as "costo",
            "currency" as "moneda",
            "metadata",
            "created_at"
        FROM "token_usage"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de token_usage → uso_tokens',
            (SELECT COUNT(*) FROM "token_usage");
    END IF;
END $$;

-- ==================================================
-- 9. MIGRAR daily_metrics → metricas_diarias
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'daily_metrics') THEN
        INSERT INTO "metricas_diarias" (
            "id", "fecha", "total_noticieros", "costo_total",
            "total_tokens", "usuarios_activos",
            "tasa_exito_scraping", "tiempo_promedio_procesamiento",
            "datos_metricas", "created_at"
        )
        SELECT
            "id",
            "date" as "fecha",
            "total_news_reports" as "total_noticieros",
            "total_cost" as "costo_total",
            "total_tokens",
            "active_users" as "usuarios_activos",
            "scraping_success_rate" as "tasa_exito_scraping",
            "avg_processing_time" as "tiempo_promedio_procesamiento",
            "metrics_data" as "datos_metricas",
            "created_at"
        FROM "daily_metrics"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de daily_metrics → metricas_diarias',
            (SELECT COUNT(*) FROM "daily_metrics");
    END IF;
END $$;

-- ==================================================
-- 10. MIGRAR processing_logs → logs_procesamiento
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'processing_logs') THEN
        INSERT INTO "logs_procesamiento" (
            "id", "user_id", "noticiero_id", "tipo_proceso",
            "estado", "inicio", "fin", "duracion_segundos",
            "mensaje_error", "metadata", "tokens_usados", "costo"
        )
        SELECT
            "id",
            "user_id",
            "news_report_id" as "noticiero_id",
            "process_type" as "tipo_proceso",
            "status" as "estado",
            "started_at" as "inicio",
            "completed_at" as "fin",
            "duration_seconds" as "duracion_segundos",
            "error_message" as "mensaje_error",
            "metadata",
            "tokens_used" as "tokens_usados",
            "cost" as "costo"
        FROM "processing_logs"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de processing_logs → logs_procesamiento',
            (SELECT COUNT(*) FROM "processing_logs");
    END IF;
END $$;

-- ==================================================
-- 11. MIGRAR region_configs → configuraciones_regiones
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'region_configs') THEN
        INSERT INTO "configuraciones_regiones" (
            "id", "region", "zona_horaria", "clima_habilitado",
            "proveedor_voz_default", "voz_id_default",
            "fuentes_scraping", "frecuencia_anuncios",
            "max_noticias_por_reporte", "esta_activo",
            "created_at", "updated_at"
        )
        SELECT
            "id",
            "region",
            "timezone" as "zona_horaria",
            "weather_enabled" as "clima_habilitado",
            "default_voice_provider" as "proveedor_voz_default",
            "default_voice_id" as "voz_id_default",
            "scraping_sources" as "fuentes_scraping",
            "ad_frequency" as "frecuencia_anuncios",
            "max_news_per_report" as "max_noticias_por_reporte",
            "is_active" as "esta_activo",
            "created_at",
            "updated_at"
        FROM "region_configs"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de region_configs → configuraciones_regiones',
            (SELECT COUNT(*) FROM "region_configs");
    END IF;
END $$;

-- ==================================================
-- 12. MIGRAR task_queue → cola_tareas
-- ==================================================
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'task_queue') THEN
        INSERT INTO "cola_tareas" (
            "id", "tipo_tarea", "prioridad", "estado", "payload",
            "user_id", "intentos", "max_intentos",
            "programado_para", "inicio", "fin",
            "mensaje_error", "resultado", "created_at"
        )
        SELECT
            "id",
            "task_type" as "tipo_tarea",
            "priority" as "prioridad",
            "status" as "estado",
            "payload",
            "user_id",
            "attempts" as "intentos",
            "max_attempts" as "max_intentos",
            "scheduled_at" as "programado_para",
            "started_at" as "inicio",
            "completed_at" as "fin",
            "error_message" as "mensaje_error",
            "result" as "resultado",
            "created_at"
        FROM "task_queue"
        ON CONFLICT (id) DO NOTHING;

        RAISE NOTICE 'Migrados % registros de task_queue → cola_tareas',
            (SELECT COUNT(*) FROM "task_queue");
    END IF;
END $$;

-- ==================================================
-- 13. ACTUALIZAR USUARIOS (limpiar campos duplicados)
-- ==================================================
UPDATE "users"
SET "nombre_completo" = COALESCE("nombre_completo", "full_name", "name")
WHERE "nombre_completo" IS NULL;

-- Eliminar campos duplicados (si existen)
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.columns 
               WHERE table_name = 'users' AND column_name = 'full_name') THEN
        ALTER TABLE "users" DROP COLUMN "full_name";
        RAISE NOTICE 'Eliminada columna duplicada: users.full_name';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.columns 
               WHERE table_name = 'users' AND column_name = 'name') THEN
        ALTER TABLE "users" DROP COLUMN "name";
        RAISE NOTICE 'Eliminada columna duplicada: users.name';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.columns 
               WHERE table_name = 'users' AND column_name = 'password') THEN
        ALTER TABLE "users" DROP COLUMN "password";
        RAISE NOTICE 'Eliminada columna insegura: users.password (texto plano)';
    END IF;
END $$;

COMMIT;

-- ==================================================
-- VERIFICACIÓN POST-MIGRACIÓN
-- ==================================================

DO $$
DECLARE
    tabla RECORD;
    contador INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== VERIFICACIÓN POST-MIGRACIÓN ===';
    RAISE NOTICE '';
    
    FOR tabla IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name IN (
            'users', 'biblioteca_audio', 'plantillas', 'programados',
            'fuentes_final', 'radios', 'noticieros', 'noticias_scrapeadas',
            'campanas_publicitarias', 'facturas', 'uso_tokens',
            'metricas_diarias', 'logs_procesamiento',
            'configuraciones_regiones', 'cola_tareas'
        )
        ORDER BY table_name
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', tabla.table_name) INTO contador;
        RAISE NOTICE 'Tabla %: % registros', tabla.table_name, contador;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== MIGRACIÓN COMPLETADA ===';
END $$;

-- ==================================================
-- OPCIONAL: Eliminar tablas antiguas
-- (Descomentar solo DESPUÉS de verificar que todo funciona)
-- ==================================================

/*
DROP TABLE IF EXISTS audio_library CASCADE;
DROP TABLE IF EXISTS newscast_templates CASCADE;
DROP TABLE IF EXISTS automation_jobs CASCADE;
DROP TABLE IF EXISTS news_reports CASCADE;
DROP TABLE IF EXISTS scraped_news CASCADE;
DROP TABLE IF EXISTS ad_campaigns CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS token_usage CASCADE;
DROP TABLE IF EXISTS daily_metrics CASCADE;
DROP TABLE IF EXISTS processing_logs CASCADE;
DROP TABLE IF EXISTS region_configs CASCADE;
DROP TABLE IF EXISTS task_queue CASCADE;

RAISE NOTICE 'Tablas antiguas eliminadas';
*/
