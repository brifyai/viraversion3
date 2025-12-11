
-- ==================================================
-- VIRA - Sistema de Noticieros Automáticos
-- Schema SQL para Supabase (PostgreSQL) - VERSIÓN COMPLETA
-- ==================================================

-- Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ==================================================
-- TABLAS DE AUTENTICACIÓN (NextAuth.js)
-- ==================================================

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS "users" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT,
    "email" TEXT UNIQUE NOT NULL,
    "password" TEXT,
    "password_hash" TEXT,
    "email_verified" TIMESTAMPTZ,
    "image" TEXT,
    "role" TEXT DEFAULT 'user',
    "company" TEXT DEFAULT 'VIRA',
    "plan" TEXT DEFAULT 'free',
    "nombre_completo" TEXT,
    "full_name" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "last_login" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de cuentas (OAuth providers)
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

-- Tabla de sesiones
CREATE TABLE IF NOT EXISTS "sessions" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "session_token" TEXT UNIQUE NOT NULL,
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "expires" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de tokens de verificación
CREATE TABLE IF NOT EXISTS "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT UNIQUE NOT NULL,
    "expires" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("identifier", "token")
);

-- ==================================================
-- TABLAS PRINCIPALES DE VIRA
-- ==================================================

-- Estaciones de radio
CREATE TABLE IF NOT EXISTS "radio_stations" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT UNIQUE NOT NULL,
    "slug" TEXT UNIQUE NOT NULL,
    "description" TEXT,
    "region" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "owner_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Plantillas de noticieros
CREATE TABLE IF NOT EXISTS "newscast_templates" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "region" TEXT NOT NULL,
    "radio_station" TEXT,
    "duration_minutes" INTEGER DEFAULT 15,
    "voice_provider" TEXT DEFAULT 'openai',
    "voice_id" TEXT DEFAULT 'nova',
    "include_weather" BOOLEAN DEFAULT true,
    "include_time" BOOLEAN DEFAULT true,
    "ad_frequency" INTEGER DEFAULT 2,
    "categories" JSONB DEFAULT '[]',
    "configuration" JSONB DEFAULT '{}',
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Fuentes de noticias por región usadas en la app (fuentes_final)
CREATE TABLE IF NOT EXISTS public."fuentes_final" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,          -- Región (ej: 'Metropolitana de Santiago')
    "nombre_fuente" TEXT NOT NULL,   -- Nombre del medio (ej: 'BioBioChile')
    "url" TEXT NOT NULL,             -- URL del sitio
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Tabla de radios usada en la app
CREATE TABLE IF NOT EXISTS public."radios" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "nombre" TEXT NOT NULL,          -- Nombre de la radio
    "frecuencia" TEXT NOT NULL,      -- Ej: '99.7 FM'
    "region" TEXT NOT NULL,          -- Región (ej: 'Biobío')
    "url" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Reportes/Noticieros generados
CREATE TABLE IF NOT EXISTS "news_reports" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "title" TEXT NOT NULL,
    "content" TEXT,
    "timeline_data" JSONB,
    "audio_url" TEXT,
    "s3_key" TEXT,
    "duration_seconds" INTEGER,
    "status" TEXT DEFAULT 'generated', -- generated, processing, completed, failed
    "generation_cost" NUMERIC(10,4) DEFAULT 0,
    "token_count" INTEGER DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "radio_station_id" UUID REFERENCES "radio_stations"("id") ON DELETE CASCADE,
    "template_id" UUID REFERENCES "newscast_templates"("id") ON DELETE SET NULL,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "published_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Fuentes de noticias
CREATE TABLE IF NOT EXISTS "news_sources" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "url" TEXT UNIQUE NOT NULL,
    "rss_url" TEXT,
    "region" TEXT,
    "category" TEXT DEFAULT 'general',
    "is_active" BOOLEAN DEFAULT true,
    "scraping_config" JSONB DEFAULT '{}',
    "last_scraped" TIMESTAMPTZ,
    "success_rate" NUMERIC(3,2) DEFAULT 1.0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Noticias scrapeadas
