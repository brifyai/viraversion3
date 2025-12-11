# 🧪 Guía Rápida de Prueba - Sistema VIRA

## 🚀 Prueba Rápida del Sistema

### 1️⃣ Iniciar Servidor TTS Local
```bash
# En una terminal separada
cd SistemTTS
python app.py
```

**Verificar que esté corriendo:**
```bash
curl http://localhost:5000/health
```

### 2️⃣ Iniciar Next.js
```bash
cd CODIGO_FUENTE
npm run dev
```

### 3️⃣ Crear Noticiero de Prueba

**Opción A: Desde la UI**
1. Ir a `http://localhost:3000/crear-noticiero`
2. Seleccionar región: "Metropolitana de Santiago"
3. Seleccionar categorías: "Política", "Economía"
4. Duración: 5 minutos
5. Click "Generar Noticiero"

**Opción B: Con cURL (Más rápido)**
```bash
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Metropolitana de Santiago",
    "categories": ["política", "economía"],
    "targetDuration": 300,
    "frecuencia_anuncios": 2,
    "generateAudioNow": false
  }'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "noticieroId": "uuid-generado",
  "timeline": [...],
  "duration": 300,
  "stats": {
    "newsCount": 5,
    "adsCount": 2,
    "totalDuration": 300
  }
}
```

### 4️⃣ Ir al Timeline
```
http://localhost:3000/timeline-noticiero/[noticieroId]
```

### 5️⃣ Generar Audios Individuales
- Click en cada noticia → "Generar Audio"
- Esperar a que se generen todos los audios
- Verificar que cada item tenga el ícono de audio ✅

### 6️⃣ Finalizar Noticiero

**Desde UI (cuando esté integrado):**
- Click en "Finalizar Noticiero"
- Esperar ensamblaje
- Reproducir audio final

**Con cURL (para probar ahora):**
```bash
curl -X POST http://localhost:3000/api/finalize-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "noticieroId": "uuid-del-noticiero",
    "includeMusic": false,
    "includeFx": false
  }'
```

**Respuesta esperada:**
```json
{
  "success": true,
  "audioUrl": "/generated-audio/noticiero_1234567890.mp3",
  "duration": 300,
  "segmentsCount": 8
}
```

### 7️⃣ Verificar Archivo Generado
```bash
# Ver archivos generados
ls -lh public/generated-audio/

# Reproducir (Windows)
start public/generated-audio/noticiero_*.mp3

# Reproducir (Mac/Linux)
open public/generated-audio/noticiero_*.mp3
```

---

## 🔍 Verificaciones en Base de Datos

### Verificar Noticiero Creado
```sql
SELECT 
  id, 
  titulo, 
  estado, 
  duracion_segundos,
  url_audio,
  created_at
FROM noticieros 
ORDER BY created_at DESC 
LIMIT 5;
```

### Verificar Timeline
```sql
SELECT 
  id,
  datos_timeline->0 as primer_item,
  jsonb_array_length(datos_timeline) as total_items
FROM noticieros 
WHERE id = 'uuid-del-noticiero';
```

### Verificar Logs
```sql
SELECT 
  tipo_proceso,
  estado,
  duracion_segundos,
  metadata,
  created_at
FROM logs_procesamiento 
WHERE noticiero_id = 'uuid-del-noticiero'
ORDER BY created_at DESC;
```

### Verificar Publicidad
```sql
SELECT 
  nombre,
  reproducciones,
  esta_activo,
  fecha_inicio,
  fecha_fin
FROM campanas_publicitarias 
WHERE esta_activo = true;
```

---

## ⚠️ Troubleshooting

### Error: "No hay noticias disponibles"
**Solución:** Ejecutar scraping manual
```bash
curl -X POST http://localhost:3000/api/scraping \
  -H "Content-Type: application/json" \
  -d '{"region": "Nacional"}'
```

### Error: "Servidor TTS no disponible"
**Solución:** Verificar que el servidor esté corriendo
```bash
curl http://localhost:5000/health
```

### Error: "Cannot find module 'fluent-ffmpeg'"
**Solución:** Reinstalar sin tipos
```bash
npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg --legacy-peer-deps
```

### Error: "EACCES: permission denied"
**Solución:** Dar permisos al directorio
```bash
chmod 755 public/generated-audio
```

### Audio no se genera
**Verificar:**
1. Servidor TTS corriendo en puerto 5000
2. Texto no vacío
3. Logs en consola del servidor

---

## 📊 Checklist de Prueba

### Generación de Noticiero
- [ ] Se crea noticiero en DB
- [ ] Timeline tiene intro, noticias y outro
- [ ] Se filtran categorías correctamente
- [ ] Se insertan anuncios según frecuencia
- [ ] Metadata correcta en DB

### Generación de Audio
- [ ] Servidor TTS responde
- [ ] Audio se genera correctamente
- [ ] Archivo se guarda en DB
- [ ] Duración es correcta

### Ensamblaje Final
- [ ] Todos los segmentos tienen audio
- [ ] Se concatenan correctamente
- [ ] Archivo MP3 se genera
- [ ] Duración total es correcta
- [ ] Audio es reproducible
- [ ] Estado cambia a "completado"

### Base de Datos
- [ ] Noticiero guardado
- [ ] Timeline completo
- [ ] Logs registrados
- [ ] Costos calculados
- [ ] Reproducciones actualizadas

---

## 🎯 Prueba Completa End-to-End

```bash
# 1. Limpiar datos anteriores (opcional)
# Eliminar noticieros de prueba en DB

# 2. Iniciar servicios
# Terminal 1: python SistemTTS/app.py
# Terminal 2: npm run dev

# 3. Generar noticiero
curl -X POST http://localhost:3000/api/generate-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "region": "Metropolitana de Santiago",
    "categories": ["política"],
    "targetDuration": 180,
    "frecuencia_anuncios": 1,
    "generateAudioNow": true
  }' | jq '.noticieroId'

# Guardar el ID que devuelve

# 4. Esperar a que se generen los audios (si generateAudioNow: true)
# Esto puede tomar 30-60 segundos

# 5. Finalizar noticiero
curl -X POST http://localhost:3000/api/finalize-newscast \
  -H "Content-Type: application/json" \
  -d '{
    "noticieroId": "PEGAR-ID-AQUI",
    "includeMusic": false
  }' | jq '.'

# 6. Reproducir audio
start public/generated-audio/noticiero_*.mp3
```

---

## 📝 Notas Importantes

1. **Primera vez:** El scraping puede tardar si no hay noticias en DB
2. **Generación de audio:** Puede tardar 5-10s por segmento
3. **Ensamblaje:** Puede tardar 10-30s dependiendo del número de segmentos
4. **Archivos:** Se guardan en `public/generated-audio/` y son accesibles en `/generated-audio/[filename].mp3`

---

**Última Actualización:** 19 de Noviembre de 2024  
**Estado:** Listo para Probar
