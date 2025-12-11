'use client'

import { toast } from 'react-toastify'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Navigation } from '@/components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { RegionSelector } from '@/components/newscast/RegionSelector'
import { CategorySelector } from '@/components/newscast/CategorySelector'
import { DurationSlider } from '@/components/newscast/DurationSlider'
import { GenerateButton } from '@/components/newscast/GenerateButton'
import { VoiceSelector } from '@/components/newscast/VoiceSelector'
import { useNewscastGeneration } from '@/hooks/useNewscastGeneration'
import { Save, Settings, Music, Clock } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

// Interfaces
interface RadioStation {
  id: string
  nombre: string
  frecuencia: string
  region: string
  url?: string
}

// Categorías con soporte para conteo y selección de cantidad
interface CategoryWithCount {
  id: string
  label: string
  checked: boolean
  count?: number       // Noticias disponibles
  selectedCount?: number  // Noticias a usar
}

const initialCategories: CategoryWithCount[] = [
  { id: 'regionales', label: 'Regionales', checked: true, count: 0, selectedCount: 3 },
  { id: 'nacionales', label: 'Nacionales', checked: true, count: 0, selectedCount: 3 },
  { id: 'deportes', label: 'Deportes', checked: false, count: 0, selectedCount: 0 },
  { id: 'economia', label: 'Economía', checked: false, count: 0, selectedCount: 0 },
  { id: 'mundo', label: 'Mundo', checked: false, count: 0, selectedCount: 0 },
  { id: 'tendencias', label: 'Tendencias', checked: false, count: 0, selectedCount: 0 },
  { id: 'politica', label: 'Política', checked: false, count: 0, selectedCount: 0 },
  { id: 'tecnologia', label: 'Tecnología', checked: false, count: 0, selectedCount: 0 },
]

