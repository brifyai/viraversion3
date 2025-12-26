import { createClient } from '@supabase/supabase-js'

// ============================================================
// BACKGROUND FUNCTION: Finalize Newscast (Audio Generation)
// ============================================================
// Genera audios TTS y ensambla el noticiero final
// ============================================================

// Types for Netlify Functions
interface NetlifyEvent {
    body: string | null
    headers: Record<string, string>
    httpMethod: string
}

interface NetlifyResponse {
    statusCode: number
    body: string
    headers?: Record<string, string>
}

// ============================================================
// SUPABASE CLIENT
// ============================================================
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ============================================================
// JOB STATUS UPDATE
// ============================================================
async function updateFinalizeJobStatus(
    jobId: string,
    status: string,
    progress: number,
    message: string
) {
    const { error } = await supabase
        .from('finalize_jobs')
        .update({
            status,
            progress,
            progress_message: message,
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId)

    if (error) {
        console.error('Error updating finalize job:', error)
    } else {
        console.log(`📊 Finalize Job ${jobId}: ${status} (${progress}%) - ${message}`)
    }
}

// ============================================================
// SANITIZE TEXT FOR TTS
// ============================================================
function sanitizeTextForTTS(text: string): string {
    if (!text) return ''
    let clean = text.replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/i, '')
    clean = clean.replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO)\s*[|•-]\s*/i, '')
    clean = clean.replace(/\s+\|\s+/g, '. ')
    return clean
}

// ============================================================
// VOICEMAKER TTS
// ============================================================
async function generateTTSAudio(
    text: string,
    voiceId: string,
    voiceSettings: any
): Promise<{ success: boolean; audioUrl?: string; duration?: number; error?: string }> {
    const VOICEMAKER_API_KEY = process.env.VOICEMAKER_API_KEY

    if (!VOICEMAKER_API_KEY) {
        return { success: false, error: 'VOICEMAKER_API_KEY not configured' }
    }

    // Map voice ID to VoiceMaker format
    const voiceMap: Record<string, string> = {
        'ai3-es-CL-Vicente': 'ai3-es-CL-Vicente',
        'ai3-es-CL-Eliana': 'ai3-es-CL-Eliana',
        'default': 'ai3-es-CL-Vicente'
    }

    const vmVoice = voiceMap[voiceId] || voiceMap['default']

    try {
        const response = await fetch('https://developer.voicemaker.in/voice/api', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${VOICEMAKER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                Engine: 'neural',
                VoiceId: vmVoice,
                LanguageCode: 'es-CL',
                Text: text,
                OutputFormat: 'mp3',
                SampleRate: '48000',
                Effect: 'default',
                MasterSpeed: String(voiceSettings?.speed ?? 0),
                MasterVolume: String(voiceSettings?.volume ?? 0),
                MasterPitch: String(voiceSettings?.pitch ?? 0)
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            return { success: false, error: `VoiceMaker error: ${response.status} ${errorText}` }
        }

        const data = await response.json()

        if (data.success && data.path) {
            // ✅ FIX: Calcular duración usando WPM ajustado (fórmula igual que generate-newscast-background)
            // Para Vicente: 175 WPM base, para Eliana: 162 WPM base
            const wordCount = text.split(/\s+/).length
            const isEliana = voiceId.includes('Eliana')
            const baseWPM = isEliana ? 162 : 175  // WPM calibrado por voz
            const CORRECTION_FACTOR = 0.89  // Calibrado: 157 WPM real medido
            const speedFactor = 1 + ((voiceSettings?.speed ?? 0) / 100)
            const effectiveWPM = Math.round(baseWPM * speedFactor * CORRECTION_FACTOR)
            const duration = Math.round((wordCount / effectiveWPM) * 60)

            console.log(`   📊 WPM: base ${baseWPM} × speed ${speedFactor.toFixed(2)} × factor ${CORRECTION_FACTOR} = ${effectiveWPM} (${wordCount} palabras = ${duration}s)`)

            return {
                success: true,
                audioUrl: data.path,
                duration
            }
        } else {
            return { success: false, error: 'VoiceMaker returned no path' }
        }
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'TTS error' }
    }
}

