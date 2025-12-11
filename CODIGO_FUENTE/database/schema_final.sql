-- ==================================================
-- VIRA - SCHEMA COMPLETO Y DEFINITIVO UNIFICADO
-- ==================================================
-- Versión: 3.0 FINAL
-- Fecha: 19/11/2024
-- Descripción: Schema único que reemplaza TODOS los anteriores
-- Usa nombres reales del código frontend
-- ==================================================

-- ⚠️ IMPORTANTE: Este es el ÚNICO archivo de schema necesario
-- Eliminar: supabase_schema.sql, vira_schema_definitivo.sql, fix_biblioteca_audio.sql
-- Solo usar este archivo para crear/actualizar la base de datos

-- ==================================================
-- EXTENSIONES
-- ==================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ==================================================
-- TABLA: users
-- Usuario del sistema (sin campos duplicados)
-- ==================================================
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "email" TEXT UNIQUE NOT NULL,
    "password_hash" TEXT,  -- Solo hash bcrypt, NUNCA texto plano
    "nombre_completo" TEXT,
    "email_verified" TIMESTAMPTZ,
    "image" TEXT,
    "role" TEXT DEFAULT 'user' CHECK (role IN ('admin', 'operator', 'user')),
    "is_active" BOOLEAN DEFAULT true,
    "last_login" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "users" IS 'Usuarios del sistema VIRA';
COMMENT ON COLUMN "users"."password_hash" IS 'Hash bcrypt - NUNCA texto plano';

-- ==================================================
-- TABLAS DE AUTENTICACIÓN NextAuth.js
-- (Opcional - solo si se implementa NextAuth)
-- ==================================================

CREATE TABLE IF NOT EXISTS "accounts" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("provider", "provider_account_id")
);

CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "session_token" TEXT UNIQUE NOT NULL,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "expires" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT UNIQUE NOT NULL,
    "expires" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("identifier", "token")
);

COMMENT ON TABLE "accounts" IS 'OAuth providers (Google, GitHub, etc.)';
COMMENT ON TABLE "sessions" IS 'Sesiones de usuario activas';
COMMENT ON TABLE "verification_tokens" IS 'Tokens de verificación de email';

-- ==================================================
-- TABLA: biblioteca_audio
-- ✅ Nombre correcto usado por el código
-- ==================================================
CREATE TABLE IF NOT EXISTS "biblioteca_audio" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "audio" TEXT,  -- URL del audio
    "tipo" TEXT NOT NULL CHECK (tipo IN ('voz', 'musica', 'efecto', 'jingle', 'cortina', 'intro', 'outro')),
    "genero" TEXT CHECK (genero IN ('masculino', 'femenino', 'neutro')),
    "idioma" TEXT DEFAULT 'español',
    "duracion" TEXT,  -- Formato legible (ej: "00:30")
    "duration_seconds" INTEGER,
    "descripcion" TEXT,
    "category" TEXT,  -- cortinas, efectos, musica_fondo
    "s3_key" TEXT,
    "volume_level" NUMERIC(3,2) DEFAULT 1.0,
    "fade_in" INTEGER DEFAULT 0,
    "fade_out" INTEGER DEFAULT 0,
    "reproductions" INTEGER DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "biblioteca_audio" IS 'Biblioteca de audio: voces, música, efectos';

-- ==================================================
-- TABLA: plantillas
-- ✅ Nombre correcto usado por el código
-- ==================================================
CREATE TABLE IF NOT EXISTS "plantillas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "region" TEXT NOT NULL,
    "radio_station" TEXT,
    "duracion_minutos" INTEGER DEFAULT 15,
    "voz_proveedor" TEXT DEFAULT 'local-tts',
    "voz_id" TEXT DEFAULT 'default',
    "incluir_clima" BOOLEAN DEFAULT true,
    "incluir_hora" BOOLEAN DEFAULT true,
    "frecuencia_anuncios" INTEGER DEFAULT 2,
    "categorias" JSONB DEFAULT '[]',
    "configuracion" JSONB DEFAULT '{}',
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "plantillas" IS 'Plantillas configurables para noticieros';

