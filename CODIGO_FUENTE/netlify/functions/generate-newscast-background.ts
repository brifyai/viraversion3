import { createClient } from '@supabase/supabase-js'
import { CHUTES_CONFIG, getChutesHeaders } from './lib/chutes-config'
import {
    getDirectorPrompt,
    getHumanizerSystemPrompt,
    getHumanizerUserPrompt,
    getReductionPrompt,
    getCierrePrompt,
    ANTI_REPETITION_SYSTEM
} from '../../lib/prompts'

// ============================================================
// BACKGROUND FUNCTION: Generate Newscast (FULL VERSION)
// ============================================================
// Migración completa del API route /api/generate-newscast
// Incluye: IA Directora, Humanización, Clima, Publicidades, etc.
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
// CONSTANTS
// ============================================================
const TIMING_CONSTANTS = {
    INTRO_DURATION: 12,
    OUTRO_DURATION: 15,
    AD_DURATION: 25,
    SILENCE_BETWEEN_NEWS: 1.5
}

// Gemini tiene 60 RPM (más que Chutes)
const BATCH_SIZE = 4
const BATCH_DELAY = 1000

// ============================================================
// WEATHER SERVICE
// ============================================================
const REGION_TO_CITY: { [key: string]: string } = {
    'Arica y Parinacota': 'Arica,CL',
    'Tarapacá': 'Iquique,CL',
    'Antofagasta': 'Antofagasta,CL',
    'Atacama': 'Copiapo,CL',
    'Coquimbo': 'La Serena,CL',
    'Valparaíso': 'Valparaiso,CL',
    'Metropolitana de Santiago': 'Santiago,CL',
    'O\'Higgins': 'Rancagua,CL',
    'Maule': 'Talca,CL',
    'Ñuble': 'Chillan,CL',
    'Biobío': 'Concepcion,CL',
    'Araucanía': 'Temuco,CL',
    'Los Ríos': 'Valdivia,CL',
    'Los Lagos': 'Puerto Montt,CL',
    'Aysén': 'Coyhaique,CL',
    'Magallanes': 'Punta Arenas,CL',
    'Nacional': 'Santiago,CL'
}

