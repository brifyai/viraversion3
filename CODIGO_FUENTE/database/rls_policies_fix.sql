-- ==================================================
-- VIRA - Políticas RLS Corregidas
-- ==================================================
-- Ejecutar en Supabase SQL Editor DESPUÉS de migrar usuarios
-- ==================================================

-- Primero, eliminar las políticas permisivas existentes
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "users";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "biblioteca_audio";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "plantillas";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "programados";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "fuentes_final";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "radios";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "noticieros";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "noticias_scrapeadas";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "campanas_publicitarias";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "facturas";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "uso_tokens";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "metricas_diarias";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "logs_procesamiento";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "configuraciones_regiones";
DROP POLICY IF EXISTS "Acceso completo para autenticados" ON "cola_tareas";

-- Eliminar también las políticas de lectura para anónimos
DROP POLICY IF EXISTS "Lectura para anónimos" ON "biblioteca_audio";
DROP POLICY IF EXISTS "Lectura para anónimos" ON "fuentes_final";
DROP POLICY IF EXISTS "Lectura para anónimos" ON "radios";
DROP POLICY IF EXISTS "Lectura para anónimos" ON "configuraciones_regiones";

-- ==================================================
-- POLÍTICAS PARA TABLA: users
-- ==================================================
-- Usuario puede ver y editar su propio perfil
CREATE POLICY "users_self_select" ON "users"
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_self_update" ON "users"
  FOR UPDATE USING (auth.uid() = id);

-- Admin puede ver todos los usuarios
CREATE POLICY "users_admin_all" ON "users"
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ==================================================
-- POLÍTICAS PARA TABLA: noticieros
-- ==================================================
CREATE POLICY "noticieros_owner_all" ON "noticieros"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: biblioteca_audio
-- ==================================================
CREATE POLICY "biblioteca_audio_owner_all" ON "biblioteca_audio"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: plantillas
-- ==================================================
CREATE POLICY "plantillas_owner_all" ON "plantillas"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: programados
-- ==================================================
CREATE POLICY "programados_owner_all" ON "programados"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: campanas_publicitarias
-- ==================================================
CREATE POLICY "campanas_owner_all" ON "campanas_publicitarias"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: facturas
-- ==================================================
CREATE POLICY "facturas_owner_all" ON "facturas"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- POLÍTICAS PARA TABLA: uso_tokens
-- ==================================================
CREATE POLICY "uso_tokens_owner_select" ON "uso_tokens"
  FOR SELECT USING (user_id = auth.uid());

-- Admin puede ver todos
CREATE POLICY "uso_tokens_admin_all" ON "uso_tokens"
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ==================================================
-- POLÍTICAS PARA TABLA: logs_procesamiento
-- ==================================================
CREATE POLICY "logs_owner_select" ON "logs_procesamiento"
  FOR SELECT USING (user_id = auth.uid());

-- Admin puede ver todos
CREATE POLICY "logs_admin_all" ON "logs_procesamiento"
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ==================================================
-- POLÍTICAS PARA TABLA: cola_tareas
-- ==================================================
CREATE POLICY "cola_tareas_owner_all" ON "cola_tareas"
  FOR ALL USING (user_id = auth.uid());

-- ==================================================
-- TABLAS PÚBLICAS (solo lectura para todos)
-- ==================================================
CREATE POLICY "configuraciones_regiones_public_read" ON "configuraciones_regiones"
  FOR SELECT USING (true);

CREATE POLICY "fuentes_final_public_read" ON "fuentes_final"
  FOR SELECT USING (true);

CREATE POLICY "radios_public_read" ON "radios"
  FOR SELECT USING (true);

-- Noticias scrapeadas son públicas para lectura
CREATE POLICY "noticias_scrapeadas_public_read" ON "noticias_scrapeadas"
  FOR SELECT USING (true);

-- ==================================================
-- POLÍTICAS PARA TABLA: metricas_diarias (solo admin)
-- ==================================================
CREATE POLICY "metricas_admin_all" ON "metricas_diarias"
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- ==================================================
-- FIN DE POLÍTICAS RLS
-- ==================================================