-- ==================================================
-- TABLA: programados
-- ✅ Nombre correcto usado por el código
-- ==================================================
CREATE TABLE IF NOT EXISTS "programados" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL CHECK (tipo IN ('noticiero', 'publicacion_social', 'scraping')),
    "horario" TEXT,  -- Expresión cron
    "esta_activo" BOOLEAN DEFAULT true,
    "configuracion" JSONB DEFAULT '{}',
    "ultima_ejecucion" TIMESTAMPTZ,
    "proxima_ejecucion" TIMESTAMPTZ,
    "total_ejecuciones" INTEGER DEFAULT 0,
    "ejecuciones_exitosas" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "programados" IS 'Tareas programadas y automatización';

-- ==================================================
-- TABLA: fuentes_final
-- ✅ Nombre ya correcto
-- ==================================================
CREATE TABLE IF NOT EXISTS "fuentes_final" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,  -- Región
    "nombre_fuente" TEXT NOT NULL,  -- Nombre del medio
    "url" TEXT NOT NULL,
    "rss_url" TEXT,
    "esta_activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "fuentes_final" IS 'Fuentes de noticias RSS por región';

-- ==================================================
-- TABLA: radios
-- ✅ Nombre ya correcto
-- ==================================================
CREATE TABLE IF NOT EXISTS "radios" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "frecuencia" TEXT NOT NULL,  -- Ej: '99.7 FM'
    "region" TEXT NOT NULL,
    "url" TEXT,
    "esta_activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "radios" IS 'Radios por región';

-- ==================================================
-- TABLA: noticieros
-- Noticieros generados
-- ==================================================
CREATE TABLE IF NOT EXISTS "noticieros" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "titulo" TEXT NOT NULL,
    "contenido" TEXT,
    "datos_timeline" JSONB,  -- Timeline completo
    "url_audio" TEXT,
    "s3_key" TEXT,
    "duracion_segundos" INTEGER,
    "estado" TEXT DEFAULT 'generado' CHECK (estado IN ('generado', 'procesando', 'completado', 'fallido')),
    "costo_generacion" NUMERIC(10,4) DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "plantilla_id" UUID REFERENCES "plantillas"("id") ON DELETE SET NULL,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "fecha_publicacion" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "noticieros" IS 'Noticieros generados por el sistema';

-- ==================================================
-- TABLA: noticias_scrapeadas
-- Noticias de RSS feeds
-- ==================================================
CREATE TABLE IF NOT EXISTS "noticias_scrapeadas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "titulo" TEXT NOT NULL,
    "contenido" TEXT,
    "resumen" TEXT,
    "url" TEXT UNIQUE,
    "fuente" TEXT,
    "categoria" TEXT DEFAULT 'general',
    "sentimiento" TEXT DEFAULT 'neutral' CHECK (sentimiento IN ('positivo', 'negativo', 'neutral')),
    "prioridad" TEXT DEFAULT 'media' CHECK (prioridad IN ('alta', 'media', 'baja')),
    "region" TEXT,
    "autor" TEXT,
    "imagen_url" TEXT,
    "fecha_publicacion" TIMESTAMPTZ,
    "fecha_scraping" TIMESTAMPTZ DEFAULT NOW(),
    "fue_procesada" BOOLEAN DEFAULT false,
    "embedding" VECTOR(1536)  -- Para búsquedas semánticas
);

COMMENT ON TABLE "noticias_scrapeadas" IS 'Noticias obtenidas de RSS y scraping';

-- ==================================================
-- TABLA: campanas_publicitarias
-- ==================================================
CREATE TABLE IF NOT EXISTS "campanas_publicitarias" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "url_audio" TEXT,
    "s3_key" TEXT,
    "duracion_segundos" INTEGER,
    "esta_activo" BOOLEAN DEFAULT true,
    "reproducciones" INTEGER DEFAULT 0,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "campanas_publicitarias" IS 'Campañas publicitarias para noticieros';