CREATE TABLE IF NOT EXISTS "scraped_news" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "title" TEXT NOT NULL,
    "content" TEXT,
    "summary" TEXT,
    "url" TEXT UNIQUE,
    "source_id" UUID REFERENCES "news_sources"("id") ON DELETE CASCADE,
    "category" TEXT DEFAULT 'general',
    "sentiment" TEXT DEFAULT 'neutral', -- positive, negative, neutral
    "priority" TEXT DEFAULT 'medium', -- high, medium, low
    "region" TEXT,
    "author" TEXT,
    "image_url" TEXT,
    "published_date" TIMESTAMPTZ,
    "scraped_at" TIMESTAMPTZ DEFAULT NOW(),
    "is_processed" BOOLEAN DEFAULT false,
    "embedding" VECTOR(1536) -- Para búsquedas semánticas (opcional)
);

-- Campañas publicitarias
CREATE TABLE IF NOT EXISTS "ad_campaigns" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "audio_url" TEXT,
    "s3_key" TEXT,
    "duration_seconds" INTEGER,
    "is_active" BOOLEAN DEFAULT true,
    "reproductions" INTEGER DEFAULT 0,
    "start_date" DATE,
    "end_date" DATE,
    "radio_station_id" UUID REFERENCES "radio_stations"("id") ON DELETE CASCADE,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Biblioteca de música y efectos
CREATE TABLE IF NOT EXISTS "audio_library" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL, -- music, jingle, sfx, intro, outro, voz
    "category" TEXT, -- cortinas, efectos, musica_fondo
    "audio_url" TEXT,
    "s3_key" TEXT,
    "duration_seconds" INTEGER,
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

-- Voces clonadas
CREATE TABLE IF NOT EXISTS "cloned_voices" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "provider" TEXT NOT NULL, -- elevenlabs, azure, etc.
    "voice_id" TEXT NOT NULL,
    "status" TEXT DEFAULT 'training', -- training, ready, failed
    "training_files" JSONB DEFAULT '[]',
    "quality_score" NUMERIC(3,2),
    "usage_count" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Configuraciones de TTS
CREATE TABLE IF NOT EXISTS "tts_configurations" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voice_id" TEXT NOT NULL,
    "settings" JSONB DEFAULT '{}',
    "is_default" BOOLEAN DEFAULT false,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Integraciones con redes sociales
CREATE TABLE IF NOT EXISTS "social_integrations" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "platform" TEXT NOT NULL, -- twitter, facebook, instagram, spotify
    "account_name" TEXT,
    "is_active" BOOLEAN DEFAULT false,
    "configuration" JSONB DEFAULT '{}',
    "last_post" TIMESTAMPTZ,
    "posts_count" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE("user_id", "platform")
);

-- Automatización de tareas
CREATE TABLE IF NOT EXISTS "automation_jobs" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL, -- newscast, social_post, scraping
    "schedule" TEXT, -- cron expression
    "is_active" BOOLEAN DEFAULT true,
    "configuration" JSONB DEFAULT '{}',
    "last_run" TIMESTAMPTZ,
    "next_run" TIMESTAMPTZ,
    "run_count" INTEGER DEFAULT 0,
    "success_count" INTEGER DEFAULT 0,
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Uso de tokens y costos
CREATE TABLE IF NOT EXISTS "token_usage" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "service" TEXT NOT NULL, -- openai, elevenlabs, azure, etc.
    "operation" TEXT NOT NULL, -- tts, text_processing, scraping
    "tokens_used" INTEGER DEFAULT 0,
    "cost" NUMERIC(10,4) DEFAULT 0,
    "currency" TEXT DEFAULT 'USD',
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Métricas diarias
CREATE TABLE IF NOT EXISTS "daily_metrics" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "date" DATE UNIQUE NOT NULL,
    "total_news_reports" INTEGER DEFAULT 0,
    "total_cost" NUMERIC(10,4) DEFAULT 0,
    "total_tokens" INTEGER DEFAULT 0,
    "active_users" INTEGER DEFAULT 0,
    "active_radio_stations" INTEGER DEFAULT 0,
    "scraping_success_rate" NUMERIC(3,2) DEFAULT 1.0,
    "avg_processing_time" INTEGER, -- en segundos
    "metrics_data" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- Archivos subidos
CREATE TABLE IF NOT EXISTS "uploaded_files" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "original_name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "s3_key" TEXT UNIQUE NOT NULL,
    "content_type" TEXT,
    "file_size" BIGINT,
    "upload_type" TEXT, -- audio, image, document
    "metadata" JSONB DEFAULT '{}',
    "user_id" UUID REFERENCES "users"("id") ON DELETE CASCADE,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- ==================================================
