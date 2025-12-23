import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'

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
const MAX_WAIT_TIME = 15 * 60 * 1000  // 15 minutos

// Detectar si usar modo async
const isNetlifyProduction = typeof window !== 'undefined' &&
    (window.location.hostname.includes('netlify') ||
        window.location.hostname.includes('.app'))

const shouldUseAsyncMode = () => {
    if (typeof window === 'undefined') return false
    if (isNetlifyProduction) return true
    if (localStorage.getItem('forceAsyncMode') === 'true') return true
    if (window.location.search.includes('asyncMode=true')) return true
    return false
}

export function useNewscastGeneration() {
    const router = useRouter()
    const supabase = createClientComponentClient()

    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [jobId, setJobId] = useState<string | null>(null)

    const subscriptionRef = useRef<any>(null)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)

    // Limpiar suscripción Realtime
    const cleanupSubscription = () => {
        if (subscriptionRef.current) {
            console.log('[Realtime] Limpiando suscripción')
            supabase.removeChannel(subscriptionRef.current)
            subscriptionRef.current = null
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
    }

    // Limpiar al desmontar componente
    useEffect(() => {
        return () => cleanupSubscription()
    }, [])

    // Generación asíncrona con Realtime (para Netlify)
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
            setStatus('Job creado, esperando procesamiento...')

            console.log(`[Realtime] Suscribiéndose a job: ${newJobId}`)

            // 2. Suscribirse a cambios via Realtime (CERO polling!)
            return new Promise((resolve, reject) => {
                // Timeout de seguridad
                timeoutRef.current = setTimeout(() => {
                    cleanupSubscription()
                    setIsGenerating(false)
                    reject(new Error('Tiempo de espera agotado (15 min)'))
                }, MAX_WAIT_TIME)

                // Suscripción Realtime a la tabla newscast_jobs
                subscriptionRef.current = supabase
                    .channel(`job-${newJobId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'newscast_jobs',
                            filter: `id=eq.${newJobId}`
                        },
                        (payload: any) => {
                            const job = payload.new
                            console.log(`[Realtime] Update recibido: status=${job.status}, progress=${job.progress}%`)

                            // Actualizar UI
                            setProgress(job.progress)
                            setStatus(job.progress_message || 'Procesando...')

                            // Verificar estado final
                            if (job.status === 'completed') {
                                console.log('[Realtime] ✅ Job completado!')
                                cleanupSubscription()
                                setProgress(100)
                                setStatus('¡Noticiero generado exitosamente!')
                                setIsGenerating(false)

                                resolve({
                                    success: true,
                                    newscastId: job.newscast_id
                                })
                            } else if (job.status === 'failed') {
                                console.log('[Realtime] ❌ Job falló:', job.error)
                                cleanupSubscription()
                                setIsGenerating(false)
                                reject(new Error(job.error || 'Error en generación'))
                            }
                        }
                    )
                    .subscribe((status: string) => {
                        console.log(`[Realtime] Subscription status: ${status}`)
                        if (status === 'SUBSCRIBED') {
                            console.log('[Realtime] ✅ Suscripción activa - escuchando cambios')
                        }
                    })
            })

        } catch (err) {
            cleanupSubscription()
            const errorMessage = err instanceof Error ? err.message : 'Error desconocido'
            setError(errorMessage)
            setStatus('Error en la generación')
            setIsGenerating(false)
            console.error('Error generando noticiero:', err)

            return { success: false, error: errorMessage }
        }
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
        const useAsync = shouldUseAsyncMode()
        if (useAsync) {
            console.log('🌐 Modo ASYNC: usando Supabase Realtime (sin polling)')
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
        cleanupSubscription()
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