-- ==================================================
-- TABLA: facturas
-- ==================================================
CREATE TABLE IF NOT EXISTS "facturas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "numero_factura" TEXT UNIQUE NOT NULL,
    "monto" NUMERIC(10,2) NOT NULL,
    "impuesto" NUMERIC(10,2) DEFAULT 0,
    "total" NUMERIC(10,2) NOT NULL,
    "moneda" TEXT DEFAULT 'CLP',
    "estado" TEXT DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada', 'pagada', 'vencida')),
    "fecha_vencimiento" DATE,
    "fecha_pago" TIMESTAMPTZ,
    "datos_facturacion" JSONB DEFAULT '{}',
    "url_pdf" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "facturas" IS 'Facturas generadas';

-- ==================================================
-- TABLA: uso_tokens
-- Tracking de uso de APIs
-- ==================================================
CREATE TABLE IF NOT EXISTS "uso_tokens" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "servicio" TEXT NOT NULL,  -- chutes, openai, elevenlabs, etc.
    "operacion" TEXT NOT NULL,  -- tts, procesamiento_texto, scraping
    "tokens_usados" INTEGER DEFAULT 0,
    "costo" NUMERIC(10,4) DEFAULT 0,
    "moneda" TEXT DEFAULT 'USD',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "uso_tokens" IS 'Registro de uso y costos por usuario';

-- ==================================================
-- TABLA: metricas_diarias
-- ==================================================
CREATE TABLE IF NOT EXISTS "metricas_diarias" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "fecha" DATE UNIQUE NOT NULL,
    "total_noticieros" INTEGER DEFAULT 0,
    "costo_total" NUMERIC(10,4) DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "usuarios_activos" INTEGER DEFAULT 0,
    "tasa_exito_scraping" NUMERIC(3,2) DEFAULT 1.0,
    "tiempo_promedio_procesamiento" INTEGER,
    "datos_metricas" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "metricas_diarias" IS 'Métricas agregadas por día';

-- ==================================================
-- TABLA: logs_procesamiento
-- ==================================================
CREATE TABLE IF NOT EXISTS "logs_procesamiento" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "noticiero_id" UUID REFERENCES "noticieros"("id") ON DELETE CASCADE,
    "tipo_proceso" TEXT NOT NULL CHECK (tipo_proceso IN ('scraping', 'procesamiento', 'tts', 'ensamblaje')),
    "estado" TEXT NOT NULL CHECK (estado IN ('iniciado', 'completado', 'fallido')),
    "inicio" TIMESTAMPTZ DEFAULT NOW(),
    "fin" TIMESTAMPTZ,
    "duracion_segundos" INTEGER,
    "mensaje_error" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "tokens_usados" INTEGER DEFAULT 0,
    "costo" NUMERIC(10,4) DEFAULT 0
);

COMMENT ON TABLE "logs_procesamiento" IS 'Logs de procesos de generación';

-- ==================================================
-- TABLA: configuraciones_regiones
-- ==================================================
CREATE TABLE IF NOT EXISTS "configuraciones_regiones" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "region" TEXT UNIQUE NOT NULL,
    "zona_horaria" TEXT DEFAULT 'America/Santiago',
    "clima_habilitado" BOOLEAN DEFAULT true,
    "proveedor_voz_default" TEXT DEFAULT 'local-tts',
    "voz_id_default" TEXT DEFAULT 'default',
    "fuentes_scraping" JSONB DEFAULT '[]',
    "frecuencia_anuncios" INTEGER DEFAULT 2,
    "max_noticias_por_reporte" INTEGER DEFAULT 10,
    "esta_activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "configuraciones_regiones" IS 'Configuraciones por región de Chile';

