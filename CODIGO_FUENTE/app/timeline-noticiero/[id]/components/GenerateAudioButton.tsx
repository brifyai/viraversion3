'use client'

import { toast } from 'react-toastify'
import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Loader2, Music } from 'lucide-react'
import { supabase } from '@/lib/supabase'

interface GenerateAudioButtonProps {
    newscastId: string
    selectedNewsIds: string[]
    disabled: boolean
    targetDuration?: number
    onSuccess: (audioUrl: string) => void
    onGeneratingChange?: (isGenerating: boolean) => void
    onComplete?: () => void  // Callback para refrescar datos
}

// Detectar si usar modo async
const shouldUseAsyncMode = () => {
    if (typeof window === 'undefined') return false
    if (window.location.hostname.includes('netlify') || window.location.hostname.includes('.app')) return true
    if (localStorage.getItem('forceAsyncMode') === 'true') return true
    return false
}

export function GenerateAudioButton({
    newscastId,
    selectedNewsIds,
    disabled,
    targetDuration,
    onSuccess,
    onGeneratingChange,
    onComplete
}: GenerateAudioButtonProps) {
    const [isGenerating, setIsGenerating] = useState(false)
    const [progress, setProgress] = useState(0)
    const [statusMessage, setStatusMessage] = useState('')
    const subscriptionRef = useRef<any>(null)
    const timeoutRef = useRef<NodeJS.Timeout | null>(null)
    const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

    // Cleanup subscription
    const cleanupSubscription = () => {
        if (subscriptionRef.current) {
            supabase.removeChannel(subscriptionRef.current)
            subscriptionRef.current = null
        }
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
            timeoutRef.current = null
        }
        if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
        }
    }

    useEffect(() => {
        return () => cleanupSubscription()
    }, [])

    const updateGenerating = (value: boolean) => {
        setIsGenerating(value)
        onGeneratingChange?.(value)
    }

    // Generación síncrona (local)
    const handleGenerateSync = async () => {
        try {
            updateGenerating(true)
            setStatusMessage('Generando audio...')

            const response = await fetch('/api/finalize-newscast', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    newscastId,
                    selectedNewsIds,
                    includeMusic: false,
                    includeFx: false,
                    forceExactDuration: false,
                    targetDuration
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Error al finalizar')
            }

            if (data.success) {
                toast.success(`Audio generado exitosamente`)
                onSuccess(data.audioUrl)
            }

        } catch (err) {
            console.error('❌ Error finalizando:', err)
            toast.error(`Error: ${err instanceof Error ? err.message : 'Error desconocido'}`)
        } finally {
            updateGenerating(false)
            setStatusMessage('')
        }
    }

    // Generación asíncrona con Realtime (Netlify)
    const handleGenerateAsync = async () => {
        try {
            updateGenerating(true)
            setProgress(0)
            setStatusMessage('Iniciando generación de audio...')

            // 1. Crear job async
            const response = await fetch('/api/finalize-newscast-async', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    newscastId,
                    config: {
                        selectedNewsIds,
                        includeMusic: false,
                        includeFx: false,
                        forceExactDuration: false,
                        targetDuration
                    }
                })
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Error ${response.status}: ${errorText}`)
            }

            const { jobId } = await response.json()
            console.log(`[Realtime Audio] Suscribiéndose a job: ${jobId}`)

            // 2. Timeout de seguridad (10 minutos para audio)
            timeoutRef.current = setTimeout(() => {
                cleanupSubscription()
                updateGenerating(false)
                toast.error('Tiempo de espera agotado')
            }, 10 * 60 * 1000)

            // 3. Suscripción Realtime
            subscriptionRef.current = supabase
                .channel(`finalize-${jobId}`)
                .on(
                    'postgres_changes',
                    {
                        event: 'UPDATE',
                        schema: 'public',
                        table: 'finalize_jobs',
                        filter: `id=eq.${jobId}`
                    },
                    (payload: any) => {
                        const job = payload.new
                        console.log(`[Realtime Audio] status=${job.status}, progress=${job.progress}%`)

                        setProgress(job.progress)
                        setStatusMessage(job.progress_message || 'Procesando...')

                        if (job.status === 'completed') {
                            cleanupSubscription()
                            updateGenerating(false)
                            toast.success('Audio generado exitosamente')
                            onComplete?.()
                        } else if (job.status === 'failed') {
                            cleanupSubscription()
                            updateGenerating(false)
                            toast.error(job.error || 'Error generando audio')
                        }
                    }
                )
                .subscribe((status: string) => {
                    console.log(`[Realtime Audio] Subscription: ${status}`)
                })

            // 4. Fallback: Polling cada 5 segundos usando API route (evita 401)
            pollIntervalRef.current = setInterval(async () => {
                try {
                    const pollResponse = await fetch(`/api/job-status?type=finalize&id=${jobId}`)
                    if (!pollResponse.ok) {
                        console.warn(`[Polling Audio] Error: ${pollResponse.status}`)
                        return
                    }

                    const job = await pollResponse.json()

                    if (job) {
                        console.log(`[Polling Audio] status=${job.status}, progress=${job.progress}%`)
                        setProgress(job.progress)
                        setStatusMessage(job.progressMessage || 'Procesando...')

                        if (job.status === 'completed') {
                            cleanupSubscription()
                            updateGenerating(false)
                            toast.success('Audio generado exitosamente')
                            onComplete?.()
                        } else if (job.status === 'failed') {
                            cleanupSubscription()
                            updateGenerating(false)
                            toast.error(job.error || 'Error generando audio')
                        }
                    }
                } catch (err) {
                    console.error('[Polling Audio] Error:', err)
                }
            }, 5000)

        } catch (err) {
            cleanupSubscription()
            console.error('❌ Error finalizando:', err)
            toast.error(`Error: ${err instanceof Error ? err.message : 'Error desconocido'}`)
            updateGenerating(false)
        }
    }

    const handleGenerate = async () => {
        if (selectedNewsIds.length === 0) {
            toast.warning('Selecciona al menos una noticia para generar el audio')
            return
        }

        if (shouldUseAsyncMode()) {
            console.log('🌐 Modo ASYNC: usando Realtime para audio')
            await handleGenerateAsync()
        } else {
            console.log('💻 Modo SYNC: generación directa')
            await handleGenerateSync()
        }
    }

    return (
        <Button
            onClick={handleGenerate}
            disabled={disabled || isGenerating}
            className="flex-1"
            size="lg"
        >
            {isGenerating ? (
                <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {progress > 0 ? `${progress}% - ${statusMessage}` : 'Generando Audio...'}
                </>
            ) : (
                <>
                    <Music className="mr-2 h-5 w-5" />
                    Generar Audio ({selectedNewsIds.length} seleccionadas)
                </>
            )}
        </Button>
    )
}
