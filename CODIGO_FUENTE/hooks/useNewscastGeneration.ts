import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface NewscastConfig {
    region: string
    categories: string[]
    targetDuration: number
    generateAudioNow: boolean
    frecuencia_anuncios?: number
    adCount?: number
    includeTimeWeather?: boolean
    newsTime?: string
    voiceModel?: string
    voiceWPM?: number // Palabras por minuto de la voz para cálculo preciso
    timeStrategy?: string
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

export function useNewscastGeneration() {
    const router = useRouter()
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [status, setStatus] = useState('')
    const [error, setError] = useState<string | null>(null)

    const generateNewscast = async (config: NewscastConfig): Promise<GenerationResult> => {
        setIsGenerating(true)
        setProgress(0)
        setStatus('Iniciando generación...')
        setError(null)

        try {
            // Validaciones básicas
            if (!config.region) {
                throw new Error('Debes seleccionar una región')
            }

            if (config.categories.length === 0) {
                throw new Error('Debes seleccionar al menos una categoría')
            }

            setProgress(10)
            setStatus('Conectando con el servidor...')

            // Llamada real al backend
            const response = await fetch('/api/generate-newscast', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    region: config.region,
                    categories: config.categories,
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
                    voiceWPM: config.voiceWPM || 150, // WPM para cálculo de duración
                    timeStrategy: config.timeStrategy || 'auto',
                    audioConfig: config.audioConfig
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

                // Guardar en localStorage para acceso rápido
                if (data.timeline) {
                    localStorage.setItem(`newscast_${data.newscastId}`, JSON.stringify(data))
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

            return {
                success: false,
                error: errorMessage
            }
        } finally {
            setIsGenerating(false)
        }
    }

    const navigateToTimeline = (newscastId: string) => {
        router.push(`/timeline-noticiero/${newscastId}`)
    }

    const reset = () => {
        setIsGenerating(false)
        setProgress(0)
        setStatus('')
        setError(null)
    }

    return {
        isGenerating,
        progress,
        status,
        error,
        generateNewscast,
        navigateToTimeline,
        reset
    }
}