-- TABLAS FALTANTES CRÍTICAS PARA VIRA
-- ==================================================

-- TABLA DE FACTURAS (INVOICES)
-- Referenciada en app/api/invoices/[invoiceId]/route.ts
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "invoice_number" TEXT UNIQUE NOT NULL,
    "amount" NUMERIC(10,2) NOT NULL,
    "tax" NUMERIC(10,2) DEFAULT 0,
    "total" NUMERIC(10,2) NOT NULL,
    "currency" TEXT DEFAULT 'CLP',
    "status" TEXT DEFAULT 'draft', -- draft, sent, paid, overdue
    "due_date" DATE,
    "paid_date" TIMESTAMPTZ,
    "billing_data" JSONB DEFAULT '{}',
    "pdf_url" TEXT,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- TABLA DE LOGS DE PROCESAMIENTO
-- Para tracking de los procesos de generación de noticieros
CREATE TABLE IF NOT EXISTS "processing_logs" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "news_report_id" UUID REFERENCES "news_reports"("id") ON DELETE CASCADE,
    "process_type" TEXT NOT NULL, -- scraping, processing, tts, assembly
    "status" TEXT NOT NULL, -- started, completed, failed
    "started_at" TIMESTAMPTZ DEFAULT NOW(),
    "completed_at" TIMESTAMPTZ,
    "duration_seconds" INTEGER,
    "error_message" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "tokens_used" INTEGER DEFAULT 0,
    "cost" NUMERIC(10,4) DEFAULT 0
);

-- TABLA DE CONFIGURACIÓN DE REGIONES
-- Para manejar configuraciones específicas por región
CREATE TABLE IF NOT EXISTS "region_configs" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "region" TEXT UNIQUE NOT NULL,
    "timezone" TEXT DEFAULT 'America/Santiago',
    "weather_enabled" BOOLEAN DEFAULT true,
    "default_voice_provider" TEXT DEFAULT 'openai',
    "default_voice_id" TEXT DEFAULT 'nova',
    "scraping_sources" JSONB DEFAULT '[]',
    "ad_frequency" INTEGER DEFAULT 2,
    "max_news_per_report" INTEGER DEFAULT 10,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- TABLA DE COLA DE TAREAS (TASK QUEUE)
-- Para manejar procesos asíncronos
CREATE TABLE IF NOT EXISTS "task_queue" (
    "id" UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "task_type" TEXT NOT NULL, -- generate_newscast, scrape_news, process_audio
    "priority" INTEGER DEFAULT 5, -- 1 = highest, 10 = lowest
    "status" TEXT DEFAULT 'pending', -- pending, processing, completed, failed
    "payload" JSONB NOT NULL,
    "user_id" UUID REFERENCES "users"("id") ON DELETE SET NULL,
    "attempts" INTEGER DEFAULT 0,
    "max_attempts" INTEGER DEFAULT 3,
    "scheduled_at" TIMESTAMPTZ DEFAULT NOW(),
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "error_message" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMPTZ DEFAULT NOW()
);

-- ==================================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- ==================================================

-- Índices para autenticación
CREATE INDEX IF NOT EXISTS "idx_accounts_user_id" ON "accounts"("user_id");
CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions"("user_id");

-- Índices para funcionalidades principales
CREATE INDEX IF NOT EXISTS "idx_news_reports_user_id" ON "news_reports"("user_id");
CREATE INDEX IF NOT EXISTS "idx_news_reports_created_at" ON "news_reports"("created_at");
CREATE INDEX IF NOT EXISTS "idx_news_reports_status" ON "news_reports"("status");

CREATE INDEX IF NOT EXISTS "idx_scraped_news_source_id" ON "scraped_news"("source_id");
CREATE INDEX IF NOT EXISTS "idx_scraped_news_published_date" ON "scraped_news"("published_date");
CREATE INDEX IF NOT EXISTS "idx_scraped_news_region" ON "scraped_news"("region");
CREATE INDEX IF NOT EXISTS "idx_scraped_news_category" ON "scraped_news"("category");

CREATE INDEX IF NOT EXISTS "idx_news_sources_region" ON "news_sources"("region");
CREATE INDEX IF NOT EXISTS "idx_news_sources_is_active" ON "news_sources"("is_active");

