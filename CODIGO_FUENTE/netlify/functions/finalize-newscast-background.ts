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
// GOOGLE CLOUD TTS - IMPLEMENTACIÓN PROFESIONAL MEJORADA
// Features: SSML avanzado, limpieza de Markdown, pitch por género,
//           etiquetas <s>, <prosody> para destacadas
// ============================================================

// Configuración de voces Neural2 para es-US
// WPM CALIBRADOS: Sincronizados con tts-providers.ts (2024-12-29)
// Solo 3 voces en producción: Sofía, Carlos, Diego
const VOICE_CONFIG: Record<string, { id: string; wpm: number; ssmlGender: 'MALE' | 'FEMALE' }> = {
    'es-US-Neural2-A': { id: 'es-US-Neural2-A', wpm: 152, ssmlGender: 'FEMALE' },  // Sofía
    'es-US-Neural2-B': { id: 'es-US-Neural2-B', wpm: 157, ssmlGender: 'MALE' },    // Carlos
    'es-US-Neural2-C': { id: 'es-US-Neural2-C', wpm: 166, ssmlGender: 'MALE' }     // Diego
}

// Diccionario de símbolos seguros (se pueden reemplazar globalmente)
const SAFE_SYMBOLS: Record<string, string> = {
    '%': ' por ciento',
    '&': ' y ',
    '+': ' más ',
    '=': ' igual a ',
    '°C': ' grados celsius',
    '°F': ' grados fahrenheit',
    '°': ' grados',
    '|': ', ',
    '/': ' por '
}

// Diccionario de abreviaturas (REQUIEREN límite de palabra \b para no romper "Ministro")
const ABBREVIATIONS: Record<string, string> = {
    'N°': 'número', 'n°': 'número', 'Nº': 'número', 'nº': 'número', 'No.': 'número',
    'km/h': 'kilómetros por hora', 'Km/h': 'kilómetros por hora',
    'm/s': 'metros por segundo',
    'Kg': 'kilos', 'kg': 'kilos', 'KG': 'kilos',
    'mts': 'metros', 'Mts': 'metros',
    'hrs': 'horas', 'Hrs': 'horas',
    'mins': 'minutos', 'min': 'minutos', // Ahora protegidos por \b
    'seg': 'segundos',                  // Ahora protegido por \b
    'aprox': 'aproximadamente', 'Aprox': 'aproximadamente',
    'etc': 'etcétera', 'Etc': 'etcétera',
    'vs': 'versus', 'VS': 'versus',
    'c/u': 'cada uno',
    'p/': 'para', 's/': 'sin', 'c/': 'con',
    '(s)': ''
}

// Siglas conocidas que se leen como palabra (NO deletrear)
const KNOWN_ACRONYMS = [
    'PDI', 'SAG', 'SII', 'ISP', 'AFP', 'IVA', 'PIB', 'INE', 'IPC',
    'ONU', 'FBI', 'CIA', 'NASA', 'UEFA', 'FIFA', 'NBA', 'NFL',
    'CEO', 'COO', 'CFO', 'CTO', 'URL', 'USB', 'GPS', 'LED', 'LCD',
    'COVID', 'SIDA', 'VIH', 'ADN', 'RUT', 'UDI', 'PPD',
    'OMS', 'OIT', 'BID', 'FMI', 'BCE', 'UE',
    'CAE', 'BRP', 'CVE', 'SML', 'UTM', 'APV',
    'CNN', 'BBC', 'TVN', 'CHV', 'T13'
]

// Palabras comunes en mayúsculas que NO son siglas
const COMMON_UPPERCASE = [
    'EL', 'LA', 'LOS', 'LAS', 'DE', 'EN', 'CON', 'POR', 'PARA', 'UN', 'UNA',
    'QUE', 'SE', 'ES', 'AL', 'DEL', 'MAS', 'MÁS', 'SU', 'SUS', 'NO', 'SI', 'SÍ',
    'YA', 'LE', 'LO', 'ME', 'MI', 'TU', 'TE', 'NOS', 'LES'
]