async function getWeather(region: string): Promise<string | null> {
    try {
        const API_KEY = process.env.OPENWEATHER_API_KEY
        if (!API_KEY) return null

        const city = REGION_TO_CITY[region] || 'Santiago,CL'
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric&lang=es`

        const response = await fetch(url)
        if (!response.ok) return null

        const data = await response.json()
        const { temp } = data.main
        const description = data.weather[0].description
        return `con ${Math.round(temp)} grados y ${description}`
    } catch (error) {
        console.error('Weather error:', error)
        return null
    }
}

// ============================================================
// TEXT PREPARATION
// ============================================================
function prepareContentForAI(text: string, maxChars: number = 4000): string {
    if (!text) return ''

    let cleaned = text
        .replace(/Foto:.*?\./gi, '')
        .replace(/Imagen:.*?\./gi, '')
        .replace(/Créditos?:.*?\./gi, '')
        .replace(/REUTERS|AFP|AP|EFE|AGENCIA UNO|ATON|PHOTOSPORT|MEGA/gi, '')
        .replace(/Por [A-Z][a-záéíóúñ]+ [A-Z][a-záéíóúñ]+\.?/g, '')
        .replace(/\d{1,2} de \w+ de \d{4}/g, '')
        .replace(/Sigue leyendo:.*$/gis, '')
        .replace(/Te puede interesar:.*$/gis, '')
        .replace(/\s+/g, ' ')
        .trim()

    if (cleaned.length > maxChars) {
        const truncated = cleaned.substring(0, maxChars)
        const lastPeriod = truncated.lastIndexOf('.')
        if (lastPeriod > maxChars * 0.6) {
            cleaned = truncated.substring(0, lastPeriod + 1)
        }
        console.log(`   ✂️ Contenido truncado: ${text.length} → ${cleaned.length} chars`)
    }

    return cleaned
}

// ============================================================
// IA DIRECTORA
// ============================================================
interface PlanNoticiero {
    noticias: {
        id: string
        orden: number
        segundos_asignados: number
        palabras_objetivo: number
        es_destacada: boolean
    }[]
    inserciones: {
        despues_de_orden: number
        tipo: 'cortina' | 'publicidad'
        publicidad_id?: string
        duracion_segundos: number
    }[]
    duracion_total_estimada: number
}

function calcularImportancia(titulo: string, categoria: string): number {
    let importancia = 5
    const altaImportancia = ['urgente', 'última hora', 'breaking', 'importante', 'alerta',
        'presidente', 'gobierno', 'crisis', 'emergencia', 'muertos']

    const tituloLower = titulo.toLowerCase()
    for (const keyword of altaImportancia) {
        if (tituloLower.includes(keyword)) importancia += 2
    }

    if (['Política', 'Economía', 'Nacionales'].includes(categoria)) importancia += 1
    return Math.min(10, importancia)
}

async function planificarNoticiero(
    noticias: any[],
    duracionObjetivo: number,
    publicidades: any[],
    wpm: number
): Promise<PlanNoticiero> {
    console.log(`🎬 === IA DIRECTORA ===`)
    console.log(`   📰 Noticias: ${noticias.length}`)
    console.log(`   ⏱️ Duración objetivo: ${duracionObjetivo}s`)
    console.log(`   📢 Publicidades: ${publicidades.length}`)

    const tiempoPublicidad = publicidades.reduce((sum, p) => sum + (p.duracion_segundos || 25), 0)
    const tiempoParaNoticias = duracionObjetivo - 45 - tiempoPublicidad
    const segundosPorNoticia = Math.floor(tiempoParaNoticias / noticias.length)
    const palabrasPorNoticia = Math.round((segundosPorNoticia / 60) * wpm)

    // Usar prompt centralizado
    const DIRECTOR_PROMPT = getDirectorPrompt({
        noticias,
        palabrasPorNoticia,
        duracionObjetivo
    })

    try {
        const response = await fetch(CHUTES_CONFIG.endpoints.chatCompletions, {
            method: 'POST',
            headers: getChutesHeaders(),
            body: JSON.stringify({
                model: CHUTES_CONFIG.model,
                messages: [{ role: 'user', content: DIRECTOR_PROMPT }],
                max_tokens: 1200,
                temperature: 0.3
            })
        })

        if (response.ok) {
            const data = await response.json()
            const content = data.choices?.[0]?.message?.content?.trim()
            if (content) {
                const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
                const plan = JSON.parse(cleanContent)

                // Asegurar todas las noticias estén incluidas
                const idsEnPlan = new Set(plan.noticias.map((n: any) => n.id))
                let maxOrden = Math.max(...plan.noticias.map((n: any) => n.orden), 0)

                for (const noticia of noticias) {
                    if (!idsEnPlan.has(noticia.id)) {
                        maxOrden++
                        plan.noticias.push({
                            id: noticia.id,
                            orden: maxOrden,
                            palabras_objetivo: palabrasPorNoticia,
                            es_destacada: false
                        })
                    }
                }

                console.log(`✅ Plan IA generado: ${plan.noticias.length} noticias`)

                // Agregar inserciones de publicidad
                const inserciones: any[] = []
                if (publicidades.length > 0) {
                    const intervalo = Math.floor(noticias.length / (publicidades.length + 1))
                    publicidades.forEach((pub: any, i: number) => {
                        inserciones.push({
                            despues_de_orden: (i + 1) * intervalo,
                            tipo: 'publicidad',
                            publicidad_id: pub.id,
                            duracion_segundos: pub.duracion_segundos || 25
                        })
                    })
                }

                return {
                    noticias: plan.noticias.sort((a: any, b: any) => a.orden - b.orden),
                    inserciones,
                    duracion_total_estimada: duracionObjetivo
                }
            }
        }
    } catch (error) {
        console.log('⚠️ IA Directora falló, usando fallback')
    }

    // Fallback: orden simple
    return {
        noticias: noticias.map((n, i) => ({
            id: n.id,
            orden: i + 1,
            segundos_asignados: segundosPorNoticia,
            palabras_objetivo: palabrasPorNoticia,
            es_destacada: i === 0
        })),
        inserciones: publicidades.map((pub, i) => ({
            despues_de_orden: Math.floor((i + 1) * noticias.length / (publicidades.length + 1)),
            tipo: 'publicidad' as const,
            publicidad_id: pub.id,
            duracion_segundos: pub.duracion_segundos || 25
        })),
        duracion_total_estimada: duracionObjetivo
    }
}

// ============================================================
// HUMANIZATION
// ============================================================
const TRANSITION_PHRASES: { [key: string]: string[] } = {
    politica: ['En el ámbito político,', 'Pasando a la política,'],
    economia: ['En economía,', 'En el ámbito económico,'],
    deportes: ['En deportes,', 'En noticias deportivas,'],
    internacional: ['A nivel internacional,', 'Desde el exterior,'],
    general: ['Continuando,', 'Además,', 'También,']
}

function getTransitionPhrase(index: number, category: string, previousCategory?: string): string {
    if (index === 0) return ''

    if (previousCategory && previousCategory !== category) {
        const catLower = category.toLowerCase()
        const phrases = TRANSITION_PHRASES[catLower] || TRANSITION_PHRASES['general']
        return phrases[Math.floor(Math.random() * phrases.length)] + ' '
    }

    const generic = ['Asimismo,', 'Por otro lado,', 'Además,', 'También,']
    return generic[Math.floor(Math.random() * generic.length)] + ' '
}

// ============================================================
// WORD LIMIT ENFORCEMENT
// ============================================================
function enforceWordLimit(text: string, targetWords: number, tolerance: number = 0.10): string {
    const words = text.split(/\s+/)
    const maxWords = Math.ceil(targetWords * (1 + tolerance))

    if (words.length <= maxWords) return text

    console.log(`   ✂️ Truncando: ${words.length} → ${maxWords} palabras`)

    const truncated = words.slice(0, maxWords).join(' ')

    // Buscar última oración completa
    const lastPeriodIndex = truncated.lastIndexOf('.')
    const lastQuestionIndex = truncated.lastIndexOf('?')
    const lastExclamIndex = truncated.lastIndexOf('!')

    const lastSentenceEnd = Math.max(lastPeriodIndex, lastQuestionIndex, lastExclamIndex)

    // Cortar en oración completa si hay una en al menos el 50% del texto
    if (lastSentenceEnd > truncated.length * 0.5) {
        return truncated.substring(0, lastSentenceEnd + 1)
    }

    // Si no hay oración completa, retornar texto original
    return text
}

async function humanizeText(
    text: string,
    region: string,
    targetWords: number = 120,
    transitionPhrase: string = ''
): Promise<{ content: string; success: boolean }> {
    if (!text || text.length < 50) {
        return { content: text, success: false }
    }

    const cleanedText = prepareContentForAI(text, 4000)

    // Extraer tema central para anclaje
    const extractTopic = (text: string): string => {
        const firstSentence = text.split(/[.!?]/)[0]?.trim() || ''
        return firstSentence.substring(0, 100).replace(/["']/g, '')
    }
    const topicAnchor = extractTopic(cleanedText)

    // Usar prompts centralizados
    const systemPrompt = getHumanizerSystemPrompt(targetWords)
    const userPrompt = getHumanizerUserPrompt({
        region,
        topicAnchor,
        cleanedText,
        transitionPhrase
    })

    // Reintentar con backoff exponencial para errores 429
    const MAX_RETRIES = 3
    const BASE_DELAY = 2000  // 2 segundos base

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await fetch(CHUTES_CONFIG.endpoints.chatCompletions, {
                method: 'POST',
                headers: getChutesHeaders(),
                body: JSON.stringify({
                    model: CHUTES_CONFIG.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: Math.max(500, targetWords * 4),
                    temperature: 0.5
                })
            })

            if (response.status === 429) {
                if (attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY * Math.pow(2, attempt) // 2s, 4s, 8s
                    console.log(`   🔄 Rate limit (429), reintentando en ${delay / 1000}s... (${attempt + 1}/${MAX_RETRIES})`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                    continue
                }
                console.warn(`⚠️ Chutes AI error: 429 después de ${MAX_RETRIES} reintentos`)
                return { content: cleanedText.substring(0, 500), success: false }
            }

            if (!response.ok) {
                console.warn(`⚠️ Chutes AI error: ${response.status}`)
                return { content: cleanedText.substring(0, 500), success: false }
            }

            const data = await response.json()
            let content = data.choices?.[0]?.message?.content?.trim()

            if (!content) {
                return { content: cleanedText.substring(0, 500), success: false }
            }

            const wordCount = content.split(/\s+/).length

            // Si excede el objetivo por más del 20%, usar prompt de reducción
            if (wordCount > targetWords * 1.2) {
                console.log(`   ⚠️ Exceso: ${wordCount}/${targetWords} palabras, solicitando reducción...`)

                // Usar prompt centralizado - extraer tema del primer párrafo
                const reductionTopic = content.split(/[.!?]/)[0]?.substring(0, 100) || 'noticia'
                const reducePrompt = getReductionPrompt({ wordCount, targetWords, content, reductionTopic })

                const reduceResponse = await fetch(CHUTES_CONFIG.endpoints.chatCompletions, {
                    method: 'POST',
                    headers: getChutesHeaders(),
                    body: JSON.stringify({
                        model: CHUTES_CONFIG.model,
                        messages: [{ role: 'user', content: reducePrompt }],
                        max_tokens: targetWords * 3,
                        temperature: 0.3
                    })
                })

                if (reduceResponse.ok) {
                    const reduceData = await reduceResponse.json()
                    const reducedContent = reduceData.choices?.[0]?.message?.content?.trim()
                    if (reducedContent) {
                        content = reducedContent
                        console.log(`   ✅ Reducido: ${reducedContent.split(/\s+/).length} palabras`)
                    }
                }
            }

            // ANTI-REPETICIÓN: Detectar y corregir repeticiones
            const repetitionAnalysis = detectRepetitions(content)

            if (!repetitionAnalysis.isValid) {
                console.log(`   ⚠️ Repeticiones detectadas (score: ${repetitionAnalysis.score})`)

                // Intentar corregir con prompt correctivo
                const correctivePrompt = buildCorrectivePrompt(repetitionAnalysis.issues, content, targetWords)

                const retryResponse = await fetch(CHUTES_CONFIG.endpoints.chatCompletions, {
                    method: 'POST',
                    headers: getChutesHeaders(),
                    body: JSON.stringify({
                        model: CHUTES_CONFIG.model,
                        messages: [
                            { role: 'system', content: ANTI_REPETITION_SYSTEM },
                            { role: 'user', content: correctivePrompt }
                        ],
                        max_tokens: Math.max(600, targetWords * 4),
                        temperature: 0.7
                    })
                })

                if (retryResponse.ok) {
                    const retryData = await retryResponse.json()
                    const correctedContent = retryData.choices?.[0]?.message?.content?.trim()

                    if (correctedContent) {
                        const retryAnalysis = detectRepetitions(correctedContent)

                        if (retryAnalysis.score > repetitionAnalysis.score) {
                            console.log(`   ✅ Corrección anti-repetición: score ${repetitionAnalysis.score} → ${retryAnalysis.score}`)
                            content = correctedContent
                        }
                    }
                }
            }

            console.log(`   ✅ Humanizado: ${content.split(/\s+/).length} palabras`)
            return { content, success: true }
        } catch (error) {
            console.error('❌ Error humanizing:', error)
            return { content: cleanedText.substring(0, 500), success: false }
        }
    }

    // Fallback si el loop termina sin retornar (no debería pasar)
    return { content: text.substring(0, 500), success: false }
}

// ============================================================
// DETECCIÓN DE REPETICIONES
// ============================================================
interface RepetitionIssue {
    type: string
    severity: 'warning' | 'critical'
    details: string
}

interface RepetitionAnalysis {
    isValid: boolean
    score: number
    issues: RepetitionIssue[]
}

function detectRepetitions(text: string): RepetitionAnalysis {
    if (!text || text.trim().length < 50) {
        return { isValid: true, score: 100, issues: [] }
    }

    const issues: RepetitionIssue[] = []
    const words = text.toLowerCase().split(/\s+/)
    const phraseMap = new Map<string, number>()

    // Detectar frases de 5+ palabras repetidas
    for (let len = 5; len <= 7; len++) {
        for (let i = 0; i <= words.length - len; i++) {
            const phrase = words.slice(i, i + len).join(' ')
            phraseMap.set(phrase, (phraseMap.get(phrase) || 0) + 1)
        }
    }

    for (const [phrase, count] of phraseMap) {
        if (count >= 2 && phrase.split(' ').length >= 5) {
            issues.push({
                type: 'exact_phrase',
                severity: count >= 3 ? 'critical' : 'warning',
                details: `Frase repetida ${count}x: "${phrase.substring(0, 50)}..."`
            })
        }
    }

    // Calcular vocabulario único
    const uniqueWords = new Set(words.filter(w => w.length > 3))
    const vocabRatio = uniqueWords.size / words.filter(w => w.length > 3).length

    if (vocabRatio < 0.5) {
        issues.push({
            type: 'vocabulary',
            severity: 'critical',
            details: `Vocabulario único: ${Math.round(vocabRatio * 100)}% (mínimo: 50%)`
        })
    }

    const criticalCount = issues.filter(i => i.severity === 'critical').length
    const warningCount = issues.filter(i => i.severity === 'warning').length
    const score = Math.max(0, 100 - (criticalCount * 25) - (warningCount * 8))

    return {
        isValid: criticalCount === 0,
        score,
        issues: issues.slice(0, 3)
    }
}

function buildCorrectivePrompt(issues: RepetitionIssue[], previousContent: string, targetWords: number): string {
    const issueDescriptions = issues.map(i => `- ${i.details}`).join('\n')

    return `⚠️ CORRECCIÓN REQUERIDA: El texto anterior contenía REPETICIONES inaceptables.

PROBLEMAS DETECTADOS:
${issueDescriptions}

TEXTO PROBLEMÁTICO:
"${previousContent.substring(0, 600)}..."

INSTRUCCIONES DE CORRECCIÓN:
✅ DEBES:
- REFORMULAR COMPLETAMENTE sin repetir estructuras ni frases.
- Usar solo oraciones de máx. 14 palabras.
- VARIAR el vocabulario: no repitas las mismas palabras.
- Escribir natural y fluido, como hablarías al aire.

❌ NUNCA:
- Repitas frases, ideas o estructuras.
- Inicies varias oraciones con las mismas palabras.

🎯 EXTENSIÓN: ${targetWords} palabras. Mejor menos que repetido.

→ Devuelve SOLO el guion corregido sin repeticiones.`
}

// ============================================================
// TIME FORMATTING
// ============================================================
function formatTimeNatural(date: Date): string {
    const hour = date.getHours()
    const minutes = date.getMinutes()

    let periodo = ''
    if (hour >= 5 && hour < 12) periodo = 'de la mañana'
    else if (hour >= 12 && hour < 14) periodo = 'del mediodía'
    else if (hour >= 14 && hour < 20) periodo = 'de la tarde'
    else periodo = 'de la noche'

    const hora12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour)

    let minutosText = ''
    if (minutes === 0) minutosText = ''
    else if (minutes === 15) minutosText = ' y cuarto'
    else if (minutes === 30) minutosText = ' y media'
    else if (minutes < 10) minutosText = ` con ${minutes} minutos`
    else minutosText = ` y ${minutes}`

    return `Son las ${hora12}${minutosText} ${periodo}`
}

// ============================================================
// UPDATE JOB STATUS
// ============================================================
async function updateJobStatus(
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress: number,
    message: string
) {
    const { error } = await supabase
        .from('newscast_jobs')
        .update({
            status,
            progress,
            progress_message: message,
            started_at: status === 'processing' && progress <= 5 ? new Date().toISOString() : undefined,
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId)

    if (error) {
        console.error('Error updating job:', error)
    } else {
        console.log(`📊 Job ${jobId}: ${status} (${progress}%) - ${message}`)
    }
}

// ============================================================
// MAIN HANDLER
// ============================================================
const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
    console.log('🚀 Background Function generate-newscast-background iniciada (FULL VERSION)')
    console.log('========== DEBUG INFO ==========')
    console.log(`⏰ Timestamp: ${new Date().toISOString()}`)
    console.log(`🖥️ Node version: ${process.version}`)
    console.log(`💾 Memory: ${JSON.stringify(process.memoryUsage())}`)
    console.log(`📊 Platform: ${process.platform}`)
    console.log(`🌐 HTTP Method: ${event.httpMethod}`)
    console.log(`📦 Body length: ${event.body?.length || 0} chars`)
    console.log(`📋 Headers: ${JSON.stringify(Object.keys(event.headers))}`)
    console.log('================================')

    // Validar variables de entorno inmediatamente
    console.log('🔍 Verificando variables de entorno...')
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    const googleTtsKey = process.env.GOOGLE_CLOUD_TTS_API_KEY

    console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ OK (' + supabaseUrl.substring(0, 30) + '...)' : '❌ FALTA'}`)
    console.log(`   SUPABASE_KEY: ${supabaseKey ? '✅ OK (' + supabaseKey.substring(0, 10) + '...)' : '❌ FALTA'}`)
    console.log(`   GOOGLE_TTS_KEY: ${googleTtsKey ? '✅ OK' : '❌ FALTA'}`)
    console.log(`   Total env vars: ${Object.keys(process.env).length}`)

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ CRITICAL: Variables de entorno de Supabase faltantes')
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Variables de entorno de Supabase no configuradas' })
        }
    }

    // Test conexión Supabase
    console.log('🔌 Probando conexión a Supabase...')
    try {
        const { data: testData, error: testError } = await supabase.from('newscast_jobs').select('id').limit(1)
        if (testError) {
            console.error('❌ Error conectando a Supabase:', testError.message)
        } else {
            console.log('✅ Conexión a Supabase OK')
        }
    } catch (connError) {
        console.error('❌ Exception conectando a Supabase:', connError)
    }

    let jobId: string | undefined

    try {
        console.log('📋 Parseando body del request...')
        console.log(`📋 Body preview: ${event.body?.substring(0, 200)}...`)

        const body = JSON.parse(event.body || '{}')
        jobId = body.jobId
        const config = body.config

        console.log(`📋 Body parseado: jobId=${jobId}, config keys=${config ? Object.keys(config).join(',') : 'null'}`)

        if (!jobId || !config) {
            console.error('❌ Missing required fields: jobId or config')
            return { statusCode: 400, body: JSON.stringify({ error: 'jobId y config son requeridos' }) }
        }

        console.log(`📋 Job ID: ${jobId}`)
        console.log(`📋 Región: ${config.region}`)
        console.log(`📋 User ID: ${config.userId}`)
        console.log(`📋 Target Duration: ${config.targetDuration}s`)
        console.log(`📋 News URLs count: ${config.specificNewsUrls?.length || 0}`)

        console.log('📊 Actualizando job status a processing...')
        await updateJobStatus(jobId, 'processing', 5, 'Iniciando generación...')
        console.log('✅ Job status actualizado')

        const {
            region,
            radioName,
            specificNewsUrls = [],
            targetDuration = 420,
            voiceModel,
            voiceWPM = 175,
            userId,
            includeWeather = true,
            timeStrategy = 'auto',
            selectedAdIds = [],  // ✅ NUEVO: IDs de publicidades seleccionadas por el usuario
            audioConfig = {      // ✅ NUEVO: Configuración de cortinas
                cortinas_enabled: false,
                cortinas_frequency: 3
            },
            voiceSettings = {
                speed: 1,   // ✅ FIX: Default 1 (sin ajuste) - el frontend envía el valor real
                pitch: 0,
                volume: 2,
                fmRadioEffect: false,
                fmRadioIntensity: 27
            }
        } = config

        // WPM calibrado - igual que en route.ts
        // Fórmula: voiceBaseWPM * (1 + speed/100) * CORRECTION_FACTOR
        // ✅ Factor 0.85 compensa speakingRate dinámico (1.17 para Carlos) + pausas SSML
        const CORRECTION_FACTOR = 0.85
        const voiceBaseWPM = voiceWPM || 175
        const speedAdjustment = 1 + ((voiceSettings?.speed ?? 0) / 100)
        const effectiveWPM = Math.round(voiceBaseWPM * speedAdjustment * CORRECTION_FACTOR)

        console.log(`🎤 WPM: base ${voiceBaseWPM} × speed ${speedAdjustment.toFixed(2)} × factor ${CORRECTION_FACTOR} = ${effectiveWPM} | Objetivo: ${targetDuration}s`)

        // ============================================================
        // 1. OBTENER NOTICIAS
        // ============================================================
        await updateJobStatus(jobId, 'processing', 10, 'Buscando noticias...')

        let noticias: any[] = []

        if (specificNewsUrls && specificNewsUrls.length > 0) {
            const uniqueUrls = [...new Set(specificNewsUrls as string[])]
            const { data } = await supabase
                .from('noticias_scrapeadas')
                .select('*')
                .in('url', uniqueUrls)

            noticias = data || []
            console.log(`📰 ${noticias.length} noticias encontradas por URL`)
        } else {
            const cutoffDate = new Date()
            cutoffDate.setHours(cutoffDate.getHours() - 24)

            const { data } = await supabase
                .from('noticias_scrapeadas')
                .select('*')
                .eq('region', region)
                .gte('fecha_scraping', cutoffDate.toISOString())
                .order('fecha_scraping', { ascending: false })
                .limit(20)

            noticias = data || []
        }

        if (noticias.length === 0) {
            throw new Error('No se encontraron noticias para procesar')
        }

        // ============================================================
        // 2. OBTENER PUBLICIDADES
        // ============================================================
        await updateJobStatus(jobId, 'processing', 15, 'Cargando publicidades...')

        const { data: campaignsRaw } = await supabase
            .from('campanas_publicitarias')
            .select('*')
            .eq('user_id', userId)
            .eq('esta_activo', true)

        // Filtrar manualmente por fechas (comparando solo la fecha, no la hora)
        const today = new Date().toISOString().split('T')[0] // "2025-12-25"
        const allCampaigns = (campaignsRaw || []).filter((c: any) => {
            const inicio = c.fecha_inicio?.split('T')[0] || c.fecha_inicio
            const fin = c.fecha_fin?.split('T')[0] || c.fecha_fin
            return inicio <= today && fin >= today
        })

        // ✅ Solo usar campañas con audio de Google Drive (URLs https://)
        // Excluir campañas con archivos locales (/audio/...) ya que no funcionarán
        const driveCampaigns = allCampaigns.filter((c: any) =>
            !c.url_audio || c.url_audio.startsWith('https://')
        )

        let campaigns = driveCampaigns
        if (selectedAdIds && selectedAdIds.length > 0) {
            campaigns = driveCampaigns.filter((c: any) => selectedAdIds.includes(c.id))
            console.log(`📢 ${campaigns.length} campañas seleccionadas por usuario (de ${driveCampaigns.length} con Drive)`)
        } else {
            console.log(`📢 ${campaigns.length} campañas publicitarias activas con Drive (de ${allCampaigns.length} total)`)
        }

        // Calcular duración total real de publicidades
        const totalAdDurationReal = campaigns.reduce((sum: number, c: any) => sum + (c.duracion_segundos || 25), 0)
        console.log(`   ⏱️ Duración total de publicidades: ${totalAdDurationReal}s (${Math.round(totalAdDurationReal / 60 * 10) / 10} min)`)

        // ============================================================
        // 3. IA DIRECTORA - PLANIFICAR NOTICIERO
        // ============================================================
        await updateJobStatus(jobId, 'processing', 18, 'Planificando con IA Directora...')

        const plan = await planificarNoticiero(noticias, targetDuration, campaigns, effectiveWPM)

        // Reordenar noticias según plan
        const noticiasOrdenadas = plan.noticias
            .sort((a, b) => a.orden - b.orden)
            .map(planItem => {
                const noticia = noticias.find(n => n.id === planItem.id)
                return {
                    ...noticia,
                    palabras_objetivo: planItem.palabras_objetivo,
                    es_destacada: planItem.es_destacada
                }
            })
            .filter(n => n && n.id)

        console.log(`📏 === PLAN DEL DIRECTOR ===`)
        console.log(`   🎯 Duración objetivo: ${targetDuration}s (${Math.round(targetDuration / 60)} min)`)
        console.log(`   📰 Noticias ordenadas: ${noticiasOrdenadas.length}`)
        console.log(`   📢 Publicidades: ${plan.inserciones.filter(i => i.tipo === 'publicidad').length}`)
        console.log(`   ⏱️ Duración estimada: ${plan.duracion_total_estimada}s`)
        console.log(`   =============================`)

        // ============================================================
        // 4. CONSTRUIR TIMELINE
        // ============================================================
        const timeline: any[] = []
        let currentDuration = 0
        let adIndex = 0

        // INTRO
        const displayName = radioName || region
        const timeText = timeStrategy === 'auto' ? formatTimeNatural(new Date()) : ''
        let weatherText = ''
        if (includeWeather) {
            const weather = await getWeather(region)
            if (weather) weatherText = ` El clima en ${region}, ${weather}.`
        }

        const introVariants = [
            `${timeText}. Bienvenidos al informativo de ${displayName}.${weatherText} Estos son los principales titulares.`,
            `${timeText}. Les damos la bienvenida al noticiero de ${displayName}.${weatherText} Comenzamos con las noticias.`,
            `${timeText}. Bienvenidos a su noticiero de ${displayName}.${weatherText} Empezamos con lo más destacado.`
        ]

        const introText = introVariants[Math.floor(Math.random() * introVariants.length)]
        timeline.push({
            id: 'intro',
            type: 'intro',
            title: 'Intro',
            content: introText,
            duration: TIMING_CONSTANTS.INTRO_DURATION,
            isHumanized: true,
            voiceId: voiceModel || 'default'
        })
        currentDuration += TIMING_CONSTANTS.INTRO_DURATION

        // ============================================================
        // 5. HUMANIZAR NOTICIAS (BATCHES PARALELOS - Optimizado para Gemini)
        // ============================================================
        // NOTA: Cambiado de secuencial a batches paralelos (2024-12-27)
        // Gemini tiene rate limits más generosos que Chutes AI.
        // Procesamos en lotes de 3 con delay de 500ms entre lotes.
        // Incluye retry exponencial para manejo de errores 429.
        // ============================================================
        const totalNoticias = noticiasOrdenadas.length
        const BATCH_SIZE = 3           // Procesar 3 noticias en paralelo
        const BATCH_DELAY_MS = 500     // 500ms entre cada lote
        const MAX_RETRIES = 3          // Máximo reintentos por error 429

        console.log(`🚀 === PROCESAMIENTO EN BATCHES PARALELOS ===`)
        console.log(`   📦 Batch size: ${BATCH_SIZE} | Delay entre batches: ${BATCH_DELAY_MS}ms | Total: ${totalNoticias} noticias`)

        // Preparar todas las noticias con su contexto
        const noticiasConContexto = noticiasOrdenadas.map((noticia, i) => ({
            noticia,
            index: i,
            previousCategory: i > 0 ? noticiasOrdenadas[i - 1].categoria : null
        }))

        // Función con retry exponencial para errores 429
        const humanizeWithRetry = async (
            sourceText: string,
            regionParam: string,
            targetWords: number,
            transitionPhrase: string,
            retries: number = MAX_RETRIES,
            delayMs: number = 1000
        ): Promise<{ content: string; success: boolean }> => {
            try {
                return await humanizeText(sourceText, regionParam, targetWords, transitionPhrase)
            } catch (error: any) {
                if (retries > 0 && (error.status === 429 || error.message?.includes('429'))) {
                    console.warn(`   ⚠️ Rate limit alcanzado. Reintentando en ${delayMs}ms... (${retries} intentos restantes)`)
                    await new Promise(resolve => setTimeout(resolve, delayMs))
                    return humanizeWithRetry(sourceText, regionParam, targetWords, transitionPhrase, retries - 1, delayMs * 2)
                }
                // Si no es 429 o se agotaron los reintentos, lanzar error
                throw error
            }
        }

        // Procesar en batches paralelos
        const humanizedResults: any[] = new Array(totalNoticias)
        const totalBatches = Math.ceil(totalNoticias / BATCH_SIZE)

        for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
            const startIdx = batchIndex * BATCH_SIZE
            const endIdx = Math.min(startIdx + BATCH_SIZE, totalNoticias)
            const batch = noticiasConContexto.slice(startIdx, endIdx)

            // Actualizar progreso
            const progress = 20 + Math.round(((batchIndex + 1) / totalBatches) * 60)
            await updateJobStatus(
                jobId,
                'processing',
                progress,
                `Humanizando batch ${batchIndex + 1}/${totalBatches} (${batch.length} noticias)...`
            )

            console.log(`🚀 [Batch ${batchIndex + 1}/${totalBatches}] Procesando ${batch.length} noticias en paralelo...`)

            // Procesar batch en paralelo con Promise.all
            const batchPromises = batch.map(async ({ noticia, index, previousCategory }) => {
                const transitionPhrase = getTransitionPhrase(index, noticia.categoria || 'general', previousCategory)
                const sourceText = noticia.contenido || noticia.resumen || noticia.titulo
                const targetWords = noticia.palabras_objetivo || 120

                console.log(`   📝 [${index + 1}/${totalNoticias}] ${noticia.titulo?.substring(0, 35)}...`)

                try {
                    const { content: humanizedContent, success } = await humanizeWithRetry(
                        sourceText,
                        region,
                        targetWords,
                        transitionPhrase
                    )

                    const wordCount = humanizedContent.split(/\s+/).length
                    const duration = Math.ceil((wordCount / effectiveWPM) * 60)

                    return {
                        index,
                        noticia,
                        humanizedContent,
                        success,
                        wordCount,
                        duration,
                        sourceText
                    }
                } catch (error) {
                    console.error(`   ❌ Error humanizando noticia ${index + 1}:`, error)
                    // Fallback: usar texto original limpio
                    const fallbackContent = (sourceText || '').substring(0, 500)
                    const wordCount = fallbackContent.split(/\s+/).length
                    return {
                        index,
                        noticia,
                        humanizedContent: fallbackContent,
                        success: false,
                        wordCount,
                        duration: Math.ceil((wordCount / effectiveWPM) * 60),
                        sourceText
                    }
                }
            })

            // Esperar a que termine el batch completo
            const batchResults = await Promise.all(batchPromises)

            // Guardar resultados en orden
            for (const result of batchResults) {
                humanizedResults[result.index] = result
                console.log(`   ✅ [${result.index + 1}] ${result.wordCount} palabras, ${result.duration}s`)
            }

            // Delay entre batches (solo si hay más batches)
            if (batchIndex < totalBatches - 1) {
                console.log(`   ⏳ Esperando ${BATCH_DELAY_MS}ms antes del siguiente batch...`)
                await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS))
            }
        }

        console.log(`✅ Humanización completada: ${humanizedResults.filter(r => r?.success).length}/${totalNoticias} exitosas`)

        // Construir timeline en orden correcto
        for (let i = 0; i < humanizedResults.length; i++) {
            const result = humanizedResults[i]
            if (!result) continue

            timeline.push({
                id: result.noticia.id,
                type: 'news',
                title: result.noticia.titulo,
                content: result.humanizedContent,
                originalContent: result.sourceText,
                duration: result.duration,
                isHumanized: result.success,
                voiceId: voiceModel || 'default',
                category: result.noticia.categoria,
                url: result.noticia.url,
                source: result.noticia.fuente,
                newsId: result.noticia.id
            })

            currentDuration += result.duration

            // Insertar publicidades según plan
            const insercionesAqui = plan.inserciones.filter(ins =>
                ins.despues_de_orden === i + 1 && ins.tipo === 'publicidad'
            )

            for (const insercion of insercionesAqui) {
                const ad = campaigns.find(c => c.id === insercion.publicidad_id) ||
                    campaigns[adIndex % campaigns.length]

                if (ad) {
                    console.log(`📢 Insertando publicidad: ${ad.nombre}`)
                    timeline.push({
                        id: `ad-${i + 1}`,
                        type: 'advertisement',
                        title: ad.nombre,
                        content: ad.descripcion || '',
                        audioUrl: ad.url_audio,
                        s3Key: ad.s3_key,
                        duration: ad.duracion_segundos || 25,
                        adCampaignId: ad.id
                    })
                    currentDuration += ad.duracion_segundos || 25
                    adIndex++
                }
            }
        }

        // ============================================================
        // 5. AJUSTE DE DURACIÓN (PRIMERO: extender noticias)
        // ============================================================
        let tiempoActual = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
        const outroDuracionEstimada = 8 // Outro corto ~8s
        let tiempoFaltante = targetDuration - tiempoActual - outroDuracionEstimada

        // PASO 1: Si falta tiempo (>5s), extender las noticias existentes
        if (tiempoFaltante > 5) {
            console.log(`⚖️ Ajuste de duración: falta ${Math.round(tiempoFaltante)}s - Extendiendo noticias...`)

            // Encontrar noticias que se pueden extender
            const noticiasAjustables = timeline.filter(t =>
                t.type === 'news' &&
                t.originalContent &&
                t.originalContent.length > 100
            )

            // SIEMPRE intentar extender noticias primero (sin límite de tiempo)
            if (noticiasAjustables.length > 0) {
                // Máximo 3 noticias, SECUENCIAL (antes paralelo)
                const noticiasAExtender = Math.min(3, noticiasAjustables.length)

                const tiempoPorNoticia = Math.ceil(tiempoFaltante / noticiasAExtender)
                const palabrasPorNoticia = Math.round((tiempoPorNoticia / 60) * effectiveWPM)

                console.log(`   📊 Distribuyendo ${Math.round(tiempoFaltante)}s entre ${noticiasAExtender} noticias (+${palabrasPorNoticia} palabras c/u)`)

                // Procesar SECUENCIALMENTE (antes en paralelo) para evitar 429
                for (let i = 0; i < noticiasAExtender; i++) {
                    const noticiaAjustar = noticiasAjustables[noticiasAjustables.length - 1 - i]
                    const palabrasActuales = noticiaAjustar.content.split(/\s+/).length
                    const palabrasObjetivo = palabrasActuales + palabrasPorNoticia

                    console.log(`   📝 [${i + 1}/${noticiasAExtender}] Re-humanizando "${noticiaAjustar.title?.substring(0, 35)}..."`)

                    const { content: nuevoContenido, success } = await humanizeText(
                        noticiaAjustar.originalContent,
                        region,
                        palabrasObjetivo
                    )

                    if (success && nuevoContenido) {
                        const nuevaPalabras = nuevoContenido.split(/\s+/).length
                        const nuevaDuracion = Math.ceil((nuevaPalabras / effectiveWPM) * 60)
                        const duracionAnterior = noticiaAjustar.duration

                        noticiaAjustar.content = nuevoContenido
                        noticiaAjustar.duration = nuevaDuracion
                        currentDuration = currentDuration - duracionAnterior + nuevaDuracion

                        console.log(`      ✅ ${duracionAnterior}s → ${nuevaDuracion}s (+${nuevaDuracion - duracionAnterior}s)`)
                    }

                    // Delay entre cada extensión
                    if (i < noticiasAExtender - 1) {
                        console.log(`      ⏳ Esperando 500ms antes de la siguiente extensión...`)
                        await new Promise(resolve => setTimeout(resolve, 500))
                    }
                }

                // Recalcular tiempo faltante después de extender noticias
                tiempoActual = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
                tiempoFaltante = targetDuration - tiempoActual - outroDuracionEstimada
                console.log(`   📊 Después de ajuste: falta ${Math.round(tiempoFaltante)}s`)
            }
        }

        // PASO 2: Solo si DESPUÉS de extender noticias aún falta >30s, usar Cierre Extendido como respaldo
        let outroText = ''

        if (tiempoFaltante > 30) {
            console.log(`⏱️ Aún falta ${Math.round(tiempoFaltante)}s después de ajuste → Generando Cierre Extendido`)

            const palabrasCierre = Math.round((tiempoFaltante / 60) * effectiveWPM)

            const noticiasCubiertas = timeline
                .filter((item: any) => item.type === 'news')
                .map((item: any) => item.title)
                .slice(0, 5)

            const resumenNoticias = noticiasCubiertas.join('; ')

            // Usar prompt centralizado
            const cierrePrompt = getCierrePrompt({
                palabrasCierre,
                displayName: radioName || region,
                resumenNoticias,
                region
            })

            let cierreExtendido = ''
            try {
                const cierreResponse = await fetch(CHUTES_CONFIG.endpoints.chatCompletions, {
                    method: 'POST',
                    headers: getChutesHeaders(),
                    body: JSON.stringify({
                        model: CHUTES_CONFIG.model,
                        messages: [{ role: 'user', content: cierrePrompt }],
                        max_tokens: palabrasCierre * 5,
                        temperature: 0.5
                    })
                })

                if (cierreResponse.ok) {
                    const cierreData = await cierreResponse.json()
                    cierreExtendido = cierreData.choices?.[0]?.message?.content?.trim() || ''
                    console.log(`✅ Cierre IA generado: ${cierreExtendido.split(/\s+/).length} palabras`)
                }
            } catch (cierreError) {
                console.warn('⚠️ Error generando cierre IA, usando fallback')
            }

            if (!cierreExtendido || cierreExtendido.split(/\s+/).length < 20) {
                cierreExtendido = `Y así llegamos al cierre de nuestra edición informativa. Hoy les trajimos las noticias más importantes. Esto fue ${displayName}. Gracias por su sintonía. Hasta la próxima.`
            }

            const cierreDuration = Math.ceil((cierreExtendido.split(/\s+/).length / effectiveWPM) * 60)
            timeline.push({
                id: 'cierre-extendido',
                type: 'closing',
                title: 'Cierre Extendido',
                content: cierreExtendido,
                duration: cierreDuration,
                isHumanized: true,
                voiceId: voiceModel || 'default'
            })
            currentDuration += cierreDuration

            console.log(`📊 Cierre extendido agregado. No se agregará outro adicional.`)
        } else if (tiempoFaltante < -5) {
            console.log(`⏱️ Tiempo excedido: ${Math.abs(Math.round(tiempoFaltante))}s extra`)
            outroText = `Esto fue ${displayName}. Hasta pronto.`
        } else {
            outroText = `Eso es todo por ahora desde ${displayName}. Gracias por acompañarnos en esta edición. Hasta la próxima.`
        }

        // OUTRO - Solo agregar si NO hay cierre extendido
        const hayCierreExtendido = timeline.some(t => t.id === 'cierre-extendido')
        if (!hayCierreExtendido && outroText) {
            const outroWordCount = outroText.split(/\s+/).length
            const outroDuration = Math.ceil((outroWordCount / effectiveWPM) * 60)
            timeline.push({
                id: 'outro',
                type: 'outro',
                title: 'Cierre',
                content: outroText,
                duration: outroDuration,
                isHumanized: true,
                voiceId: voiceModel || 'default'
            })
            currentDuration += outroDuration
        }

        // ============================================================
        // PASO: INSERCIÓN AUTOMÁTICA DE CORTINAS (si está habilitado)
        // ============================================================
        if (audioConfig?.cortinas_enabled && userId) {
            console.log(`🎵 Cortinas habilitadas - cargando cortinas del usuario...`)

            // Cargar cortinas del usuario desde biblioteca_audio
            const { data: cortinas } = await supabase
                .from('biblioteca_audio')
                .select('*')
                .eq('tipo', 'cortina')
                .eq('user_id', userId)
                .eq('esta_activo', true)

            // Filtrar solo las que tienen URL de Drive (no archivos locales)
            const cortinasValidas = (cortinas || []).filter((c: any) =>
                c.audio && c.audio.startsWith('https://')
            )

            if (cortinasValidas.length > 0) {
                console.log(`   📦 ${cortinasValidas.length} cortinas encontradas con Drive`)

                const frequency = audioConfig.cortinas_frequency || 3
                let newsCount = 0
                let cortinaIndex = 0

                // Insertar cortinas cada N noticias
                const newTimeline: any[] = []
                for (const item of timeline) {
                    newTimeline.push(item)

                    if (item.type === 'news') {
                        newsCount++
                        if (newsCount % frequency === 0 && cortinaIndex < cortinasValidas.length) {
                            const cortina = cortinasValidas[cortinaIndex % cortinasValidas.length]
                            const cortinaDuration = cortina.duracion_segundos || 5

                            newTimeline.push({
                                id: `cortina-${Date.now()}-${cortinaIndex}`,
                                type: 'cortina',
                                title: cortina.nombre || 'Cortina',
                                audioUrl: cortina.audio,
                                duration: cortinaDuration,
                                isAudio: true
                            })

                            currentDuration += cortinaDuration
                            console.log(`   🎵 Cortina "${cortina.nombre}" insertada después de noticia ${newsCount}`)
                            cortinaIndex++
                        }
                    }
                }

                // Reemplazar timeline con el nuevo que incluye cortinas
                timeline.length = 0
                timeline.push(...newTimeline)

                console.log(`   ✅ ${cortinaIndex} cortinas insertadas`)
            } else {
                console.log(`   ⚠️ No hay cortinas con Drive configuradas para este usuario`)
            }
        }

        console.log(`📊 Timeline completado: ${timeline.length} items, ${currentDuration}s total (objetivo: ${targetDuration}s)`)

        // ============================================================
        // PASO FINAL: VERIFICACIÓN Y AJUSTE FINO DE DURACIÓN
        // ============================================================
        // 
        // DOCUMENTACIÓN IMPORTANTE (2024-12-24):
        // ----------------------------------------
        // La IA de humanización (Chutes AI / DeepSeek) NO respeta el objetivo
        // de palabras solicitado. Ejemplos reales:
        //   - Pedimos 119 palabras → genera 95 (20% menos)
        //   - Pedimos 207 palabras → genera 178 (14% menos)
        //   - Pedimos +18 palabras → genera -3 palabras (inverso!)
        //
        // SOLUCIÓN: Factor de compensación 2x
        // Si necesitas +20 palabras, pedir +40 (el doble).
        // Esto compensa la tendencia de la IA a generar menos.
        //
        // Si en el futuro se cambia de IA (ej: GPT-4, Claude), 
        // revisar si el FACTOR_COMPENSACION sigue siendo necesario.
        // ============================================================

        const TOLERANCIA = 5  // segundos de margen permitido (±5s)
        const MAX_INTENTOS = 3  // máximo intentos de ajuste
        const FACTOR_COMPENSACION = 2.0  // Pedir el DOBLE de palabras necesarias
        const FACTORES_PROGRESIVOS = [0.6, 0.8, 1.0]  // Más agresivo en cada intento

        for (let intento = 0; intento < MAX_INTENTOS; intento++) {
            const tiempoActualVerif = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
            const diferencia = tiempoActualVerif - targetDuration

            // Si está dentro de tolerancia, salir del loop
            if (Math.abs(diferencia) <= TOLERANCIA) {
                console.log(`✅ Tiempo dentro de tolerancia: ${tiempoActualVerif}s (${diferencia >= 0 ? '+' : ''}${diferencia}s del objetivo)`)
                break
            }

            const factorProgresivo = FACTORES_PROGRESIVOS[intento]
            console.log(`⚠️ Verificación ${intento + 1}/${MAX_INTENTOS}: diferencia de ${diferencia > 0 ? '+' : ''}${Math.round(diferencia)}s`)

            // Obtener noticias ajustables
            const noticiasAjustables = timeline.filter(t =>
                t.type === 'news' &&
                t.originalContent &&
                t.originalContent.length > 100
            )

            if (noticiasAjustables.length === 0) {
                console.log(`   ⚠️ No hay noticias ajustables`)
                break
            }

            // Seleccionar noticia diferente en cada intento (rotar)
            const indiceNoticia = (noticiasAjustables.length - 1 - intento) % noticiasAjustables.length
            const noticiaAjustar = noticiasAjustables[Math.max(0, indiceNoticia)]
            const palabrasActuales = noticiaAjustar.content.split(/\s+/).length

            // Calcular ajuste CON FACTOR DE COMPENSACIÓN 2x
            // La IA tiende a generar menos palabras de las pedidas
            const segundosNecesarios = Math.abs(diferencia) * factorProgresivo
            const palabrasBase = Math.round((segundosNecesarios / 60) * effectiveWPM)
            const palabrasConCompensacion = Math.round(palabrasBase * FACTOR_COMPENSACION)

            let palabrasObjetivo: number
            if (diferencia > TOLERANCIA) {
                // Nos pasamos → REDUCIR (aquí la compensación es inversa)
                palabrasObjetivo = Math.max(60, palabrasActuales - palabrasConCompensacion)
                console.log(`   📉 Reduciendo: ${palabrasActuales} → ${palabrasObjetivo} palabras (base: -${palabrasBase}, comp: -${palabrasConCompensacion})`)
            } else {
                // Falta → AGREGAR (aquí aplicamos 2x)
                palabrasObjetivo = palabrasActuales + palabrasConCompensacion
                console.log(`   📈 Extendiendo: ${palabrasActuales} → ${palabrasObjetivo} palabras (base: +${palabrasBase}, comp: +${palabrasConCompensacion})`)
            }

            // Re-humanizar
            const { content: nuevoContenido, success } = await humanizeText(
                noticiaAjustar.originalContent,
                region,
                palabrasObjetivo
            )

            if (success && nuevoContenido) {
                const nuevaPalabras = nuevoContenido.split(/\s+/).length
                const nuevaDuracion = Math.ceil((nuevaPalabras / effectiveWPM) * 60)
                const duracionAnterior = noticiaAjustar.duration

                noticiaAjustar.content = nuevoContenido
                noticiaAjustar.duration = nuevaDuracion
                currentDuration = currentDuration - duracionAnterior + nuevaDuracion

                const cambio = nuevaDuracion - duracionAnterior
                console.log(`   ✅ Ajustado: ${duracionAnterior}s → ${nuevaDuracion}s (${cambio >= 0 ? '+' : ''}${cambio}s)`)

                // Verificar resultado parcial
                const tiempoNuevo = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
                const nuevaDiferencia = tiempoNuevo - targetDuration
                console.log(`   📊 Tiempo actual: ${tiempoNuevo}s (${nuevaDiferencia >= 0 ? '+' : ''}${nuevaDiferencia}s del objetivo)`)
            }

            // Delay entre intentos de verificación
            if (intento < MAX_INTENTOS - 1) {
                console.log(`   ⏳ Esperando 500ms antes del siguiente intento de ajuste...`)
                await new Promise(resolve => setTimeout(resolve, 500))
            }
        }

        // Log final
        const tiempoFinalDefinitivo = timeline.reduce((sum, item) => sum + (item.duration || 0), 0)
        const diferenciaDefinitiva = tiempoFinalDefinitivo - targetDuration
        console.log(`📊 Tiempo final definitivo: ${tiempoFinalDefinitivo}s (${diferenciaDefinitiva >= 0 ? '+' : ''}${diferenciaDefinitiva}s del objetivo)`)

        // ============================================================
        // 6. GUARDAR NOTICIERO EN DB
        // ============================================================
        await updateJobStatus(jobId, 'processing', 90, 'Guardando noticiero...')

        const newscastId = crypto.randomUUID()

        const { error: insertError } = await supabase
            .from('noticieros')
            .insert({
                id: newscastId,
                user_id: userId,
                titulo: `Noticiero ${displayName} - ${new Date().toLocaleDateString('es-CL')}`,
                region: region,
                duracion_segundos: currentDuration,
                datos_timeline: timeline,
                estado: 'generado',
                metadata: {
                    voice_settings: voiceSettings,
                    voice_model: voiceModel,
                    voice_wpm: voiceWPM,
                    effective_wpm: effectiveWPM,
                    target_duration: targetDuration
                },
                created_at: new Date().toISOString()
            })

        if (insertError) {
            console.error('Error guardando noticiero:', insertError)
            throw new Error(`Error guardando noticiero: ${insertError.message} `)
        }

        console.log(`✅ Noticiero guardado: ${newscastId} (${currentDuration}s)`)

        // ============================================================
        // 7. MARCAR JOB COMO COMPLETADO
        // ============================================================
        await supabase
            .from('newscast_jobs')
            .update({
                status: 'completed',
                progress: 100,
                progress_message: '¡Noticiero generado exitosamente!',
                newscast_id: newscastId,
                completed_at: new Date().toISOString()
            })
            .eq('id', jobId)

        console.log(`✅ Job ${jobId} completado`)

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, jobId, newscastId, duration: currentDuration })
        }

    } catch (error) {
        console.error('❌ Background Function error:', error)

        if (jobId) {
            await supabase
                .from('newscast_jobs')
                .update({
                    status: 'failed',
                    progress: 0,
                    progress_message: 'Error en generación',
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
