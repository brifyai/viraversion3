# 🎯 Código para Agregar Botón "Finalizar Noticiero"

## 📍 Ubicación
Agregar en el archivo: `app/timeline-noticiero/[id]/page.tsx`

---

## 1️⃣ Agregar Estados (después de la línea ~115)

```typescript
// Estado para finalización
const [isFinalizing, setIsFinalizing] = useState(false)
const [finalAudioUrl, setFinalAudioUrl] = useState<string | null>(null)
const [showFinalizeDialog, setShowFinalizeDialog] = useState(false)
```

---

## 2️⃣ Agregar Función de Finalización (después de las funciones existentes, línea ~800)

```typescript
// Función para finalizar el noticiero
const handleFinalizeNewscast = async () => {
  if (!timelineData) return

  // Verificar que todos los items tengan audio
  const itemsWithoutAudio = timelineData.timeline.filter(
    item => !item.hasAudio && item.type !== 'transition'
  )

  if (itemsWithoutAudio.length > 0) {
    alert(`⚠️ Faltan ${itemsWithoutAudio.length} elementos sin audio generado. Por favor genera el audio de todos los elementos antes de finalizar.`)
    return
  }

  setIsFinalizing(true)
  
  try {
    console.log('🎬 Finalizando noticiero...')

    const response = await fetch('/api/finalize-newscast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noticieroId: params.id,
        includeMusic: false,
        includeFx: false
      })
    })

    const result = await response.json()

    if (result.success) {
      setFinalAudioUrl(result.audioUrl)
      setShowFinalizeDialog(true)
      
      console.log('✅ Noticiero finalizado exitosamente!')
      console.log('🎵 Audio final:', result.audioUrl)
      console.log('⏱️ Duración:', result.duration, 'segundos')
      console.log('📦 Segmentos ensamblados:', result.segmentsCount)
    } else {
      throw new Error(result.error || 'Error desconocido')
    }
  } catch (error) {
    console.error('❌ Error finalizando noticiero:', error)
    alert(`Error al finalizar el noticiero: ${error instanceof Error ? error.message : 'Error desconocido'}`)
  } finally {
    setIsFinalizing(false)
  }
}
```

---

## 3️⃣ Agregar Botón en el Header (buscar donde están los botones principales)

Busca una sección similar a esta y agrega el botón:

```typescript
{/* Botones de acción principales */}
<div className="flex gap-3">
  {/* ... otros botones existentes ... */}
  
  {/* NUEVO: Botón Finalizar Noticiero */}
  <Button
    onClick={handleFinalizeNewscast}
    disabled={isFinalizing || !timelineData}
    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
  >
    {isFinalizing ? (
      <>
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        Ensamblando...
      </>
    ) : (
      <>
        <FileAudio className="h-4 w-4 mr-2" />
        Finalizar Noticiero
      </>
    )}
  </Button>
</div>
```

---

## 4️⃣ Agregar Dialog de Resultado (antes del cierre del return, línea ~2623)

```typescript
{/* Dialog de Noticiero Finalizado */}
<Dialog open={showFinalizeDialog} onOpenChange={setShowFinalizeDialog}>
  <DialogContent className="max-w-2xl">
    <DialogHeader>
      <DialogTitle className="text-2xl font-bold text-green-600 flex items-center gap-2">
        <FileAudio className="h-6 w-6" />
        ¡Noticiero Finalizado!
      </DialogTitle>
    </DialogHeader>
    
    <div className="space-y-6">
      {/* Mensaje de éxito */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-green-800 font-medium">
          ✅ Tu noticiero ha sido ensamblado exitosamente
        </p>
        <p className="text-green-600 text-sm mt-1">
          Todos los segmentos de audio han sido combinados en un solo archivo MP3
        </p>
      </div>

      {/* Reproductor de audio */}
      {finalAudioUrl && (
        <div className="bg-gray-50 rounded-lg p-4">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <Music className="h-5 w-5 text-purple-600" />
            Reproducir Audio Final
          </h4>
          <audio 
            controls 
            className="w-full"
            src={finalAudioUrl}
          >
            Tu navegador no soporta el elemento de audio.
          </audio>
        </div>
      )}

      {/* Información del archivo */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-lg p-3">
          <p className="text-xs text-blue-600 mb-1">Formato</p>
          <p className="font-medium text-blue-900">MP3</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-3">
          <p className="text-xs text-purple-600 mb-1">Estado</p>
          <p className="font-medium text-purple-900">Completado</p>
        </div>
      </div>

      {/* Botones de acción */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          onClick={() => setShowFinalizeDialog(false)}
          className="flex-1"
        >
          Cerrar
        </Button>
        {finalAudioUrl && (
          <Button
            onClick={() => window.open(finalAudioUrl, '_blank')}
            className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
          >
            <Download className="h-4 w-4 mr-2" />
            Descargar MP3
          </Button>
        )}
      </div>
    </div>
  </DialogContent>
</Dialog>
```

---

## 5️⃣ Ubicaciones Exactas para Insertar

### Opción A: Buscar por Texto
1. Busca: `const [editingTitle, setEditingTitle] = useState<string>('')`
2. Después de esa línea, agrega los 3 nuevos estados

### Opción B: Buscar por Número de Línea
1. **Estados:** Después de línea ~114
2. **Función:** Después de línea ~800 (después de otras funciones)
3. **Botón:** Busca donde estén otros botones principales (probablemente línea ~1800-2000)
4. **Dialog:** Antes de la línea 2623 (antes del cierre del return)

---

## 6️⃣ Verificar Imports

Asegúrate de que estos iconos estén importados al inicio del archivo:

```typescript
import {
  // ... otros imports existentes ...
  FileAudio,
  Download,
  Music,
  Loader2
} from 'lucide-react'
```

---

## 🧪 Probar la Funcionalidad

1. **Generar audios:** Asegúrate de que todos los items del timeline tengan audio
2. **Click en "Finalizar Noticiero":** Debe mostrar "Ensamblando..."
3. **Esperar:** El proceso puede tardar 10-30 segundos
4. **Ver resultado:** Debe aparecer el dialog con el reproductor
5. **Reproducir:** Click en play para escuchar el audio final
6. **Descargar:** Click en "Descargar MP3" para guardar el archivo

---

## ⚠️ Troubleshooting

### Error: "Faltan elementos sin audio"
**Solución:** Genera el audio de todos los items antes de finalizar

### Error: "Cannot find module"
**Solución:** Verifica que FFmpeg esté instalado:
```bash
npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg --legacy-peer-deps
```

### No se reproduce el audio
**Solución:** Verifica que el archivo exista en `public/generated-audio/`

### Timeout
**Solución:** Para noticieros muy largos, el proceso puede tardar. Considera aumentar el timeout o procesar en background.

---

## 📝 Notas

- El botón solo se habilita cuando hay un timeline cargado
- Verifica que todos los items tengan audio antes de finalizar
- El audio final se guarda en `public/generated-audio/`
- La URL es accesible directamente desde el navegador
- El archivo permanece en el servidor hasta que lo elimines manualmente

---

**Última Actualización:** 19 de Noviembre de 2024  
**Estado:** Listo para Integrar