-- ==================================================
-- TABLA: cola_tareas
-- ==================================================
CREATE TABLE IF NOT EXISTS "cola_tareas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "tipo_tarea" TEXT NOT NULL CHECK (tipo_tarea IN ('generar_noticiero', 'scrapear_noticias', 'procesar_audio')),
    "prioridad" INTEGER DEFAULT 5 CHECK (prioridad BETWEEN 1 AND 10),
    "estado" TEXT DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'completado', 'fallido')),
    "payload" JSONB NOT NULL,
    "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "intentos" INTEGER DEFAULT 0,
    "max_intentos" INTEGER DEFAULT 3,
    "programado_para" TIMESTAMPTZ DEFAULT NOW(),
    "inicio" TIMESTAMPTZ,
    "fin" TIMESTAMPTZ,
    "mensaje_error" TEXT,
    "resultado" JSONB,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "cola_tareas" IS 'Cola de tareas asíncronas';

-- ==================================================
-- TABLA: voces_clonadas
-- (Futuro - para voice cloning con ElevenLabs/Azure)
-- ==================================================
CREATE TABLE IF NOT EXISTS "voces_clonadas" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "proveedor" TEXT NOT NULL,  -- elevenlabs, azure, local
    "voz_id" TEXT NOT NULL,
    "estado" TEXT DEFAULT 'entrenando' CHECK (estado IN ('entrenando', 'lista', 'fallida')),
    "archivos_entrenamiento" JSONB DEFAULT '[]',
    "puntuacion_calidad" NUMERIC(3,2),
    "veces_usada" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE "voces_clonadas" IS 'Voces clonadas para TTS personalizado';

-- ==================================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ==================================================

-- Users
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users"("email");
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users"("role");
CREATE INDEX IF NOT EXISTS "idx_users_is_active" ON "users"("is_active");

