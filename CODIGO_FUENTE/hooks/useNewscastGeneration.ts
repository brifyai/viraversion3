import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface NewscastConfig {
    region: string
    radioName?: string
    categories: string[]
    categoryConfig?: any
    specificNewsUrls?: string[]
    targetDuration: number
    generateAudioNow: boolean
    frecuencia_anuncios?: number
    adCount?: number
    includeTimeWeather?: boolean
    newsTime?: string
    voiceModel?: string
    voiceWPM?: number
    voiceSettings?: {
        speed?: number
        pitch?: number
        volume?: number
        fmRadioEffect?: boolean
        fmRadioIntensity?: number
    }
    timeStrategy?: string
    hora_generacion?: string
    userId?: string
    audioConfig?: {
        cortinas_enabled: boolean
        cortinas_frequency: number
        cortina_default_id: string | null
        cortina_default_url: string | null
        background_music_enabled: boolean
        background_music_id: string | null
        background_music_volume: number
    }
}

interface GenerationResult {
    success: boolean
    newscastId?: string
    timeline?: any[]
    duration?: number
    error?: string
}

interface JobStatus {
    id: string
    status: 'pending' | 'processing' | 'completed' | 'failed'
    progress: number
    progressMessage: string
    newscastId?: string
    error?: string
}

// Constantes
const POLL_INTERVAL = 3000  // 3 segundos
const MAX_WAIT_TIME = 15 * 60 * 1000  // 15 minutos

// Detectar si usar modo async
// En producción (Netlify): siempre async
// En desarrollo: sync por defecto, pero se puede forzar async con:
//   - localStorage.setItem('forceAsyncMode', 'true')
//   - O agregando ?asyncMode=true en la URL
const isNetlifyProduction = typeof window !== 'undefined' &&
    (window.location.hostname.includes('netlify') ||
        window.location.hostname.includes('.app'))

const shouldUseAsyncMode = () => {
    if (typeof window === 'undefined') return false
    if (isNetlifyProduction) return true
    // Forzar async en desarrollo
    if (localStorage.getItem('forceAsyncMode') === 'true') return true
    if (window.location.search.includes('asyncMode=true')) return true
    return false
}

