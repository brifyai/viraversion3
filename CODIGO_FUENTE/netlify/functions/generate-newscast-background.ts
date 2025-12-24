import { createClient } from '@supabase/supabase-js'
import { CHUTES_CONFIG, getChutesHeaders } from './lib/chutes-config'

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

const BATCH_SIZE = 2
const BATCH_DELAY = 3000

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

    const DIRECTOR_PROMPT = `Eres el director de un noticiero de radio chileno.
Planifica este noticiero ordenando las noticias por impacto narrativo.

NOTICIAS:
${noticias.map((n, i) => `${i + 1}. [${n.categoria || 'general'}] "${n.titulo}"`).join('\n')}

INSTRUCCIONES:
- Ordena para máximo impacto (empezar fuerte, variar, cerrar memorable)
- Asigna ~${palabrasPorNoticia} palabras por noticia
- Duración total: ${duracionObjetivo}s

Responde SOLO con JSON:
{"noticias": [{"id": "...", "orden": 1, "palabras_objetivo": ${palabrasPorNoticia}, "es_destacada": true}]}`

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

    // ============================================================
    // PROMPT v6 - TTS READY + Anti-Comas + Anclaje Temático
    // ============================================================
    const systemPrompt = `Eres un editor y locutor profesional de radio en Chile. Tu tarea es transformar noticias en **guiones radiales naturales y fluidos para TTS** (texto a voz).

⚠️ OBJETIVO PRINCIPAL: Que el texto **suene como si un locutor de radio lo estuviera leyendo en vivo**, no como una lista de datos.

✅ DEBES:
- **Priorizar la fluidez sobre la longitud estricta de las oraciones.** Usa oraciones completas, pero **conéctalas de manera natural**. **Controla la respiración para TTS:** Cada oración debe poder leerse en UNA sola respiración (ideal 12-18 palabras, máximo 20).
- **Usar comas CON PROPÓSITO:** Solo para pausas naturales, enumeraciones cortas, o conectar ideas relacionadas **dentro de la misma oración**. Ej: "En el vehículo viajaba una familia de cuatro personas, donde el conductor falleció en el acto".
- **Variar la longitud de las frases.** Mezcla frases cortas (de impacto) con algunas más largas (de contexto) para crear un ritmo auditivo agradable.
- **Usar un lenguaje radial chileno estándar y coloquial.** Ej: "chocó por detrás", "quedó grave", "fue detenido".
- **Construir una mini-narrativa:** Conectar los hechos de forma lógica (qué pasó, dónde, consecuencias, estado de la investigación).
- **Cerrar con una frase que dé un sentido de conclusión** al bloque informativo.
- **CORREGIR ERRORES DE TEXTO:** Si ves "(s)" después de un cargo, ELIMÍNALO completamente (ej: "Seremi (s) de Salud" → "Seremi de Salud")
- **CORREGIR TYPOS:** Arregla errores como "Gustav0" → "Gustavo", "G0biern0" → "Gobierno"

❌ NUNCA:
- Escribas una sucesión de oraciones ultra-cortas y desconectadas (estilo "punto, punto, punto").
- Uses comas para separar ideas totalmente distintas (ahí sí es punto).
- Incluyas frases redundantes como "se informa que" o "se supo que".
- Inventes datos o declaraciones.
- Introduzcas temas ajenos al texto original.

🧠 REGLA DE ORO CORREGIDA:
> "Si al leer en voz alta suenas como un robot que enumera datos… falta conexión. Usa una coma o une las ideas en una oración más larga y natural."

📝 ESTRUCTURA NATURAL:
1. **Gancho/Lead:** La noticia en su esencia.
2. **Cuerpo/Contexto:** Los detalles importantes conectados con fluidez.
3. **Consecuencia/Desenlace:** Qué pasó después y el estado actual.
4. **Cierre:** Una oración que redondea la información.

🎯 EXTENSIÓN: ${targetWords} palabras. Es preferible un texto un poco más largo que suene natural, a uno ultra-corto que suene artificial.

DEVUELVES ÚNICAMENTE el guion final. Nada más.`

    const userPrompt = `Actúa como un locutor de radio chileno. Tu radio está ubicada en ${region}.

🎯 **ANÁLISIS GEOGRÁFICO (HACER PRIMERO):**
1. Lee la noticia y DETERMINA: ¿Ocurre en ${region} o en otra región?
2. **PISTAS:** Busca "seremi de...", "municipalidad de...", nombres de ciudades
3. **DECISIÓN:**
   - Si es en ${region} → Noticia LOCAL
   - Si es en otra región → Noticia EXTERNA

🎯 **NOTICIA PRINCIPAL:** "${topicAnchor}"

🗣️ **COMO LOCUTAR PARA TTS:**
- **PARA TTS (TEXT-TO-SPEECH):**
  • Máximo 20-22 palabras por oración (para respiración natural)
  • Usa comas SOLO para pausas breves dentro de la misma idea
  • Evita oraciones subordinadas complejas
  • Simplifica términos técnicos: "zarpe" → "partida", "tanquero" → "buque petrolero"

- **SEGÚN TIPO DE NOTICIA:**
  • **LOCAL (en ${region}):** "Aquí en ${region}", "En nuestra región"
  • **EXTERNA (otra región):** "Desde [región]", "En [región]"
  • **INTERNACIONAL:** "A nivel internacional", "En el extranjero"

- **ESTILO RADIAL CHILENO:**
  • Conversacional, como hablando con un vecino
  • Conectores naturales: "y", "pero", "además", "mientras tanto"
  • Cierre con frase relevante para el oyente chileno

📰 **INFORMACIÓN BASE:**
"${cleanedText}"

${transitionPhrase ? `👉 **ARRANCA CON:** "${transitionPhrase}"` : ''}

→ **PASO 1:** Determina LOCAL/EXTERNA/INTERNACIONAL.
→ **PASO 2:** Locuta optimizado para TTS.
→ **PASO 3:** Ajusta lenguaje según tipo de noticia.
→ Solo el guion final.`

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

            const reducePrompt = `El siguiente texto tiene ${wordCount} palabras pero necesito máximo ${targetWords}.
Redúcelo manteniendo los hechos esenciales, sin inventar nada.
Solo devuelve el texto reducido:

"${content}"`

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
                        { role: 'system', content: 'Eres un editor de radio chilena. Corrige textos con repeticiones para TTS.' },
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
    const chutesKey = process.env.CHUTES_API_KEY
    const chutesUrl = process.env.CHUTES_CHAT_COMPLETIONS_URL
    const voicemakerKey = process.env.VOICEMAKER_API_KEY

    console.log(`   SUPABASE_URL: ${supabaseUrl ? '✅ OK (' + supabaseUrl.substring(0, 30) + '...)' : '❌ FALTA'}`)
    console.log(`   SUPABASE_KEY: ${supabaseKey ? '✅ OK (' + supabaseKey.substring(0, 10) + '...)' : '❌ FALTA'}`)
    console.log(`   CHUTES_KEY: ${chutesKey ? '✅ OK' : '❌ FALTA'}`)
    console.log(`   CHUTES_URL: ${chutesUrl ? '✅ OK' : '⚠️ Usando default'}`)
    console.log(`   VOICEMAKER_KEY: ${voicemakerKey ? '✅ OK' : '⚠️ No configurado'}`)
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
            voiceSettings = {
                speed: 13,  // Default +13% como en finalize-newscast
                pitch: 0,
                volume: 2,
                fmRadioEffect: false,
                fmRadioIntensity: 27
            }
        } = config

        // WPM calibrado - igual que en route.ts
        // Fórmula: voiceBaseWPM * (1 + speed/100) * CORRECTION_FACTOR
        const CORRECTION_FACTOR = 0.95
        const voiceBaseWPM = voiceWPM || 175
        const speedAdjustment = 1 + ((voiceSettings?.speed ?? 1) / 100)
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
            .gte('fecha_fin', new Date().toISOString())
            .lte('fecha_inicio', new Date().toISOString())

        const campaigns = campaignsRaw || []
        console.log(`📢 ${campaigns.length} campañas publicitarias activas`)

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
        // 5. HUMANIZAR NOTICIAS (BATCHES)
        // ============================================================
        const totalNoticias = noticiasOrdenadas.length
        console.log(`⚡ === PROCESAMIENTO EN BATCHES ===`)
        console.log(`   📦 Batch size: ${BATCH_SIZE} | Delay: ${BATCH_DELAY}ms`)

        for (let i = 0; i < totalNoticias; i++) {
            const noticia = noticiasOrdenadas[i]
            const progress = 20 + Math.round((i / totalNoticias) * 60)

            await updateJobStatus(
                jobId,
                'processing',
                progress,
                `Humanizando noticia ${i + 1}/${totalNoticias}...`
            )

            console.log(`🧠 [${i + 1}] ${noticia.titulo?.substring(0, 50)}...`)

            const previousCategory = i > 0 ? noticiasOrdenadas[i - 1].categoria : null
            const transitionPhrase = getTransitionPhrase(i, noticia.categoria || 'general', previousCategory)

            const sourceText = noticia.contenido || noticia.resumen || noticia.titulo
            const targetWords = noticia.palabras_objetivo || 120

            const { content: humanizedContent, success } = await humanizeText(
                sourceText,
                region,
                targetWords,
                transitionPhrase
            )

            const wordCount = humanizedContent.split(/\s+/).length
            const duration = Math.ceil((wordCount / effectiveWPM) * 60)

            console.log(`   📊 [${i + 1}] Palabras: ${wordCount} | Duración: ${duration}s | Acum: ${currentDuration + duration}s`)

            timeline.push({
                id: noticia.id,
                type: 'news',
                title: noticia.titulo,
                content: humanizedContent,
                originalContent: sourceText,
                duration: duration,
                isHumanized: success,
                voiceId: voiceModel || 'default',
                category: noticia.categoria,
                url: noticia.url,
                source: noticia.fuente,
                newsId: noticia.id
            })

            currentDuration += duration

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

            // Delay entre noticias para evitar rate limiting
            if (i < totalNoticias - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500))
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
                // Determinar cuántas noticias extender basado en el tiempo faltante
                // Más tiempo faltante = más noticias a extender
                const noticiasAExtender = tiempoFaltante > 60
                    ? Math.min(5, noticiasAjustables.length)  // Si falta mucho, extender hasta 5
                    : Math.min(3, noticiasAjustables.length)  // Si falta poco, extender hasta 3

                const tiempoPorNoticia = Math.ceil(tiempoFaltante / noticiasAExtender)
                const palabrasPorNoticia = Math.round((tiempoPorNoticia / 60) * effectiveWPM)

                console.log(`   📊 Distribuyendo ${Math.round(tiempoFaltante)}s entre ${noticiasAExtender} noticias (+${palabrasPorNoticia} palabras c/u)`)

                for (let i = 0; i < noticiasAExtender; i++) {
                    const noticiaAjustar = noticiasAjustables[noticiasAjustables.length - 1 - i]
                    const palabrasActuales = noticiaAjustar.content.split(/\s+/).length
                    const palabrasObjetivo = palabrasActuales + palabrasPorNoticia

                    console.log(`   📝 Re-humanizando "${noticiaAjustar.title?.substring(0, 35)}..."`)

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

            const cierrePrompt = `Genera un cierre de noticiero de ${palabrasCierre} palabras para ${displayName}.
Resume brevemente: ${resumenNoticias}
Usa tono profesional de radio chilena. Incluye despedida final.
NO uses corchetes ni placeholders. Texto listo para leer.`

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