// ============================================================
// MAIN HANDLER
// ============================================================
const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
    console.log('🎵 Background Function finalize-newscast-background iniciada')
    console.log('========== DEBUG INFO ==========')
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`)
    console.log(`🖥️ Node version: ${process.version}`)
    console.log('================================')

    let jobId: string | undefined

    try {
        const body = JSON.parse(event.body || '{}')
        jobId = body.jobId
        const newscastId = body.newscastId
        const config = body.config || {}

        console.log(`📋 Finalize Job ID: ${jobId}`)
        console.log(`📋 Newscast ID: ${newscastId}`)

        if (!jobId || !newscastId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'jobId y newscastId son requeridos' }) }
        }

        await updateFinalizeJobStatus(jobId, 'processing', 5, 'Iniciando generación de audio...')

        // 1. Obtener noticiero
        const { data: noticiero, error: noticieroError } = await supabase
            .from('noticieros')
            .select('*')
            .eq('id', newscastId)
            .single()

        if (noticieroError || !noticiero) {
            throw new Error(`Noticiero no encontrado: ${noticieroError?.message}`)
        }

        await updateFinalizeJobStatus(jobId, 'processing', 10, 'Noticiero cargado...')

        // 2. Extraer timeline
        let timeline: any[] = []
        if (Array.isArray(noticiero.datos_timeline)) {
            timeline = noticiero.datos_timeline
        } else if (noticiero.datos_timeline?.timeline) {
            timeline = noticiero.datos_timeline.timeline
        }

        console.log(`📰 Timeline tiene ${timeline.length} items`)

        // 3. Obtener configuración de voz
        // ✅ FIX: Buscar voice_model en múltiples ubicaciones posibles
        const globalVoiceId = noticiero.metadata?.voice_model || noticiero.metadata?.config?.voiceModel || 'ai3-es-CL-Vicente'
        // ✅ FIX: Leer voice_settings correctamente del metadata
        const globalVoiceSettings = noticiero.metadata?.voice_settings || {
            speed: 1,   // Default base (frontend envía 1 por defecto)
            pitch: 0,
            volume: 2
        }

        console.log(`🎤 Voz: ${globalVoiceId}, Settings: ${JSON.stringify(globalVoiceSettings)}`)

        // 4. Generar audios faltantes
        const itemsNeedingAudio = timeline.filter((item: any) => !item.audioUrl && item.content)
        console.log(`🎙️ ${itemsNeedingAudio.length} items necesitan audio`)

        let generatedCount = 0
        for (let i = 0; i < itemsNeedingAudio.length; i++) {
            const item = itemsNeedingAudio[i]
            const progress = 10 + Math.round((i / itemsNeedingAudio.length) * 60)

            await updateFinalizeJobStatus(
                jobId,
                'processing',
                progress,
                `Generando audio ${i + 1}/${itemsNeedingAudio.length}...`
            )

            console.log(`🎙️ [${i + 1}/${itemsNeedingAudio.length}] Generando: ${item.title?.substring(0, 40)}...`)

            const ttsResult = await generateTTSAudio(
                sanitizeTextForTTS(item.content),
                item.voiceId || globalVoiceId,
                globalVoiceSettings
            )

            if (ttsResult.success && ttsResult.audioUrl) {
                item.audioUrl = ttsResult.audioUrl
                item.duration = ttsResult.duration
                generatedCount++
                console.log(`   ✅ Audio generado: ${ttsResult.duration}s`)
            } else {
                console.error(`   ❌ Error: ${ttsResult.error}`)
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 500))
        }

        console.log(`✅ ${generatedCount}/${itemsNeedingAudio.length} audios generados`)

        await updateFinalizeJobStatus(jobId, 'processing', 75, 'Guardando cambios...')

        // 5. Calcular duracion total REAL de los audios generados
        // FIX: Incluir silencios entre segmentos (1.5s por cada transicion)
        const audioItemsCount = timeline.filter((item: any) => item.audioUrl || item.duration).length
        const silenceGapSeconds = 1.5
        const totalSilenceTime = Math.max(0, audioItemsCount - 1) * silenceGapSeconds
        const totalAudioDuration = timeline.reduce((sum: number, item: any) => sum + (item.duration || 0), 0)
        const totalDuration = Math.round(totalAudioDuration + totalSilenceTime)
        console.log(`📊 Duración total: ${totalDuration}s [audio: ${totalAudioDuration}s + silencios: ${totalSilenceTime}s]`)

        // 6. Actualizar timeline en BD con metadata corregido
        const existingMetadata = typeof noticiero.datos_timeline === 'object' && noticiero.datos_timeline?.metadata
            ? noticiero.datos_timeline.metadata
            : {}

        const { error: updateTimelineError } = await supabase
            .from('noticieros')
            .update({
                datos_timeline: {
                    timeline: timeline,
                    metadata: {
                        ...existingMetadata,
                        totalDuration: totalDuration  // Actualizar con la duración real
                    }
                },
                updated_at: new Date().toISOString()
            })
            .eq('id', newscastId)

        if (updateTimelineError) {
            console.error('Error guardando timeline:', updateTimelineError)
        }

        await updateFinalizeJobStatus(jobId, 'processing', 90, 'Finalizando...')

        // 7. Marcar noticiero como completado
        const { error: updateNoticieroError } = await supabase
            .from('noticieros')
            .update({
                estado: 'completado',
                duracion_segundos: totalDuration,
                updated_at: new Date().toISOString()
            })
            .eq('id', newscastId)

        if (updateNoticieroError) {
            throw new Error(`Error actualizando noticiero: ${updateNoticieroError.message}`)
        }

        // 8. Marcar job como completado
        await supabase
            .from('finalize_jobs')
            .update({
                status: 'completed',
                progress: 100,
                progress_message: '¡Audio generado exitosamente!',
                duration: totalDuration,
                completed_at: new Date().toISOString()
            })
            .eq('id', jobId)

        console.log(`✅ Finalize Job ${jobId} completado. Duración total: ${totalDuration}s`)

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                jobId,
                newscastId,
                duration: totalDuration,
                audiosGenerated: generatedCount
            })
        }

    } catch (error) {
        console.error('❌ Finalize Background Function error:', error)

        if (jobId) {
            await supabase
                .from('finalize_jobs')
                .update({
                    status: 'failed',
                    progress: 0,
                    progress_message: 'Error en generación de audio',
                    error: error instanceof Error ? error.message : 'Error desconocido',
                    completed_at: new Date().toISOString()
                })
                .eq('id', jobId)
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: error instanceof Error ? error.message : 'Error desconocido' })
        }
    }
}

export { handler }