/**
 * Convierte texto plano a SSML optimizado para Google Cloud TTS
 * - Limpia formato Markdown
 * - Reemplaza símbolos con palabras (Moneda, Unidades)
 * - Agrega pausas y etiquetas <s>
 * - Procesa siglas inteligentemente
 * - Soporta <prosody> para noticias destacadas
 */
function textToSSML(text: string, isHighlighted: boolean = false): string {
    let cleaned = text

    // 0. LIMPIEZA CRÍTICA PRIMERO
    cleaned = cleaned
        .replace(/\*/g, '')
        .replace(/#/g, '')
        .replace(/_{2,}/g, '')
        .replace(/~{2,}/g, '')

    // 1. Limpieza de Markdown
    cleaned = cleaned
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/---+/g, '')
        .replace(/===+/g, '')
        .replace(/^[-+]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .replace(/>/g, '')
        .replace(/\|/g, ', ')
        .replace(/\\/g, '')
        .replace(/\[\s*\]/g, '')
        .replace(/\[x\]/gi, '')
        .replace(/:\w+:/g, '')

    // 2. CORRECCIONES FONÉTICAS ESPECÍFICAS (Manuales)
    // Expandir EEUU antes de que se procese como sigla
    cleaned = cleaned
        .replace(/\bEE\.?UU\.?\b/g, 'Estados Unidos')
        .replace(/\bEEUU\b/g, 'Estados Unidos')

    // 3. MONEDA LOCALIZADA ($ -> pesos al final)
    // Transforma "$ 500.000" o "$500.000" -> "500.000 pesos"
    cleaned = cleaned.replace(/\$\s?(\d[\d\.]*)/g, '$1 pesos')

    // 4. Reemplazo de SÍMBOLOS SEGUROS
    for (const [symbol, replacement] of Object.entries(SAFE_SYMBOLS)) {
        const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        cleaned = cleaned.replace(new RegExp(escapedSymbol, 'g'), replacement)
    }

    // 5. Reemplazo de ABREVIATURAS con LÍMITE DE PALABRA (\b)
    const sortedAbbrs = Object.entries(ABBREVIATIONS).sort((a, b) => b[0].length - a[0].length)

    for (const [abbr, replacement] of sortedAbbrs) {
        const escapedAbbr = abbr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

        // Si termina en punto (ej: "No."), el punto delimita. Si no, usamos \b.
        if (abbr.endsWith('.')) {
            cleaned = cleaned.replace(new RegExp(`\\b${escapedAbbr}(?=\\s|$)`, 'gi'), replacement)
        } else {
            cleaned = cleaned.replace(new RegExp(`\\b${escapedAbbr}\\b`, 'gi'), replacement)
        }
    }

    // 6. Limpiar números con formato de miles (155.772 → 155772)
    // Neural2 lee mejor los números enteros sin puntos
    cleaned = cleaned.replace(/(\d)\.(\d{3})(?!\d)/g, '$1$2')

    // 7. Limpiar espacios múltiples y saltos
    cleaned = cleaned.replace(/\s+/g, ' ').replace(/\n+/g, ' ').replace(/\r+/g, '').trim()

    // 8. Procesar por oraciones
    const sentences = cleaned.split(/(?<=[.!?])\s+/)
    let ssmlBody = ''

    for (const sentence of sentences) {
        if (!sentence.trim()) continue

        let processed = sentence

        // 9. Procesar siglas (2-4 letras mayúsculas)
        processed = processed.replace(/\b([A-ZÁÉÍÓÚÑ]{2,4})\b/g, (match) => {
            if (COMMON_UPPERCASE.includes(match)) return match
            if (KNOWN_ACRONYMS.includes(match)) return match
            // Para las desconocidas usamos SSML para deletrear
            return `<say-as interpret-as="characters">${match}</say-as>`
        })

        // 10. Pausas
        processed = processed.replace(/,\s+/g, ', <break time="250ms"/> ')

        // 11. Envolver oración en <s> con pausa al final
        let pauseTime = '600ms'
        if (sentence.endsWith('?') || sentence.endsWith('!')) pauseTime = '700ms'

        ssmlBody += `<s>${processed.trim()}</s><break time="${pauseTime}"/> `
    }

    // 12. Aplicar <prosody> si es noticia destacada
    if (isHighlighted) {
        ssmlBody = `<prosody rate="medium" pitch="+1st">${ssmlBody}</prosody>`
    }

    return `<speak>${ssmlBody}</speak>`
}

/**
 * speakingRate = 1.0 base + ajuste del usuario
 * WPM ya calibrados, no se necesita fórmula wpm/150
 */
function calculateSpeakingRate(wpm: number, userAdjust: number = 0): number {
    // Calcular speakingRate
    // REFERENCIA USUARIO: Default speakingRate = 0.9 (ligeramente más lento y pausado)
    // El ajuste del usuario se aplica sobre este base
    const baseRate = 0.9
    const adjusted = baseRate + (userAdjust / 100)
    return Math.max(0.25, Math.min(4.0, adjusted))
}

/**
 * Genera audio TTS con Google Cloud (implementación profesional)
 * - Pitch diferenciado: -2.0 masculino, -1.0 femenino
 * - effectsProfileId: medium-bluetooth-speaker (elimina metálico)
 * - sampleRateHertz: 24000 (calidad óptima)
 */
async function generateTTSAudio(
    text: string,
    voiceId: string,
    voiceSettings: any,
    isHighlighted: boolean = false
): Promise<{ success: boolean; audioData?: Buffer; duration?: number; error?: string }> {
    const GOOGLE_CLOUD_TTS_API_KEY = process.env.GOOGLE_CLOUD_TTS_API_KEY

    if (!GOOGLE_CLOUD_TTS_API_KEY) {
        return { success: false, error: 'GOOGLE_CLOUD_TTS_API_KEY not configured' }
    }

    // Obtener configuración de la voz
    const voiceConfig = VOICE_CONFIG[voiceId] || VOICE_CONFIG['es-US-Neural2-B']
    const languageCode = 'es-US'

    // Calcular speakingRate
    const speakingRate = calculateSpeakingRate(voiceConfig.wpm, voiceSettings?.speed ?? 0)

    // Determinar pitch según género de voz
    // Masculino: -2.0 (grave, autoridad), Femenino: -1.0 (quita chillón, mantiene calidez)
    const isFemaleVoice = voiceConfig.ssmlGender === 'FEMALE'
    const basePitch = isFemaleVoice ? -1.0 : -2.0
    const finalPitch = voiceSettings?.pitch !== undefined ? voiceSettings.pitch : basePitch

    // Convertir texto a SSML profesional
    const ssmlText = textToSSML(text, isHighlighted)

    try {
        console.log(`   🎤 TTS Pro: ${voiceConfig.id}, wpm=${voiceConfig.wpm} → rate=${speakingRate.toFixed(2)}, pitch=${finalPitch}, highlighted=${isHighlighted}`)

        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_CLOUD_TTS_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { ssml: ssmlText },
                voice: {
                    languageCode,
                    name: voiceConfig.id,
                    ssmlGender: voiceConfig.ssmlGender
                },
                audioConfig: {
                    audioEncoding: 'MP3',
                    sampleRateHertz: 24000,
                    speakingRate,
                    pitch: finalPitch,
                    // Perfil optimizado: elimina tonos metálicos, ecualiza medios
                    effectsProfileId: ['medium-bluetooth-speaker-class-device']
                }
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            console.error(`   ❌ TTS Error ${response.status}:`, errorText.substring(0, 200))
            return { success: false, error: `TTS error: ${response.status}` }
        }

        const data = await response.json()

        if (data.audioContent) {
            const audioBuffer = Buffer.from(data.audioContent, 'base64')

            // ✅ CÁLCULO REAL DE DURACIÓN basado en tamaño de MP3
            // Google Cloud TTS @ 24kHz: calibrado con datos reales
            // Fórmula: duración = tamaño_bytes / bytes_por_segundo
            const BYTES_PER_SECOND = 8000  // Calibrado 2024-12-29 (antes 7500)
            const realDuration = Math.round(audioBuffer.length / BYTES_PER_SECOND)

            console.log(`   ✅ Audio Pro: ${audioBuffer.length} bytes, ${realDuration}s REAL, pitch=${finalPitch}`)

            return {
                success: true,
                audioData: audioBuffer,
                duration: realDuration
            }
        } else {
            return { success: false, error: 'TTS: no audioContent in response' }
        }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'TTS error'
        console.error(`   ❌ TTS Exception:`, errorMsg)
        return { success: false, error: errorMsg }
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
        const globalVoiceId = noticiero.metadata?.voice_model || noticiero.metadata?.config?.voiceModel || 'es-US-Neural2-B'
        // Valores por defecto: velocidad normal (0 = sin ajuste)
        const globalVoiceSettings = noticiero.metadata?.voice_settings || {
            speed: 0,   // 0 = velocidad normal (1.0 de Google)
            pitch: 0,   // 0 = tono normal
            volume: 0   // 0 = volumen normal
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

            // Determinar si es noticia destacada (para aplicar <prosody>)
            const isHighlighted = item.es_destacada === true ||
                item.type === 'intro' ||
                item.type === 'outro'

            const ttsResult = await generateTTSAudio(
                sanitizeTextForTTS(item.content),
                item.voiceId || globalVoiceId,
                globalVoiceSettings,
                isHighlighted
            )

            if (ttsResult.success && ttsResult.audioData) {
                // Guardar audio como Base64 para reproducción desde frontend
                item.audioBase64 = ttsResult.audioData.toString('base64')
                item.duration = ttsResult.duration
                generatedCount++
                console.log(`   ✅ Audio OK: ${ttsResult.duration}s`)

                // Registrar uso de TTS en la base de datos
                const characters = item.content?.length || 0
                const ttsCost = (characters / 1_000_000) * 16 // $16/1M chars Neural2

                await supabase
                    .from('uso_tokens')
                    .insert({
                        user_id: noticiero.user_id,
                        servicio: 'google-cloud-tts',
                        operacion: 'tts',
                        tokens_usados: characters,
                        costo: ttsCost,
                        moneda: 'USD',
                        metadata: {
                            voice: item.voiceId || globalVoiceId,
                            duration_seconds: ttsResult.duration,
                            audio_bytes: ttsResult.audioData.length,
                            item_type: item.type,
                            newscast_id: newscastId
                        },
                        created_at: new Date().toISOString()
                    })

                console.log(`   📊 TTS logged: ${characters} chars, ${ttsCost.toFixed(6)}`)
            } else {
                console.error(`   ❌ Error: ${ttsResult.error}`)
            }

            // Small delay to avoid rate limiting
            await new Promise(r => setTimeout(r, 500))
        }

        console.log(`✅ ${generatedCount}/${itemsNeedingAudio.length} audios generados`)

        await updateFinalizeJobStatus(jobId, 'processing', 75, 'Guardando cambios...')

        // 5. Calcular duracion total REAL de los audios generados
        // ✅ NOTA: No agregamos silencios porque la concatenación no los incluye
        const totalDuration = timeline.reduce((sum: number, item: any) => sum + (item.duration || 0), 0)
        console.log(`📊 Duración total REAL: ${totalDuration}s (${Math.floor(totalDuration / 60)}:${(totalDuration % 60).toString().padStart(2, '0')})`)

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
