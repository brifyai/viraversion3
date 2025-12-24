-- ============================================================
-- TABLA: finalize_jobs
-- Rastrea el estado de la generación de audio de noticieros
-- ============================================================

CREATE TABLE IF NOT EXISTS finalize_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    newscast_id UUID NOT NULL REFERENCES noticieros(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    progress_message TEXT DEFAULT 'Job creado, esperando procesamiento...',
    duration INTEGER DEFAULT NULL,
    config JSONB DEFAULT '{}',
    error TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ DEFAULT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_finalize_jobs_user ON finalize_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_finalize_jobs_newscast ON finalize_jobs(newscast_id);
CREATE INDEX IF NOT EXISTS idx_finalize_jobs_status ON finalize_jobs(status);

-- Habilitar Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE finalize_jobs;
ALTER TABLE finalize_jobs REPLICA IDENTITY FULL;

-- También habilitar REPLICA IDENTITY FULL para newscast_jobs
ALTER TABLE newscast_jobs REPLICA IDENTITY FULL;
ALTER TABLE scraping_jobs REPLICA IDENTITY FULL;

-- Permisos RLS
ALTER TABLE finalize_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own finalize jobs" ON finalize_jobs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own finalize jobs" ON finalize_jobs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can update finalize jobs" ON finalize_jobs
    FOR UPDATE USING (true);