export default function CrearNoticiero() {
  // Estados principales
  const [selectedRegion, setSelectedRegion] = useState('')
  const [selectedRadio, setSelectedRadio] = useState('')
  const [categories, setCategories] = useState<CategoryWithCount[]>(initialCategories)
  const [loadingStats, setLoadingStats] = useState(false)
  const [duration, setDuration] = useState(15)
  const [adCount, setAdCount] = useState(3)
  const [generateAudio, setGenerateAudio] = useState(false)
  const [selectedVoice, setSelectedVoice] = useState('es-mx')
  const [timeStrategy, setTimeStrategy] = useState('auto')
  const [includeWeather, setIncludeWeather] = useState(true)

  // Estados para configuración de audio
  const [cortinasEnabled, setCortinasEnabled] = useState(false)
  const [cortinasFrequency, setCortinasFrequency] = useState(3)

  // Estados para radios dinámicas
  const [radioStations, setRadioStations] = useState<RadioStation[]>([])
  const [loadingRadios, setLoadingRadios] = useState(true)
  const [radiosError, setRadiosError] = useState<string | null>(null)

  // Hook de generación
  const {
    isGenerating,
    progress,
    status,
    error,
    generateNewscast,
    navigateToTimeline,
    reset
  } = useNewscastGeneration()

  // Cargar radios desde la API (multi-tenant, filtrado por usuario)
  useEffect(() => {
    async function loadRadios() {
      try {
        setLoadingRadios(true)
        setRadiosError(null)

        // Usar el API que filtra por user_id automáticamente
        const response = await fetch('/api/radios', {
          credentials: 'include'
        })

        if (!response.ok) {
          throw new Error('Error al cargar radios')
        }

        const result = await response.json()
        const data = result.data || result.radios || []

        if (!data || data.length === 0) {
          setRadiosError('No hay radios configuradas. Por favor agrega radios en /activos')
          setRadioStations([])
        } else {
          setRadioStations(data)
          console.log(`✅ ${data.length} radios cargadas desde API`)
        }

      } catch (err) {
        console.error('Error cargando radios:', err)
        setRadiosError('Error al cargar radios desde la base de datos')
        setRadioStations([])
      } finally {
        setLoadingRadios(false)
      }
    }

    loadRadios()
  }, [])

  // Obtener regiones únicas
  const regions = [...new Set(radioStations.map(r => r.region))].sort()

  // Estado para WPM de la voz (estimación de duración)
  const [voiceWPM, setVoiceWPM] = useState(150)

  // Cargar estadísticas de noticias (al inicio y cuando cambia la región)
  useEffect(() => {
    async function loadNewsStats() {
      setLoadingStats(true)
      try {
        // Si hay región seleccionada, filtrar por ella; si no, cargar globales
        const url = selectedRegion
          ? `/api/news-stats?region=${encodeURIComponent(selectedRegion)}`
          : '/api/news-stats'

        const response = await fetch(url)
        if (response.ok) {
          const data = await response.json()
          console.log('📊 News stats loaded:', data)

          // Actualizar conteos de categorías
          setCategories(prev => prev.map(cat => ({
            ...cat,
            count: data.categories[cat.id] || 0,
            // Solo actualizar selectedCount si la categoría está seleccionada y hay noticias
            selectedCount: cat.checked
              ? Math.min(cat.selectedCount || 3, data.categories[cat.id] || 0)
              : 0
          })))
        }
      } catch (error) {
        console.error('Error loading news stats:', error)
      } finally {
        setLoadingStats(false)
      }
    }

    loadNewsStats()
  }, [selectedRegion])

  // Manejar cambio de categoría (ahora con selectedCount)
  const handleCategoryChange = (categoryId: string, checked: boolean, selectedCount?: number) => {
    setCategories(prev =>
      prev.map(cat => {
        if (cat.id === categoryId) {
          return {
            ...cat,
            checked,
            selectedCount: selectedCount !== undefined ? selectedCount : (checked ? Math.min(3, cat.count || 3) : 0)
          }
        }
        return cat
      })
    )
  }

  // Calcular duración estimada del noticiero
  const totalNewsSelected = categories.reduce((sum, c) => sum + (c.selectedCount || 0), 0)
  const wordsPerNews = 120 // Promedio de palabras por noticia
  const estimatedMinutes = Math.round((totalNewsSelected * wordsPerNews) / voiceWPM)

  // Manejar generación
  const handleGenerate = async () => {
    // Validaciones
    if (!selectedRegion) {
      toast.warning('Por favor selecciona una región')
      return
    }

    if (!selectedRadio) {
      toast.warning('Por favor selecciona una radio')
      return
    }

    const selectedCategoryIds = categories
      .filter(c => c.checked)
      .map(c => c.id)

    if (selectedCategoryIds.length === 0) {
      toast.warning('Por favor selecciona al menos una categoría')
      return
    }

    // Generar noticiero
    const result = await generateNewscast({
      region: selectedRegion,
      categories: selectedCategoryIds,
      targetDuration: duration * 60, // convertir a segundos
      generateAudioNow: generateAudio,
      adCount: adCount,
      includeTimeWeather: includeWeather,
      timeStrategy: timeStrategy,
      newsTime: new Date().toLocaleTimeString('es-CL', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      voiceModel: selectedVoice,
      voiceWPM: voiceWPM, // WPM de la voz para cálculo preciso de duración
      // Configuración de audio
      audioConfig: {
        cortinas_enabled: cortinasEnabled,
        cortinas_frequency: cortinasFrequency,
        cortina_default_id: null,
        cortina_default_url: null, // Se configurará en plantilla
        background_music_enabled: false,
        background_music_id: null,
        background_music_volume: 0.2
      }
    })

    // Si fue exitoso, navegar al timeline
    if (result.success && result.newscastId) {
      setTimeout(() => {
        navigateToTimeline(result.newscastId!)
      }, 1500)
    }
  }

  // Guardar plantilla en la base de datos
  const handleSave = async () => {
    if (!selectedRegion || !selectedRadio) {
      toast.warning('Por favor selecciona región y radio antes de guardar')
      return
    }

    const selectedCategoryLabels = categories
      .filter(c => c.checked)
      .map(c => c.label)

    const payload = {
      name: `Plantilla ${selectedRegion} - ${new Date().toLocaleDateString('es-CL')}`,
      region: selectedRegion,
      radio_station: selectedRadio,
      duration_minutes: duration,
      voice_provider: 'local-tts',
      voice_id: selectedVoice,
      include_weather: includeWeather,
      include_time: timeStrategy !== 'none',
      ad_frequency: adCount,
      categories: selectedCategoryLabels,
      configuration: {
        adCount: adCount,
        timeStrategy: timeStrategy,
        cortinas_enabled: cortinasEnabled,
        cortinas_frequency: cortinasFrequency
      }
    }

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      })

      const data = await response.json()

      if (data.success) {
        toast.success('✅ Plantilla guardada exitosamente')
      } else {
        throw new Error(data.error || 'Error desconocido')
      }
    } catch (error) {
      console.error('Error guardando plantilla:', error)
      toast.error('Error al guardar la plantilla')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Crear Noticiero
          </h1>
          <p className="text-gray-600">
            Configura y genera tu noticiero personalizado con IA
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Panel de Configuración */}
          <div className="lg:col-span-2 space-y-6">
            {/* 1. Región y Radio */}
            <Card>
              <CardHeader>
                <CardTitle>1. Selecciona Región y Radio</CardTitle>
              </CardHeader>
              <CardContent>
                <RegionSelector
                  selectedRegion={selectedRegion}
                  selectedRadio={selectedRadio}
                  onRegionChange={setSelectedRegion}
                  onRadioChange={setSelectedRadio}
                  regions={regions}
                  radios={radioStations}
                />
              </CardContent>
            </Card>

            {/* 2. Categorías */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>2. Categorías de Noticias</span>
                  {loadingStats && (
                    <span className="text-sm font-normal text-blue-600 animate-pulse">
                      Cargando...
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CategorySelector
                  categories={categories}
                  onCategoryChange={handleCategoryChange}
                  showCounts={true}
                  maxPerCategory={10}
                />
              </CardContent>
            </Card>

            {/* 3. Duración y Estimación */}
            <Card>
              <CardHeader>
                <CardTitle>3. Duración del Noticiero</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <DurationSlider
                  duration={duration}
                  onDurationChange={setDuration}
                  min={5}
                  max={60}
                />

                {/* Estimación de tiempo */}
                {totalNewsSelected > 0 && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Clock className="h-5 w-5 text-blue-600" />
                      <span className="font-medium text-blue-900">Tiempo Estimado</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-blue-700">~{estimatedMinutes}</span>
                      <span className="text-blue-600">minutos</span>
                    </div>
                    <p className="text-sm text-blue-600 mt-1">
                      Basado en {totalNewsSelected} noticias a {voiceWPM} palabras/min
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 4. Configuración de Publicidad */}
            <Card>
              <CardHeader>
                <CardTitle>4. Configuración de Publicidad</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <label className="text-sm font-medium text-gray-700">
                      Cantidad de Anuncios a Insertar
                    </label>
                    <span className="text-2xl font-bold text-blue-600">
                      {adCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={adCount}
                    onChange={(e) => setAdCount(Number(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>0 anuncios</span>
                    <span>10 anuncios</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    Se distribuirán equitativamente durante el noticiero.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* 4. Opciones Avanzadas */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Settings className="h-5 w-5 mr-2" />
                  Opciones Avanzadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <VoiceSelector
                        value={selectedVoice}
                        onChange={(voiceId, wpm) => {
                          setSelectedVoice(voiceId)
                          if (wpm) setVoiceWPM(wpm)
                        }}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Estrategia de Hora</label>
                      <select
                        className="w-full border rounded-md p-2"
                        value={timeStrategy}
                        onChange={(e) => setTimeStrategy(e.target.value)}
                      >
                        <option value="auto">Automática (Al generar)</option>
                        <option value="none">No incluir hora</option>
                      </select>
                    </div>

                    <div className="flex items-center space-x-2 mt-8">
                      <input
                        type="checkbox"
                        id="weather-manual"
                        checked={includeWeather}
                        onChange={(e) => setIncludeWeather(e.target.checked)}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300"
                      />
                      <label htmlFor="weather-manual" className="text-sm font-medium text-gray-700">Incluir Clima</label>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-medium text-gray-900">Generar Audio Ahora</p>
                    <p className="text-sm text-gray-500">
                      Genera el audio TTS inmediatamente (tarda más)
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(e) => setGenerateAudio(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* 5. Configuración de Audio */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Music className="h-5 w-5 mr-2" />
                  Configuración de Audio
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Toggle Cortinas */}
                  <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                    <div>
                      <Label className="font-medium">Insertar cortinas automáticamente</Label>
                      <p className="text-sm text-gray-500">
                        La IA insertará cortinas entre noticias
                      </p>
                    </div>
                    <Switch
                      checked={cortinasEnabled}
                      onCheckedChange={setCortinasEnabled}
                    />
                  </div>

                  {cortinasEnabled && (
                    <div className="space-y-2 pl-3 border-l-2 border-purple-200">
                      <div className="flex justify-between items-center">
                        <label className="text-sm font-medium text-gray-700">
                          Frecuencia de cortinas
                        </label>
                        <span className="text-sm font-bold text-purple-600">
                          Cada {cortinasFrequency} noticias
                        </span>
                      </div>
                      <DurationSlider
                        duration={cortinasFrequency}
                        onDurationChange={setCortinasFrequency}
                        min={2}
                        max={10}
                        step={1}
                      />
                      <p className="text-xs text-gray-500">
                        Sube cortinas en la sección Bibliotecas para usarlas.
                      </p>
                    </div>
                  )}

                  <div className="text-sm text-gray-500 bg-gray-50 p-3 rounded-lg">
                    <p>🎵 <strong>Música de fondo:</strong> Se configura en el timeline después de generar.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Panel de Acciones */}
          <div className="space-y-6">
            {/* Resumen */}
            <Card>
              <CardHeader>
                <CardTitle>Resumen</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Región:</span>
                  <span className="font-medium">
                    {selectedRegion || 'No seleccionada'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Radio:</span>
                  <span className="font-medium">
                    {selectedRadio || 'No seleccionada'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Categorías:</span>
                  <span className="font-medium">
                    {categories.filter(c => c.checked).length}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Duración:</span>
                  <span className="font-medium">{duration} min</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Audio:</span>
                  <span className="font-medium">
                    {generateAudio ? 'Sí' : 'No'}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Botón de Generar */}
            <GenerateButton
              isGenerating={isGenerating}
              progress={progress}
              status={status}
              error={error}
              onGenerate={handleGenerate}
              disabled={!selectedRegion || !selectedRadio}
            />

            {/* Botón de Guardar Plantilla */}
            <Button
              onClick={handleSave}
              variant="outline"
              className="w-full"
              disabled={!selectedRegion || !selectedRadio}
            >
              <Save className="mr-2 h-4 w-4" />
              Guardar como Plantilla
            </Button>
          </div>
        </div>
      </div>
    </div >
  )
}