-- Auth tables
CREATE INDEX IF NOT EXISTS "idx_accounts_user_id" ON "accounts"("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions"("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_expires" ON "sessions"("expires");

-- Biblioteca Audio
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_tipo" ON "biblioteca_audio"("tipo");
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_user_id" ON "biblioteca_audio"("user_id");
CREATE INDEX IF NOT EXISTS "idx_biblioteca_audio_is_active" ON "biblioteca_audio"("is_active");

-- Plantillas
CREATE INDEX IF NOT EXISTS "idx_plantillas_user_id" ON "plantillas"("user_id");
CREATE INDEX IF NOT EXISTS "idx_plantillas_region" ON "plantillas"("region");

-- Programados
CREATE INDEX IF NOT EXISTS "idx_programados_user_id" ON "programados"("user_id");
CREATE INDEX IF NOT EXISTS "idx_programados_tipo" ON "programados"("tipo");
CREATE INDEX IF NOT EXISTS "idx_programados_esta_activo" ON "programados"("esta_activo");
CREATE INDEX IF NOT EXISTS "idx_programados_proxima_ejecucion" ON "programados"("proxima_ejecucion");

-- Fuentes y Radios
CREATE INDEX IF NOT EXISTS "idx_fuentes_final_nombre" ON "fuentes_final"("nombre");
CREATE INDEX IF NOT EXISTS "idx_radios_region" ON "radios"("region");

-- Noticieros
CREATE INDEX IF NOT EXISTS "idx_noticieros_user_id" ON "noticieros"("user_id");
CREATE INDEX IF NOT EXISTS "idx_noticieros_created_at" ON "noticieros"("created_at");
CREATE INDEX IF NOT EXISTS "idx_noticieros_estado" ON "noticieros"("estado");
CREATE INDEX IF NOT EXISTS "idx_noticieros_plantilla_id" ON "noticieros"("plantilla_id");

-- Noticias Scrapeadas
CREATE INDEX IF NOT EXISTS "idx_noticias_scrapeadas_fecha_publicacion" ON "noticias_scrapeadas"("fecha_publicacion");
CREATE INDEX IF NOT EXISTS "idx_noticias_scrapeadas_region" ON "noticias_scrapeadas"("region");
CREATE INDEX IF NOT EXISTS "idx_noticias_scrapeadas_categoria" ON "noticias_scrapeadas"("categoria");
CREATE INDEX IF NOT EXISTS "idx_noticias_scrapeadas_fue_procesada" ON "noticias_scrapeadas"("fue_procesada");

-- Uso Tokens
CREATE INDEX IF NOT EXISTS "idx_uso_tokens_user_id" ON "uso_tokens"("user_id");
CREATE INDEX IF NOT EXISTS "idx_uso_tokens_created_at" ON "uso_tokens"("created_at");
CREATE INDEX IF NOT EXISTS "idx_uso_tokens_servicio" ON "uso_tokens"("servicio");

-- Logs Procesamiento
CREATE INDEX IF NOT EXISTS "idx_logs_procesamiento_user_id" ON "logs_procesamiento"("user_id");
CREATE INDEX IF NOT EXISTS "idx_logs_procesamiento_noticiero_id" ON "logs_procesamiento"("noticiero_id");
CREATE INDEX IF NOT EXISTS "idx_logs_procesamiento_tipo_proceso" ON "logs_procesamiento"("tipo_proceso");
CREATE INDEX IF NOT EXISTS "idx_logs_procesamiento_estado" ON "logs_procesamiento"("estado");

-- Cola Tareas
CREATE INDEX IF NOT EXISTS "idx_cola_tareas_estado" ON "cola_tareas"("estado");
CREATE INDEX IF NOT EXISTS "idx_cola_tareas_tipo_tarea" ON "cola_tareas"("tipo_tarea");
CREATE INDEX IF NOT EXISTS "idx_cola_tareas_prioridad" ON "cola_tareas"("prioridad");
CREATE INDEX IF NOT EXISTS "idx_cola_tareas_programado_para" ON "cola_tareas"("programado_para");

-- Facturas
CREATE INDEX IF NOT EXISTS "idx_facturas_user_id" ON "facturas"("user_id");
CREATE INDEX IF NOT EXISTS "idx_facturas_estado" ON "facturas"("estado");
CREATE INDEX IF NOT EXISTS "idx_facturas_created_at" ON "facturas"("created_at");

-- Voces Clonadas
CREATE INDEX IF NOT EXISTS "idx_voces_clonadas_user_id" ON "voces_clonadas"("user_id");
CREATE INDEX IF NOT EXISTS "idx_voces_clonadas_estado" ON "voces_clonadas"("estado");
CREATE INDEX IF NOT EXISTS "idx_voces_clonadas_proveedor" ON "voces_clonadas"("proveedor");

-- ==================================================
-- TRIGGERS PARA UPDATED_AT
-- ==================================================

CREATE OR REPLACE FUNCTION actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON "users"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_biblioteca_audio_updated_at
    BEFORE UPDATE ON "biblioteca_audio"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_plantillas_updated_at
    BEFORE UPDATE ON "plantillas"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_programados_updated_at
    BEFORE UPDATE ON "programados"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_noticieros_updated_at
    BEFORE UPDATE ON "noticieros"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_campanas_publicitarias_updated_at
    BEFORE UPDATE ON "campanas_publicitarias"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_facturas_updated_at
    BEFORE UPDATE ON "facturas"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_configuraciones_regiones_updated_at
    BEFORE UPDATE ON "configuraciones_regiones"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

CREATE TRIGGER trigger_voces_clonadas_updated_at
    BEFORE UPDATE ON "voces_clonadas"
    FOR EACH ROW EXECUTE FUNCTION actualizar_updated_at();

-- ==================================================
-- ROW LEVEL SECURITY (RLS)
-- ==================================================

-- Habilitar RLS en todas las tablas
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "biblioteca_audio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plantillas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programados" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fuentes_final" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "radios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "noticieros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "noticias_scrapeadas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "campanas_publicitarias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "facturas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uso_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "metricas_diarias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "logs_procesamiento" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "configuraciones_regiones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cola_tareas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "voces_clonadas" ENABLE ROW LEVEL SECURITY;

-- Políticas permisivas (permitir todo a autenticados)
-- ⚠️ En producción, ajustar según necesidades de seguridad

CREATE POLICY "Acceso completo autenticados" ON "users" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "accounts" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "sessions" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "verification_tokens" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "biblioteca_audio" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "plantillas" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "programados" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "fuentes_final" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "radios" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "noticieros" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "noticias_scrapeadas" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "campanas_publicitarias" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "facturas" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "uso_tokens" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "metricas_diarias" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "logs_procesamiento" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "configuraciones_regiones" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "cola_tareas" FOR ALL USING (true);
CREATE POLICY "Acceso completo autenticados" ON "voces_clonadas" FOR ALL USING (true);

-- Políticas de lectura para anónimos (solo tablas públicas)
CREATE POLICY "Lectura anónimos" ON "biblioteca_audio" FOR SELECT USING (true);
CREATE POLICY "Lectura anónimos" ON "fuentes_final" FOR SELECT USING (true);
CREATE POLICY "Lectura anónimos" ON "radios" FOR SELECT USING (true);
CREATE POLICY "Lectura anónimos" ON "configuraciones_regiones" FOR SELECT USING (true);

-- ==================================================
-- VISTAS ÚTILES
-- ==================================================

-- Estadísticas de usuarios
CREATE OR REPLACE VIEW "estadisticas_usuarios" AS
SELECT 
    u.id,
    u.email,
    u.nombre_completo,
    u.role,
    u.created_at,
    COUNT(DISTINCT n.id) as total_noticieros,
    COUNT(DISTINCT p.id) as total_plantillas,
    COALESCE(SUM(ut.costo), 0) as costo_total
FROM "users" u
LEFT JOIN "noticieros" n ON u.id = n.user_id
LEFT JOIN "plantillas" p ON u.id = p.user_id
LEFT JOIN "uso_tokens" ut ON u.id = ut.user_id
GROUP BY u.id, u.email, u.nombre_completo, u.role, u.created_at;

COMMENT ON VIEW "estadisticas_usuarios" IS 'Resumen de actividad por usuario';

-- Noticias recientes
CREATE OR REPLACE VIEW "noticias_recientes" AS
SELECT 
    id,
    titulo,
    resumen,
    url,
    fuente,
    categoria,
    sentimiento,
    region,
    fecha_publicacion
FROM "noticias_scrapeadas"
WHERE fecha_publicacion >= NOW() - INTERVAL '7 days'
ORDER BY fecha_publicacion DESC;

COMMENT ON VIEW "noticias_recientes" IS 'Noticias de los últimos 7 días';

-- Métricas del sistema (últimos 30 días)
CREATE OR REPLACE VIEW "metricas_sistema" AS
SELECT 
    DATE_TRUNC('day', created_at) as fecha,
    COUNT(*) as noticieros_generados,
    SUM(costo_generacion) as costo_total,
    AVG(duracion_segundos) as duracion_promedio,
    COUNT(DISTINCT user_id) as usuarios_activos
FROM "noticieros"
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY fecha DESC;

COMMENT ON VIEW "metricas_sistema" IS 'Métricas agregadas por día (últimos 30 días)';

-- Tareas pendientes
CREATE OR REPLACE VIEW "tareas_pendientes" AS
SELECT 
    ct.*,
    u.nombre_completo as usuario
FROM "cola_tareas" ct
LEFT JOIN "users" u ON ct.user_id = u.id
WHERE ct.estado = 'pendiente'
ORDER BY ct.prioridad ASC, ct.programado_para ASC;

COMMENT ON VIEW "tareas_pendientes" IS 'Tareas en cola pendientes de ejecución';

-- ==================================================
-- DATOS INICIALES
-- ==================================================

-- Insertar regiones chilenas
INSERT INTO "configuraciones_regiones" ("region", "esta_activo") VALUES
('Arica y Parinacota', true),
('Tarapacá', true),
('Antofagasta', true),
('Atacama', true),
('Coquimbo', true),
('Valparaíso', true),
('Metropolitana de Santiago', true),
('O''Higgins', true),
('Maule', true),
('Ñuble', true),
('Biobío', true),
('La Araucanía', true),
('Los Ríos', true),
('Los Lagos', true),
('Aysén', true),
('Magallanes y Antártica Chilena', true),
('Nacional', true)
ON CONFLICT (region) DO NOTHING;

-- Usuario administrador de ejemplo
-- ⚠️ CAMBIAR PASSWORD EN PRODUCCIÓN
INSERT INTO "users" ("email", "password_hash", "nombre_completo", "role", "is_active") VALUES
('admin@vira.cl', '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW', 'Administrador VIRA', 'admin', true)
-- Password: "admin123" (hash bcrypt)
-- ⚠️ CAMBIAR EN PRODUCCIÓN con: SELECT crypt('nueva_password', gen_salt('bf'));
ON CONFLICT (email) DO NOTHING;

-- Voces de ejemplo para biblioteca
INSERT INTO "biblioteca_audio" ("nombre", "audio", "tipo", "genero", "idioma", "is_active") VALUES
('Voz Masculina Chilena', 'https://bbshnncbrpzahuckphtu.supabase.co/storage/v1/object/public/biblioteca_audio/f48ad3de.mp3', 'voz', 'masculino', 'español', true),
('Voz Femenina Chilena', 'https://bbshnncbrpzahuckphtu.supabase.co/storage/v1/object/public/biblioteca_audio/voice_female.mp3', 'voz', 'femenino', 'español', true)
ON CONFLICT (id) DO NOTHING;

-- Fuentes de noticias principales
INSERT INTO "fuentes_final" ("nombre", "nombre_fuente", "url", "rss_url") VALUES
('Nacional', 'Emol', 'https://www.emol.com', 'https://www.emol.com/rss/rss.asp'),
('Nacional', 'La Tercera', 'https://www.latercera.com', 'https://www.latercera.com/feed/'),
('Nacional', 'BioBioChile', 'https://www.biobiochile.cl', 'https://www.biobiochile.cl/especial/rss/index.xml')
ON CONFLICT DO NOTHING;

-- ==================================================
-- FUNCIONES ÚTILES
-- ==================================================

-- Función para obtener noticias por región
CREATE OR REPLACE FUNCTION obtener_noticias_region(nombre_region TEXT, limite INTEGER DEFAULT 10)
RETURNS TABLE(
    id UUID,
    titulo TEXT,
    resumen TEXT,
    url TEXT,
    fuente TEXT,
    fecha_publicacion TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ns.id,
        ns.titulo,
        ns.resumen,
        ns.url,
        ns.fuente,
        ns.fecha_publicacion
    FROM noticias_scrapeadas ns
    WHERE ns.region = nombre_region OR ns.region = 'Nacional'
    ORDER BY ns.fecha_publicacion DESC
    LIMIT limite;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION obtener_noticias_region IS 'Obtiene noticias de una región específica';

-- Función para calcular costo total de un usuario
CREATE OR REPLACE FUNCTION calcular_costo_usuario(usuario_id UUID)
RETURNS NUMERIC AS $$
BEGIN
    RETURN COALESCE(
        (SELECT SUM(costo) FROM uso_tokens WHERE user_id = usuario_id),
        0
    );
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calcular_costo_usuario IS 'Calcula el costo total acumulado de un usuario';

-- ==================================================
-- VERIFICACIÓN FINAL
-- ==================================================

DO $$
DECLARE
    tabla RECORD;
    contador INTEGER;
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '=== SCHEMA VIRA INSTALADO CORRECTAMENTE ===';
    RAISE NOTICE '';
    RAISE NOTICE 'Tablas creadas:';
    RAISE NOTICE '';
    
    FOR tabla IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name
    LOOP
        EXECUTE format('SELECT COUNT(*) FROM %I', tabla.table_name) INTO contador;
        RAISE NOTICE '  ✅ %-35s (%s registros)', tabla.table_name, contador;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '=== IMPORTANTE ===';
    RAISE NOTICE '1. Servidor TTS: Iniciar "python SistemTTS/app.py" en localhost:5000';
    RAISE NOTICE '2. Cambiar password admin en producción';
    RAISE NOTICE '3. Revisar políticas RLS según necesidades de seguridad';
    RAISE NOTICE '';
END $$;

-- ==================================================
-- FIN DEL SCHEMA UNIFICADO
-- ==================================================