export function useNewscastGeneration() {
    const router = useRouter()
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [jobId, setJobId] = useState<string | null>(null)
    const pollingRef = useRef<NodeJS.Timeout | null>(null)

    // Función para consultar estado del job
    const pollJobStatus = async (id: string): Promise<JobStatus | null> => {
        try {
            console.log(`[Polling] Consultando job ${id}...`)
            const response = await fetch(`/api/job-status?id=${id}`)

            if (!response.ok) {
                console.error(`[Polling] Error HTTP: ${response.status}`)
                return null
            }

            const data = await response.json()
            console.log(`[Polling] Respuesta: status=${data.status}, progress=${data.progress}%`)
            return data
        } catch (err) {
            console.error('[Polling] Error en fetch:', err)
            return null
        }
    }

    // Limpiar polling
    const clearPolling = () => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }

    // Generación asíncrona con polling (para Netlify)
    const generateNewscastAsync = async (config: NewscastConfig): Promise<GenerationResult> => {
        setIsGenerating(true)
        setProgress(0)
        setStatus('Iniciando generación...')
        setError(null)

        try {
            // 1. Crear job
            const response = await fetch('/api/generate-newscast-async', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Error ${response.status}: ${errorText}`)
            }

            const { jobId: newJobId } = await response.json()
            setJobId(newJobId)
            setProgress(5)
            setStatus('Job creado, procesando...')

            // 2. Polling para obtener progreso
            const startTime = Date.now()

            return new Promise((resolve, reject) => {
                pollingRef.current = setInterval(async () => {
                    // Timeout máximo
                    if (Date.now() - startTime > MAX_WAIT_TIME) {
                        clearPolling()
                        setIsGenerating(false)  // ✅ FIX: Mover aquí
                        reject(new Error('Tiempo de espera agotado (15 min)'))
                        return
                    }

                    const jobStatus = await pollJobStatus(newJobId)

                    if (!jobStatus) return

                    // Actualizar UI
                    setProgress(jobStatus.progress)
                    setStatus(jobStatus.progressMessage || 'Procesando...')

                    // Verificar estado final
                    if (jobStatus.status === 'completed') {
                        clearPolling()
                        setProgress(100)
                        setStatus('¡Noticiero generado exitosamente!')
                        setIsGenerating(false)  // ✅ FIX: Mover aquí

                        resolve({
                            success: true,
                            newscastId: jobStatus.newscastId
                        })
                    } else if (jobStatus.status === 'failed') {
                        clearPolling()
                        setIsGenerating(false)  // ✅ FIX: Mover aquí
                        reject(new Error(jobStatus.error || 'Error en generación'))
                    }
                }, POLL_INTERVAL)
            })

        } catch (err) {
            clearPolling()
            const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
            setError(errorMessage)
            setStatus('Error en la generación')
            setIsGenerating(false)  // ✅ FIX: Mover aquí
            console.error('Error generando noticiero:', err)

            return { success: false, error: errorMessage }
        }
        // ✅ FIX: Removido finally block - ahora cada path maneja isGenerating
    }

    // Generación síncrona (para desarrollo local)
    const generateNewscastSync = async (config: NewscastConfig): Promise<GenerationResult> => {
        setIsGenerating(true)
        setProgress(0)
        setStatus('Iniciando generación...')
        setError(null)

        try {
            if (!config.region) throw new Error('Debes seleccionar una región')
            if (config.categories.length === 0) throw new Error('Debes seleccionar al menos una categoría')

            setProgress(10)
            setStatus('Conectando con el servidor...')

            const response = await fetch('/api/generate-newscast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    region: config.region,
                    radioName: config.radioName,
                    categories: config.categories,
                    categoryConfig: config.categoryConfig,
                    specificNewsUrls: config.specificNewsUrls,
                    targetDuration: config.targetDuration,
                    generateAudioNow: config.generateAudioNow,
                    frecuencia_anuncios: config.frecuencia_anuncios || 2,
                    adCount: config.adCount,
                    includeTimeWeather: config.includeTimeWeather || false,
                    newsTime: config.newsTime || new Date().toLocaleTimeString('es-CL', {
                        hour: '2-digit',
                        minute: '2-digit'
                    }),
                    voiceModel: config.voiceModel || 'default',
                    voiceWPM: config.voiceWPM || 150,
                    voiceSettings: config.voiceSettings,
                    timeStrategy: config.timeStrategy || 'auto',
                    hora_generacion: config.hora_generacion,
                    audioConfig: config.audioConfig,
                    userId: config.userId
                })
            })

            setProgress(30)
            setStatus('Procesando respuesta...')

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Error ${response.status}: ${errorText}`)
            }

            const data = await response.json()

            setProgress(90)
            setStatus('Finalizando...')

            if (data.success && data.newscastId) {
                setProgress(100)
                setStatus('¡Noticiero generado exitosamente!')

                // Guardar en localStorage
                if (data.timeline) {
                    try {
                        const keys = Object.keys(localStorage).filter(k => k.startsWith('newscast_'))
                        if (keys.length > 3) {
                            keys.slice(0, keys.length - 3).forEach(k => localStorage.removeItem(k))
                        }
                        localStorage.setItem(`newscast_${data.newscastId}`, JSON.stringify(data))
                    } catch (e) {
                        console.warn('localStorage lleno, limpiando cache...')
                        Object.keys(localStorage)
                            .filter(k => k.startsWith('newscast_'))
                            .forEach(k => localStorage.removeItem(k))
                    }
                }

                return {
                    success: true,
                    newscastId: data.newscastId,
                    timeline: data.timeline,
                    duration: data.duration
                }
            } else {
                throw new Error(data.error || 'Error desconocido al generar noticiero')
            }

        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
            setError(errorMessage)
            setStatus('Error en la generación')
            console.error('Error generando noticiero:', err)

            return { success: false, error: errorMessage }
        } finally {
            setIsGenerating(false)
        }
    }

    // Función principal: elige el modo según el entorno
    const generateNewscast = async (config: NewscastConfig): Promise<GenerationResult> => {
        // Usar shouldUseAsyncMode() para permitir forzar async en desarrollo
        const useAsync = shouldUseAsyncMode()
        if (useAsync) {
            console.log('🌐 Modo ASYNC: usando generación asíncrona con polling')
            return generateNewscastAsync(config)
        } else {
            console.log('💻 Modo SYNC: usando generación síncrona directa')
            return generateNewscastSync(config)
        }
    }

    const navigateToTimeline = (newscastId: string) => {
        router.push(`/timeline-noticiero/${newscastId}`)
    }

    const reset = () => {
        clearPolling()
        setIsGenerating(false)
        setProgress(0)
        setStatus('')
        setError(null)
        setJobId(null)
    }

    return {
        isGenerating,
        progress,
        status,
        error,
        jobId,
        generateNewscast,
        navigateToTimeline,
        reset
    }
}
