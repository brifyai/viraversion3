# 🧪 Suite de Tests - Sistema VIRA

## 📋 Índice de Tests

1. [Test de Scraping](#1-test-de-scraping)
2. [Test de Generación de Noticieros](#2-test-de-generación-de-noticieros)
3. [Test de Generación de Audio (TTS)](#3-test-de-generación-de-audio-tts)
4. [Test de Ensamblaje de Audio](#4-test-de-ensamblaje-de-audio)
5. [Test de Automatización (Cron)](#5-test-de-automatización-cron)
6. [Test de Base de Datos](#6-test-de-base-de-datos)
7. [Test de Integración End-to-End](#7-test-de-integración-end-to-end)

---

## 1. Test de Scraping

### 1.1 Test Manual de Scraping

```bash
# Test básico de scraping
curl -X POST http://localhost:3000/api/scraping \
  -H "Content-Type: application/json" \
  -d '{"region": "Nacional"}' | jq '.'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "newsScraped": 15,
  "region": "Nacional",
  "sources": ["Emol", "La Tercera", "BioBioChile"]
}
```

**Verificaciones:**
- [ ] Status code 200
- [ ] `success: true`
- [ ] `newsScraped > 0`
- [ ] Noticias guardadas en DB

### 1.2 Verificar Noticias en DB

```sql
-- Ver noticias scrapeadas hoy
SELECT 
  titulo,
  fuente,
  categoria,
  region,
  fecha_scraping
FROM noticias_scrapeadas
WHERE DATE(fecha_scraping) = CURRENT_DATE
ORDER BY fecha_scraping DESC
LIMIT 10;
```

**Verificaciones:**
- [ ] Al menos 10 noticias
- [ ] Títulos no vacíos
- [ ] Fuentes correctas (Emol, La Tercera, BioBio)
- [ ] Categorías asignadas

### 1.3 Test de Scraping Programado

```bash
# Simular ejecución de cron
curl -X GET http://localhost:3000/api/cron/scrape-news \
  -H "Authorization: Bearer ${CRON_SECRET}" | jq '.'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "regionsProcessed": 6,
  "totalNewsScraped": 90,
  "errors": [],
  "processingTime": "45000ms"
}
```

**Verificaciones:**
- [ ] Todas las regiones procesadas
- [ ] Sin errores
- [ ] Logs registrados en DB

---

## 2. Test de Generación de Noticieros

### 2.1 Test Básico (Sin Audio)

```bash
# Generar noticiero simple
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Metropolitana de Santiago",
    "categories": ["política", "economía"],
    "targetDuration": 300,
    "frecuencia_anuncios": 2,
    "generateAudioNow": false
  }' | jq '.'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "noticieroId": "uuid-generado",
  "timeline": [...],
  "duration": 300,
  "stats": {
    "newsCount": 5,
    "adsCount": 2,
    "totalDuration": 300,
    "audioGenerated": false
  }
}
```

**Verificaciones:**
- [ ] `success: true`
- [ ] `noticieroId` válido
- [ ] Timeline con intro, noticias, anuncios y outro
- [ ] Duración cercana a target (±60s)
- [ ] Categorías filtradas correctamente

### 2.2 Test con Filtrado de Categorías

```bash
# Solo noticias de política
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Nacional",
    "categories": ["política"],
    "targetDuration": 180,
    "generateAudioNow": false
  }' | jq '.stats'
```

**Verificaciones:**
- [ ] Solo noticias de categoría "política"
- [ ] Al menos 3 noticias
- [ ] Duración ~180 segundos

### 2.3 Test con Publicidad

```bash
# Verificar inserción de publicidad
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Nacional",
    "targetDuration": 600,
    "frecuencia_anuncios": 1,
    "generateAudioNow": false
  }' | jq '.stats.adsCount'
```

**Verificaciones:**
- [ ] `adsCount > 0`
- [ ] Anuncios intercalados correctamente
- [ ] Contador de reproducciones actualizado en DB

### 2.4 Test con Generación de Audio

```bash
# Generar con audio (TARDA MÁS)
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Metropolitana de Santiago",
    "categories": ["economía"],
    "targetDuration": 180,
    "generateAudioNow": true
  }' | jq '.'
```

**Verificaciones:**
- [ ] Todos los items tienen `audioUrl`
- [ ] Archivos de audio existen
- [ ] Duraciones reales calculadas

### 2.5 Verificar Noticiero en DB

```sql
-- Ver noticiero generado
SELECT 
  id,
  titulo,
  estado,
  duracion_segundos,
  jsonb_array_length(datos_timeline) as items_count,
  created_at
FROM noticieros
WHERE id = 'PEGAR-UUID-AQUI';

-- Ver timeline completo
SELECT 
  datos_timeline
FROM noticieros
WHERE id = 'PEGAR-UUID-AQUI';
```

**Verificaciones:**
- [ ] Estado = 'generado' o 'procesando'
- [ ] Timeline no vacío
- [ ] Metadata correcta

---

## 3. Test de Generación de Audio (TTS)

### 3.1 Test de Servidor TTS Local

```bash
# Health check
curl http://localhost:5000/health | jq '.'
```

**Resultado Esperado:**
```json
{
  "status": "healthy",
  "model_loaded": true,
  "device": "cpu"
}
```

### 3.2 Test de Generación Simple

```bash
# Generar audio de prueba
curl -X POST http://localhost:3000/api/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Esta es una prueba de generación de audio para el sistema VIRA.",
    "provider": "auto"
  }' | jq '.'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "provider": "local-tts-server",
  "audioUrl": "/generated-audio/...",
  "duration": 5,
  "format": "mp3"
}
```

**Verificaciones:**
- [ ] Audio generado
- [ ] Archivo existe en disco
- [ ] Duración > 0
- [ ] Audio reproducible

### 3.3 Test con Voice Cloning

```bash
# Con voz específica
curl -X POST http://localhost:3000/api/text-to-speech \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Prueba con voz clonada",
    "provider": "auto",
    "voice": "https://url-de-voz-referencia.mp3"
  }' | jq '.'
```

**Verificaciones:**
- [ ] Audio generado con voz clonada
- [ ] Calidad aceptable

### 3.4 Verificar Archivos Generados

```bash
# Listar archivos de audio
ls -lh public/generated-audio/ | head -20

# Verificar que son MP3 válidos
file public/generated-audio/*.mp3 | head -5

# Reproducir uno
# Windows:
start public/generated-audio/[archivo].mp3
# Mac/Linux:
# open public/generated-audio/[archivo].mp3
```

**Verificaciones:**
- [ ] Archivos existen
- [ ] Son MP3 válidos
- [ ] Tamaño razonable (>10KB)
- [ ] Reproducibles

---

## 4. Test de Ensamblaje de Audio

### 4.1 Test de Finalización

```bash
# Finalizar noticiero (requiere noticiero con audios)
curl -X POST http://localhost:3000/api/finalize-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "noticieroId": "PEGAR-UUID-AQUI",
    "includeMusic": false,
    "includeFx": false
  }' | jq '.'
```

**Resultado Esperado:**
```json
{
  "success": true,
  "audioUrl": "/generated-audio/noticiero_1234567890.mp3",
  "duration": 300,
  "segmentsCount": 8
}
```

**Verificaciones:**
- [ ] `success: true`
- [ ] Audio final existe
- [ ] Duración correcta
- [ ] Todos los segmentos incluidos

### 4.2 Verificar Audio Final

```bash
# Ver archivo generado
ls -lh public/generated-audio/noticiero_*.mp3

# Información del archivo
ffprobe public/generated-audio/noticiero_*.mp3 2>&1 | grep Duration

# Reproducir
start public/generated-audio/noticiero_*.mp3
```

**Verificaciones:**
- [ ] Archivo existe
- [ ] Tamaño > 1MB
- [ ] Duración correcta
- [ ] Audio reproducible sin cortes
- [ ] Volumen normalizado

### 4.3 Test con Música de Fondo

```bash
# Con música
curl -X POST http://localhost:3000/api/finalize-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "noticieroId": "PEGAR-UUID-AQUI",
    "includeMusic": true,
    "backgroundMusicUrl": "https://url-musica.mp3",
    "backgroundMusicVolume": 0.2
  }' | jq '.'
```

**Verificaciones:**
- [ ] Música de fondo audible
- [ ] Volumen balanceado
- [ ] No opaca las voces

### 4.4 Verificar Estado en DB

```sql
-- Ver estado del noticiero
SELECT 
  id,
  titulo,
  estado,
  url_audio,
  duracion_segundos,
  s3_key
FROM noticieros
WHERE id = 'PEGAR-UUID-AQUI';
```

**Verificaciones:**
- [ ] Estado = 'completado'
- [ ] `url_audio` no nulo
- [ ] `s3_key` apunta al archivo local

---

## 5. Test de Automatización (Cron)

### 5.1 Test de Scraping Programado

```bash
# Ejecutar manualmente
curl -X GET http://localhost:3000/api/cron/scrape-news \
  -H "Authorization: Bearer test-secret" | jq '.'
```

**Verificaciones:**
- [ ] Todas las regiones procesadas
- [ ] Noticias guardadas en DB
- [ ] Logs registrados
- [ ] Métricas actualizadas

### 5.2 Test de Generación Programada

Primero, crear una tarea programada:

```sql
-- Insertar tarea de prueba
INSERT INTO programados (
  nombre,
  tipo,
  horario,
  esta_activo,
  configuracion,
  proxima_ejecucion
) VALUES (
  'Noticiero Matinal Automático',
  'noticiero',
  '0 8 * * *',
  true,
  '{"region": "Metropolitana de Santiago", "categories": ["política", "economía"], "targetDuration": 600, "frecuencia_anuncios": 2}',
  NOW()
);
```

Luego ejecutar:

```bash
# Ejecutar generación programada
curl -X GET http://localhost:3000/api/cron/generate-scheduled \
  -H "Authorization: Bearer test-secret" | jq '.'
```

**Verificaciones:**
- [ ] Tarea ejecutada
- [ ] Noticiero generado
- [ ] Próxima ejecución calculada
- [ ] Contadores actualizados

### 5.3 Verificar Logs

```sql
-- Ver logs de procesos automatizados
SELECT 
  tipo_proceso,
  estado,
  metadata,
  created_at
FROM logs_procesamiento
WHERE metadata->>'scheduled' = 'true'
ORDER BY created_at DESC
LIMIT 10;
```

---

## 6. Test de Base de Datos

### 6.1 Test de Integridad

```sql
-- Verificar referencias
SELECT 
  COUNT(*) as noticieros_huerfanos
FROM noticieros
WHERE user_id NOT IN (SELECT id FROM users);

-- Verificar timeline válido
SELECT 
  id,
  titulo,
  CASE 
    WHEN datos_timeline IS NULL THEN 'NULL'
    WHEN jsonb_typeof(datos_timeline) != 'array' THEN 'NOT_ARRAY'
    WHEN jsonb_array_length(datos_timeline) = 0 THEN 'EMPTY'
    ELSE 'OK'
  END as timeline_status
FROM noticieros
WHERE datos_timeline IS NULL 
   OR jsonb_typeof(datos_timeline) != 'array'
   OR jsonb_array_length(datos_timeline) = 0;
```

**Verificaciones:**
- [ ] Sin registros huérfanos
- [ ] Todos los timelines válidos

### 6.2 Test de Índices

```sql
-- Verificar uso de índices
EXPLAIN ANALYZE
SELECT * FROM noticias_scrapeadas
WHERE region = 'Nacional'
  AND fecha_publicacion >= NOW() - INTERVAL '7 days'
ORDER BY fecha_publicacion DESC
LIMIT 20;
```

**Verificaciones:**
- [ ] Usa índice en `region`
- [ ] Usa índice en `fecha_publicacion`
- [ ] Tiempo < 100ms

### 6.3 Test de Triggers

```sql
-- Verificar trigger de updated_at
UPDATE noticieros
SET titulo = 'Test Update'
WHERE id = (SELECT id FROM noticieros LIMIT 1)
RETURNING updated_at > created_at as trigger_works;
```

**Verificaciones:**
- [ ] `trigger_works = true`

---

## 7. Test de Integración End-to-End

### 7.1 Flujo Completo Manual

```bash
#!/bin/bash

echo "🧪 Test End-to-End Completo"
echo "=============================="

# 1. Scraping
echo "1️⃣ Scraping de noticias..."
SCRAPE_RESULT=$(curl -s -X POST http://localhost:3000/api/scraping \
  -H "Content-Type: application/json" \
  -d '{"region": "Nacional"}')
echo "✅ Scraping: $(echo $SCRAPE_RESULT | jq -r '.newsScraped') noticias"

# 2. Generación con audio
echo "2️⃣ Generando noticiero..."
GEN_RESULT=$(curl -s -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Nacional",
    "categories": ["política"],
    "targetDuration": 180,
    "generateAudioNow": true
  }')
NOTICIERO_ID=$(echo $GEN_RESULT | jq -r '.noticieroId')
echo "✅ Noticiero generado: $NOTICIERO_ID"

# 3. Esperar generación de audios
echo "3️⃣ Esperando generación de audios (30s)..."
sleep 30

# 4. Finalizar
echo "4️⃣ Finalizando noticiero..."
FINAL_RESULT=$(curl -s -X POST http://localhost:3000/api/finalize-newscast \
  -H "Content-Type: application/json" \
  -d "{\"noticieroId\": \"$NOTICIERO_ID\"}")
AUDIO_URL=$(echo $FINAL_RESULT | jq -r '.audioUrl')
echo "✅ Audio final: $AUDIO_URL"

# 5. Verificar archivo
echo "5️⃣ Verificando archivo..."
if [ -f "public$AUDIO_URL" ]; then
  echo "✅ Archivo existe: $(ls -lh public$AUDIO_URL | awk '{print $5}')"
else
  echo "❌ Archivo NO existe"
fi

echo ""
echo "=============================="
echo "✅ Test End-to-End Completado"
```

**Verificaciones:**
- [ ] Todos los pasos exitosos
- [ ] Archivo final existe
- [ ] Audio reproducible

---

## 📊 Checklist General de Tests

### Funcionalidad Core
- [ ] Scraping funciona
- [ ] Generación de noticieros funciona
- [ ] Filtrado por categorías funciona
- [ ] Publicidad se inserta correctamente
- [ ] Generación de audio funciona
- [ ] Ensamblaje de audio funciona
- [ ] Audio final es reproducible

### Automatización
- [ ] Scraping programado funciona
- [ ] Generación programada funciona
- [ ] Logs se registran correctamente
- [ ] Métricas se actualizan

### Base de Datos
- [ ] Datos se guardan correctamente
- [ ] Referencias íntegras
- [ ] Índices funcionando
- [ ] Triggers activos

### Performance
- [ ] Scraping < 60s por región
- [ ] Generación < 120s (sin audio)
- [ ] Generación < 300s (con audio)
- [ ] Ensamblaje < 60s

### Errores
- [ ] Manejo de errores robusto
- [ ] Logs de errores completos
- [ ] Rollback en caso de fallo
- [ ] Mensajes de error claros

---

## 🚀 Ejecutar Todos los Tests

```bash
# Crear script de tests
chmod +x test-suite.sh
./test-suite.sh
```

---

**Última Actualización:** 19 de Noviembre de 2024  
**Estado:** Listo para Ejecutar