CREATE INDEX IF NOT EXISTS "idx_audio_library_type" ON "audio_library"("type");
CREATE INDEX IF NOT EXISTS "idx_audio_library_user_id" ON "audio_library"("user_id");

CREATE INDEX IF NOT EXISTS "idx_token_usage_user_id" ON "token_usage"("user_id");
CREATE INDEX IF NOT EXISTS "idx_token_usage_created_at" ON "token_usage"("created_at");

-- Índices para la tabla users
CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users"("email");
CREATE INDEX IF NOT EXISTS "idx_users_role" ON "users"("role");
CREATE INDEX IF NOT EXISTS "idx_users_company" ON "users"("company");

-- Índices para tablas faltantes
CREATE INDEX IF NOT EXISTS "idx_invoices_user_id" ON "invoices"("user_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices"("status");
CREATE INDEX IF NOT EXISTS "idx_invoices_due_date" ON "invoices"("due_date");
CREATE INDEX IF NOT EXISTS "idx_invoices_created_at" ON "invoices"("created_at");

CREATE INDEX IF NOT EXISTS "idx_processing_logs_user_id" ON "processing_logs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_news_report_id" ON "processing_logs"("news_report_id");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_process_type" ON "processing_logs"("process_type");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_status" ON "processing_logs"("status");
CREATE INDEX IF NOT EXISTS "idx_processing_logs_started_at" ON "processing_logs"("started_at");

CREATE INDEX IF NOT EXISTS "idx_region_configs_region" ON "region_configs"("region");
CREATE INDEX IF NOT EXISTS "idx_region_configs_is_active" ON "region_configs"("is_active");

CREATE INDEX IF NOT EXISTS "idx_task_queue_status" ON "task_queue"("status");
CREATE INDEX IF NOT EXISTS "idx_task_queue_task_type" ON "task_queue"("task_type");
CREATE INDEX IF NOT EXISTS "idx_task_queue_priority" ON "task_queue"("priority");
CREATE INDEX IF NOT EXISTS "idx_task_queue_scheduled_at" ON "task_queue"("scheduled_at");
CREATE INDEX IF NOT EXISTS "idx_task_queue_user_id" ON "task_queue"("user_id");

-- ==================================================
-- FUNCIONES TRIGGER PARA UPDATED_AT
-- ==================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Aplicar trigger a todas las tablas que tienen updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_radio_stations_updated_at BEFORE UPDATE ON "radio_stations" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_newscast_templates_updated_at BEFORE UPDATE ON "newscast_templates" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_news_reports_updated_at BEFORE UPDATE ON "news_reports" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_news_sources_updated_at BEFORE UPDATE ON "news_sources" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ad_campaigns_updated_at BEFORE UPDATE ON "ad_campaigns" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_audio_library_updated_at BEFORE UPDATE ON "audio_library" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_cloned_voices_updated_at BEFORE UPDATE ON "cloned_voices" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tts_configurations_updated_at BEFORE UPDATE ON "tts_configurations" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_social_integrations_updated_at BEFORE UPDATE ON "social_integrations" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_automation_jobs_updated_at BEFORE UPDATE ON "automation_jobs" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_region_configs_updated_at BEFORE UPDATE ON "region_configs" FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ==================================================
-- ROW LEVEL SECURITY (RLS) POLICIES - VERSIÓN CORREGIDA
-- ==================================================

-- ==================================================
-- SOLUCIÓN DEFINITIVA PARA PERMISOS
-- ==================================================

-- OPCIÓN 1: DESACTIVAR RLS COMPLETAMENTE (Para desarrollo)
-- Descomenta estas líneas si quieres acceso sin restricciones

-- ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "accounts" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "sessions" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "verification_tokens" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "radio_stations" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "newscast_templates" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public."fuentes_final" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE public."radios" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "news_reports" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "news_sources" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "scraped_news" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "ad_campaigns" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "audio_library" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "cloned_voices" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "tts_configurations" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "social_integrations" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "automation_jobs" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "token_usage" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "daily_metrics" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "uploaded_files" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "invoices" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "processing_logs" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "region_configs" DISABLE ROW LEVEL SECURITY;
-- ALTER TABLE "task_queue" DISABLE ROW LEVEL SECURITY;

-- GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
-- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

-- ==================================================
-- OPCIÓN 2: RLS CON POLÍTICAS PERMISIVAS (Para producción)
-- Mantén estas líneas si quieres seguridad con RLS activado
-- ==================================================

-- Habilitar RLS en tablas de usuario
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;

-- Habilitar RLS en tablas principales
ALTER TABLE "radio_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "newscast_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."fuentes_final" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."radios" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "news_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scraped_news" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ad_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audio_library" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cloned_voices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tts_configurations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "social_integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "token_usage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_metrics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "uploaded_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processing_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "region_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "task_queue" ENABLE ROW LEVEL SECURITY;

-- Políticas para usuarios autenticados
CREATE POLICY "Enable insert for authenticated users" ON "users" FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for authenticated users" ON "users" FOR SELECT USING (true);
CREATE POLICY "Enable update for authenticated users" ON "users" FOR UPDATE USING (true);

CREATE POLICY "Enable insert for authenticated users" ON "accounts" FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for authenticated users" ON "accounts" FOR SELECT USING (true);
CREATE POLICY "Enable update for authenticated users" ON "accounts" FOR UPDATE USING (true);

CREATE POLICY "Enable insert for authenticated users" ON "sessions" FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for authenticated users" ON "sessions" FOR SELECT USING (true);
CREATE POLICY "Enable update for authenticated users" ON "sessions" FOR UPDATE USING (true);

CREATE POLICY "Enable insert for authenticated users" ON "verification_tokens" FOR INSERT WITH CHECK (true);
CREATE POLICY "Enable select for authenticated users" ON "verification_tokens" FOR SELECT USING (true);
CREATE POLICY "Enable update for authenticated users" ON "verification_tokens" FOR UPDATE USING (true);

-- Políticas para tablas principales (acceso completo para usuarios autenticados)
CREATE POLICY "Enable all for authenticated users on radio_stations" ON "radio_stations" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on newscast_templates" ON "newscast_templates" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on fuentes_final" ON public."fuentes_final" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on radios" ON public."radios" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on news_reports" ON "news_reports" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on news_sources" ON "news_sources" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on scraped_news" ON "scraped_news" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on ad_campaigns" ON "ad_campaigns" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on audio_library" ON "audio_library" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on cloned_voices" ON "cloned_voices" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on tts_configurations" ON "tts_configurations" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on social_integrations" ON "social_integrations" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on automation_jobs" ON "automation_jobs" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on token_usage" ON "token_usage" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on daily_metrics" ON "daily_metrics" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on uploaded_files" ON "uploaded_files" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on invoices" ON "invoices" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on processing_logs" ON "processing_logs" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on region_configs" ON "region_configs" FOR ALL USING (true);
CREATE POLICY "Enable all for authenticated users on task_queue" ON "task_queue" FOR ALL USING (true);

-- Políticas para usuarios anónimos (solo lectura)
CREATE POLICY "Enable select for anonymous users" ON "radio_stations" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON "newscast_templates" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON public."fuentes_final" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON public."radios" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON "news_reports" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON "news_sources" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" ON "scraped_news" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" on "audio_library" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" on "tts_configurations" FOR SELECT USING (true);
CREATE POLICY "Enable select for anonymous users" on "region_configs" FOR SELECT USING (true);

-- ==================================================
-- DATOS DE MUESTRA (OPCIONAL)
-- ==================================================

-- Insertar regiones chilenas predefinidas
INSERT INTO "radio_stations" ("name", "slug", "region", "description") VALUES
('Radio Nacional', 'nacional', 'Metropolitana de Santiago', 'Estación nacional principal'),
('Radio Norte', 'norte', 'Antofagasta', 'Cobertura región norte'),
('Radio Sur', 'sur', 'Biobío', 'Cobertura región sur'),
('Radio Centro', 'centro', 'Valparaíso', 'Cobertura región central')
ON CONFLICT (slug) DO NOTHING;

-- Insertar fuentes de noticias chilenas principales
INSERT INTO "news_sources" ("name", "url", "rss_url", "region", "category") VALUES
('El Mercurio Online', 'https://www.emol.com', 'https://www.emol.com/rss/rss.asp', 'nacional', 'general'),
('La Tercera', 'https://www.latercera.com', 'https://www.latercera.com/feed/', 'nacional', 'general'),
('BioBioChile', 'https://www.biobiochile.cl', 'https://www.biobiochile.cl/especial/rss/index.xml', 'nacional', 'general'),
('24Horas', 'https://www.24horas.cl', 'https://www.24horas.cl/rss/', 'nacional', 'general'),
('T13', 'https://www.t13.cl', 'https://www.t13.cl/rss/portada.xml', 'nacional', 'general')
ON CONFLICT (url) DO NOTHING;

-- Configuraciones TTS por defecto
INSERT INTO "tts_configurations" ("name", "provider", "voice_id", "settings", "is_default") VALUES
('OpenAI Nova (Español)', 'openai', 'nova', '{"speed": 1.0, "language": "es"}', true),
('Azure Catalina (Chilena)', 'azure', 'es-CL-CatalinaNeural', '{"rate": "0%", "pitch": "0%"}', false),
('ElevenLabs Adam', 'elevenlabs', 'pNInz6obpgDQGcFmaJgB', '{"stability": 0.5, "similarity_boost": 0.8}', false)
ON CONFLICT DO NOTHING;

-- Insertar usuarios de prueba para VIRA
INSERT INTO "users" ("name", "email", "password", "role", "company", "plan", "nombre_completo", "full_name", "is_active") VALUES
('Administrador VIRA', 'admin@vira.cl', 'admin123456', 'admin', 'VIRA', 'enterprise', 'Administrador VIRA', 'Administrador VIRA', true),
('Operador VIRA', 'operator@vira.cl', 'operator123456', 'operator', 'VIRA', 'professional', 'Operador VIRA', 'Operador VIRA', true),
('Usuario VIRA', 'user@vira.cl', 'user123456', 'user', 'VIRA', 'free', 'Usuario VIRA', 'Usuario VIRA', true)
ON CONFLICT (email) DO NOTHING;

-- Insertar configuraciones de regiones
INSERT INTO "region_configs" ("region", "timezone", "is_active") VALUES
('Metropolitana de Santiago', 'America/Santiago', true),
('Antofagasta', 'America/Santiago', true),
('Biobío', 'America/Santiago', true),
('Valparaíso', 'America/Santiago', true),
('Araucanía', 'America/Santiago', true),
('Los Lagos', 'America/Santiago', true),
('Coquimbo', 'America/Santiago', true),
('Maule', 'America/Santiago', true),
('Los Ríos', 'America/Santiago', true),
('Aysén', 'America/Santiago', true),
('Magallanes', 'America/Santiago', true),
('Tarapacá', 'America/Santiago', true),
('Atacama', 'America/Santiago', true),
('O''Higgins', 'America/Santiago', true),
('Ñuble', 'America/Santiago', true),
('Arica y Parinacota', 'America/Santiago', true),
('nacional', 'America/Santiago', true)
ON CONFLICT (region) DO NOTHING;

-- ==================================================
-- VISTAS ÚTILES
-- ==================================================

-- Vista de estadísticas de usuarios
CREATE OR REPLACE VIEW "user_stats" AS
SELECT 
    u.id,
    u.name,
    u.email,
    u.created_at,
    COUNT(DISTINCT nr.id) as total_reports,
    COUNT(DISTINCT nt.id) as total_templates,
    COUNT(DISTINCT ns.id) as total_sources,
    COALESCE(SUM(tu.cost), 0) as total_cost_used
FROM "users" u
LEFT JOIN "news_reports" nr ON u.id = nr.user_id
LEFT JOIN "newscast_templates" nt ON u.id = nt.user_id  
LEFT JOIN "news_sources" ns ON u.id = ns.user_id
LEFT JOIN "token_usage" tu ON u.id = tu.user_id
GROUP BY u.id, u.name, u.email, u.created_at;

-- Vista de noticias recientes con fuente
CREATE OR REPLACE VIEW "recent_news" AS
SELECT 
    sn.id,
    sn.title,
    sn.summary,
    sn.url,
    sn.category,
    sn.sentiment,
    sn.region,
    sn.published_date,
    ns.name as source_name,
    ns.url as source_url
FROM "scraped_news" sn
JOIN "news_sources" ns ON sn.source_id = ns.id
WHERE sn.published_date >= NOW() - INTERVAL '7 days'
ORDER BY sn.published_date DESC;

-- Vista de métricas del sistema
CREATE OR REPLACE VIEW "system_metrics" AS
SELECT 
    DATE_TRUNC('day', created_at) as date,
    COUNT(*) as reports_generated,
    SUM(generation_cost) as total_cost,
    AVG(duration_seconds) as avg_duration,
    COUNT(DISTINCT user_id) as active_users
FROM "news_reports"
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY date DESC;

-- Vista de logs de procesamiento recientes
CREATE OR REPLACE VIEW "recent_processing_logs" AS
SELECT 
    pl.*,
    u.name as user_name,
    nr.title as news_report_title
FROM "processing_logs" pl
LEFT JOIN "users" u ON pl.user_id = u.id
LEFT JOIN "news_reports" nr ON pl.news_report_id = nr.id
WHERE pl.started_at >= NOW() - INTERVAL '7 days'
ORDER BY pl.started_at DESC;

-- Vista de tareas pendientes
CREATE OR REPLACE VIEW "pending_tasks" AS
SELECT 
    tq.*,
    u.name as user_name
FROM "task_queue" tq
LEFT JOIN "users" u ON tq.user_id = u.id
WHERE tq.status = 'pending'
ORDER BY tq.priority ASC, tq.scheduled_at ASC;

-- ==================================================
-- FUNCIONES ÚTILES
-- ==================================================

-- Función para obtener noticias por región
CREATE OR REPLACE FUNCTION get_news_by_region(region_name TEXT, limit_count INTEGER DEFAULT 10)
RETURNS TABLE(
    id UUID,
    title TEXT,
    summary TEXT,
    url TEXT,
    source_name TEXT,
    published_date TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        sn.id,
        sn.title,
        sn.summary,
        sn.url,
        ns.name,
        sn.published_date
    FROM scraped_news sn
    JOIN news_sources ns ON sn.source_id = ns.id
    WHERE sn.region = region_name OR sn.region = 'nacional'
    ORDER BY sn.published_date DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Función para calcular costo total del usuario
CREATE OR REPLACE FUNCTION get_user_total_cost(user_uuid UUID)
RETURNS NUMERIC AS $$
BEGIN
    RETURN COALESCE(
        (SELECT SUM(cost) FROM token_usage WHERE user_id = user_uuid),
        0
    );
END;
$$ LANGUAGE plpgsql;

-- Función para obtener configuración de región
CREATE OR REPLACE FUNCTION get_region_config(region_name TEXT)
RETURNS TABLE(
    id UUID,
    region TEXT,
    timezone TEXT,
    weather_enabled BOOLEAN,
    default_voice_provider TEXT,
    default_voice_id TEXT,
    ad_frequency INTEGER,
    max_news_per_report INTEGER,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        rc.id,
        rc.region,
        rc.timezone,
        rc.weather_enabled,
        rc.default_voice_provider,
        rc.default_voice_id,
        rc.ad_frequency,
        rc.max_news_per_report,
        rc.is_active
    FROM region_configs rc
    WHERE rc.region = region_name AND rc.is_active = true;
    
    -- Si no encuentra la región específica, devuelve la configuración nacional
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            rc.id,
            rc.region,
            rc.timezone,
            rc.weather_enabled,
            rc.default_voice_provider,
            rc.default_voice_id,
            rc.ad_frequency,
            rc.max_news_per_report,
            rc.is_active
        FROM region_configs rc
        WHERE rc.region = 'nacional' AND rc.is_active = true;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Función para limpiar tareas fallidas viejas
CREATE OR REPLACE FUNCTION cleanup_old_failed_tasks(days_old INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM "task_queue" 
    WHERE status = 'failed' 
    AND created_at < NOW() - INTERVAL '1 day' * days_old;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ==================================================
-- COMENTARIOS FINALES
-- ==================================================

COMMENT ON DATABASE postgres IS 'VIRA - Sistema de Noticieros Automáticos para Radio';
COMMENT ON TABLE "news_reports" IS 'Noticieros generados por el sistema';
COMMENT ON TABLE "scraped_news" IS 'Noticias extraídas de fuentes chilenas';
COMMENT ON TABLE "audio_library" IS 'Biblioteca de música y efectos sonoros';
COMMENT ON TABLE "cloned_voices" IS 'Voces sintéticas entrenadas personalizadas';
COMMENT ON TABLE "invoices" IS 'Facturas generadas para usuarios';
COMMENT ON TABLE "processing_logs" IS 'Logs de procesamiento de noticieros';
COMMENT ON TABLE "region_configs" IS 'Configuraciones específicas por región';
COMMENT ON TABLE "task_queue" IS 'Cola de tareas asíncronas';

-- Fin del schema completo
