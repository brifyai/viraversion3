// ==================================================
// VIRA - Servicio de Humanización de Texto
// ==================================================
// Transforma contenido de noticias en texto natural
// para ser leído por TTS (Text-to-Speech)
// ==================================================

import { logTokenUsage, calculateChutesAICost } from './usage-logger'
import { CHUTES_CONFIG, getChutesHeaders } from './chutes-config'
import { fetchWithRetry } from './utils'
import { detectRepetitions, buildCorrectivePrompt, type RepetitionAnalysis } from './text-validation'

// ==================================================
// PREPARACIÓN DE CONTENIDO ANTES DE ENVIAR A IA
// ==================================================
// Limpia y trunca el contenido para evitar respuestas vacías
// ==================================================

export function prepareContentForAI(text: string, maxChars: number = 5000): string {
    if (!text) return ''

    let cleaned = text
        // 1. Remover metadata de fotos/créditos
        .replace(/Foto:.*?\./gi, '')
        .replace(/Imagen:.*?\./gi, '')
        .replace(/Créditos?:.*?\./gi, '')
        .replace(/REUTERS|AFP|AP|EFE|AGENCIA UNO|ATON|PHOTOSPORT|MEGA/gi, '')
        .replace(/Foto: [A-Z][a-z]+ [A-Z][a-z]+/g, '')
        .replace(/\([A-Z]+\)\.?/g, '') // (REUTERS), (AFP), etc.

        // 2. Remover bylines
        .replace(/Por [A-Z][a-záéíóúñ]+ [A-Z][a-záéíóúñ]+\.?/g, '')
        .replace(/Escrito por.*?\./gi, '')

        // 3. Remover fechas redundantes
        .replace(/\d{1,2} de \w+ de \d{4}/g, '')
        .replace(/Publicado:.*?\./gi, '')
        .replace(/Actualizado:.*?\./gi, '')
        .replace(/\d{1,2}\/\d{1,2}\/\d{4}/g, '')

        // 4. Remover secciones no relevantes (todo después de estos encabezados)
        .replace(/Sigue leyendo:.*$/gis, '')
        .replace(/Te puede interesar:.*$/gis, '')
        .replace(/Lee también:.*$/gis, '')
        .replace(/Relacionado:.*$/gis, '')
        .replace(/Mira también:.*$/gis, '')
        .replace(/Más noticias:.*$/gis, '')

        // 5. Remover elementos de UI/formularios
        .replace(/Comparte esta noticia.*$/gis, '')
        .replace(/Síguenos en.*$/gis, '')
        .replace(/Newsletter.*$/gis, '')
        .replace(/Suscríbete.*$/gis, '')

        // 6. Limpiar espacios y caracteres problemáticos
        .replace(/\s+/g, ' ')
        .replace(/[×•►▶◄◀]/g, '')
        .trim()

    // 7. TRUNCAR a max caracteres (en límite de oración REAL)
    // ✅ MEJORADO: Buscar fin de oración real (punto seguido de espacio o mayúscula)
    // Evita cortar en decimales como "58.16%" o "0.5%"
    if (cleaned.length > maxChars) {
        const truncated = cleaned.substring(0, maxChars)

        // Buscar el último punto que termina una oración real
        // (punto seguido de espacio y mayúscula, o punto al final)
        let lastSentenceEnd = -1
        for (let i = truncated.length - 1; i >= maxChars * 0.6; i--) {
            if (truncated[i] === '.') {
                // Verificar que no es un decimal (dígito antes Y después)
                const charBefore = i > 0 ? truncated[i - 1] : ''
                const charAfter = i < truncated.length - 1 ? truncated[i + 1] : ''

                const isDecimal = /\d/.test(charBefore) && /\d/.test(charAfter)
                const isAbbreviation = /\d/.test(charBefore) && charAfter === '' // Ej: "2024."

                if (!isDecimal && !isAbbreviation) {
                    // Es fin de oración real
                    lastSentenceEnd = i
                    break
                }
            }
        }

        if (lastSentenceEnd > maxChars * 0.6) {
            cleaned = truncated.substring(0, lastSentenceEnd + 1)
        } else {
            // Fallback: buscar último espacio para no cortar palabra
            const lastSpace = truncated.lastIndexOf(' ')
            if (lastSpace > maxChars * 0.8) {
                cleaned = truncated.substring(0, lastSpace) + '...'
            } else {
                cleaned = truncated + '...'
            }
        }
        console.log(`   ✂️ Contenido truncado: ${text.length} → ${cleaned.length} chars`)
    }

    return cleaned
}

// Contexto para transiciones naturales entre noticias
export interface TransitionContext {
    index: number           // Índice de la noticia actual (0-based)
    total: number           // Total de noticias
    category: string        // Categoría de la noticia actual
    previousCategory?: string | null  // Categoría de la noticia anterior
}

// Resultado de humanización
interface HumanizeResult {
    content: string
    tokensUsed: number
    cost: number
}

// ✅ NUEVO: Función para forzar límite estricto de palabras
// Trunca el texto al objetivo + 5% de tolerancia, cortando SIEMPRE en oración completa
function enforceWordLimit(text: string, targetWords: number, tolerance: number = 0.05): string {
    const words = text.split(/\s+/)
    const maxWords = Math.ceil(targetWords * (1 + tolerance))

    // Si está dentro del límite, retornar tal cual
    if (words.length <= maxWords) return text

    console.log(`   ✂️ Truncando: ${words.length} → ${maxWords} palabras`)

    // Truncar al máximo de palabras
    const truncated = words.slice(0, maxWords).join(' ')

    // Buscar última oración completa (punto, ? o !)
    const lastPeriodIndex = truncated.lastIndexOf('.')
    const lastQuestionIndex = truncated.lastIndexOf('?')
    const lastExclamIndex = truncated.lastIndexOf('!')

    const lastSentenceEnd = Math.max(lastPeriodIndex, lastQuestionIndex, lastExclamIndex)

    // ✅ MEJORADO: Siempre cortar en oración completa si hay una en al menos el 50% del texto
    // Antes era 80%, lo que causaba oraciones incompletas
    if (lastSentenceEnd > truncated.length * 0.5) {
        return truncated.substring(0, lastSentenceEnd + 1)
    }

    // Si no hay oración completa en el 50%, buscar más atrás
    // Intentar encontrar cualquier punto
    if (lastSentenceEnd > 0) {
        console.log(`   ⚠️ Cortando en oración lejana para evitar texto incompleto`)
        return truncated.substring(0, lastSentenceEnd + 1)
    }

    // Si realmente no hay puntos, es mejor no truncar que dejar texto incompleto
    console.log(`   ⚠️ No se encontró fin de oración, manteniendo texto original`)
    return text
}

// Frases de transición por categoría
const TRANSITION_PHRASES: { [key: string]: string[] } = {
    politica: [
        'En el ámbito político,',
        'Pasando a la política,',
        'En materia política,',
        'En noticias políticas,'
    ],
    economia: [
        'En economía,',
        'Pasando a la economía,',
        'En el ámbito económico,',
        'Respecto a la economía,'
    ],
    deportes: [
        'En deportes,',
        'Pasando al deporte,',
        'En noticias deportivas,',
        'En el mundo del deporte,'
    ],
    internacional: [
        'En el ámbito internacional,',
        'Desde el exterior,',
        'En noticias internacionales,',
        'A nivel mundial,'
    ],
    tecnologia: [
        'En tecnología,',
        'En el mundo tecnológico,',
        'Desde el sector tech,',
        'En innovación,'
    ],
    cultura: [
        'En cultura,',
        'En el ámbito cultural,',
        'Pasando a cultura,',
        'En noticias culturales,'
    ],
    salud: [
        'En salud,',
        'En noticias de salud,',
        'En el sector salud,',
        'Respecto a la salud,'
    ],
    general: [
        'Continuando,',
        'Seguimos con,',
        'Ahora,',
        'También,'
    ]
}

// Función para obtener frase de transición
function getTransitionPhrase(context: TransitionContext): string {
    // Primera noticia: sin transición
    if (context.index === 0) return ''

    // Si cambió de categoría, usar transición de la nueva categoría
    if (context.previousCategory && context.previousCategory !== context.category) {
        const category = context.category.toLowerCase()
        const phrases = TRANSITION_PHRASES[category] || TRANSITION_PHRASES['general']
        return phrases[Math.floor(Math.random() * phrases.length)] + ' '
    }

    // Mismo tema: transiciones genéricas
    const genericTransitions = [
        'Asimismo,',
        'Por otro lado,',
        'Además,',
        'También,',
        'Continuando,'
    ]

    return genericTransitions[Math.floor(Math.random() * genericTransitions.length)] + ' '
}

// Función principal para humanizar texto
export async function humanizeText(
    text: string,
    region: string,
    userId: string,
    context?: TransitionContext,
    options?: { targetWordCount?: number }  // NUEVO: cantidad de palabras objetivo
): Promise<HumanizeResult> {
    // Si el texto está vacío, retornar vacío
    if (!text || text.trim().length === 0) {
        return { content: '', tokensUsed: 0, cost: 0 }
    }

    // Texto muy corto (menos de 50 caracteres): solo limpiar
    if (text.length < 50) {
        return {
            content: text.trim(),
            tokensUsed: 0,
            cost: 0
        }
    }

    try {
        // ✅ NUEVO: Limpiar y truncar contenido antes de enviar a IA
        const cleanedText = prepareContentForAI(text, 4000)

        // Intentar humanizar con IA (Chutes AI)
        const transitionPhrase = context ? getTransitionPhrase(context) : ''
        const targetWords = options?.targetWordCount || 100  // Default 100 palabras

        // ✅ NUEVO: Extraer tema central de la primera oración para anclaje
        const extractTopic = (text: string): string => {
            const firstSentence = text.split(/[.!?]/)[0]?.trim() || ''
            // Limpiar y limitar a 100 chars
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

        // Calcular tokens aproximados
        const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)

        const response = await fetchWithRetry(
            CHUTES_CONFIG.endpoints.chatCompletions,
            {
                method: 'POST',
                headers: getChutesHeaders(),
                body: JSON.stringify({
                    model: CHUTES_CONFIG.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    max_tokens: Math.max(600, targetWords * 4),  // ✅ AUMENTADO: más espacio para completar oraciones
                    temperature: 0.5  // ✅ REDUCIDO de 0.7 a 0.5 para más consistencia
                })
            },
            { retries: 3, backoff: 2000 }  // ✅ Aumentado para evitar 429 en producción
        )

        if (!response.ok) {
            console.warn(`⚠️ Error en Chutes AI: ${response.status}. Usando texto original limpio.`)
            return fallbackHumanize(text, transitionPhrase, targetWords)
        }

        const data = await response.json()

        // DEBUG: Ver qué devuelve Chutes
        if (!data.choices || !data.choices[0]) {
            console.error('❌ Chutes AI response malformada:', JSON.stringify(data).substring(0, 500))
        }

        let humanizedContent = data.choices?.[0]?.message?.content?.trim()

        if (!humanizedContent) {
            console.warn('⚠️ Respuesta vacía de Chutes AI. Usando fallback.')
            console.warn('   Respuesta recibida:', JSON.stringify(data).substring(0, 300))
            return fallbackHumanize(text, transitionPhrase, targetWords)
        }

        // ✅ NUEVO: Detectar y corregir respuestas que terminan a mitad de oración
        const lastChar = humanizedContent.slice(-1)
        const endsWithPunctuation = ['.', '!', '?', '"', '»'].includes(lastChar)

        if (!endsWithPunctuation) {
            console.warn(`⚠️ Respuesta de IA terminó incompleta (último char: "${lastChar}")`)
            // Buscar la última oración completa
            const lastSentenceEnd = Math.max(
                humanizedContent.lastIndexOf('. '),
                humanizedContent.lastIndexOf('." '),
                humanizedContent.lastIndexOf('? '),
                humanizedContent.lastIndexOf('! ')
            )

            if (lastSentenceEnd > humanizedContent.length * 0.5) {
                // Hay suficiente contenido, truncar a la última oración completa
                humanizedContent = humanizedContent.substring(0, lastSentenceEnd + 1)
                console.log(`   ✂️ Recortado a última oración completa: ${humanizedContent.length} chars`)
            } else {
                // Agregar punto final para cerrar
                humanizedContent += '.'
                console.log(`   ➕ Agregado punto final`)
            }
        }

        // ✅ Verificar que la IA generó suficiente contenido
        const generatedWordCount = humanizedContent.split(' ').length
        const minAcceptableWords = targetWords * 0.5  // Mínimo 50% del objetivo

        if (generatedWordCount < minAcceptableWords) {
            console.warn(`⚠️ IA generó solo ${generatedWordCount} palabras (mínimo: ${Math.round(minAcceptableWords)}). Usando fallback.`)
            return fallbackHumanize(text, transitionPhrase, targetWords)
        }

        // ✅ Verificar si excede 25% del objetivo y re-procesar si es necesario
        const maxAcceptableWords = Math.floor(targetWords * 1.25)  // 25% tolerancia (antes 15%)

        if (generatedWordCount > maxAcceptableWords) {
            console.warn(`⚠️ Exceso: ${generatedWordCount} palabras (max: ${maxAcceptableWords}). Re-procesando...`)

            // ✅ Extraer tema del contenido humanizado para anclaje
            const extractTopicFromContent = (text: string): string => {
                const firstSentence = text.split(/[.!?]/)[0]?.trim() || ''
                return firstSentence.substring(0, 80).replace(/["']/g, '')
            }
            const reductionTopic = extractTopicFromContent(humanizedContent)

            // Prompt v6 - Reducción TTS + Anti-Comas + Anclaje Temático
            const strictPrompt = `Eres locutor de radio chilena reduciendo una noticia.

🎯 **TEMA EXCLUSIVO:** "${reductionTopic}"
- Solo esto, nada más. Sin temas relacionados.

🗣️ **REDUCE HABLANDO:**
- Imagina que cuentas esto brevemente a un oyente
- Usa frases directas y naturales
- Corrige errores como "(s)" y "Gustav0" automáticamente
- Eres de ${region}, hablas para ${region}

📏 **EXTENSIÓN:** Aproximadamente ${targetWords} palabras
- Elimina lo redundante, mantén lo esencial
- Une ideas relacionadas con "y", "pero"
- Termina con un mensaje o conclusión clara

📝 **TEXTO CON POSIBLES ERRORES:**
"${humanizedContent}"

→ Solo tu versión reducida y corregida, lista para leer al aire.`

            try {
                const reprocessResponse = await fetchWithRetry(
                    CHUTES_CONFIG.endpoints.chatCompletions,
                    {
                        method: 'POST',
                        headers: getChutesHeaders(),
                        body: JSON.stringify({
                            model: CHUTES_CONFIG.model,
                            messages: [
                                { role: 'system', content: 'Editor de radio chilena. REDUCE textos para TTS. CERO comas. Máx 14 palabras por oración. No inventes nada.' },
                                { role: 'user', content: strictPrompt }
                            ],
                            max_tokens: Math.min(500, targetWords * 3),  // Espacio suficiente pero controlado
                            temperature: 0.1  // Muy bajo: fidelidad, no creatividad
                        })
                    },
                    { retries: 2, backoff: 2000 }
                )

                if (reprocessResponse.ok) {
                    const reprocessData = await reprocessResponse.json()
                    const reducedContent = reprocessData.choices?.[0]?.message?.content?.trim()

                    if (reducedContent) {
                        const reducedWordCount = reducedContent.split(' ').length
                        console.log(`   ✂️ Reducido: ${generatedWordCount} → ${reducedWordCount} palabras`)

                        // Registrar tokens extra del re-procesamiento
                        const reprocessTokens = Math.ceil((strictPrompt.length + reducedContent.length) / 4)
                        const reprocessCost = calculateChutesAICost(reprocessTokens)

                        await logTokenUsage({
                            user_id: userId,
                            servicio: 'chutes',
                            operacion: 'humanizacion_reprocess',
                            tokens_usados: reprocessTokens,
                            costo: reprocessCost
                        })

                        humanizedContent = reducedContent
                    }
                }
            } catch (reprocessError) {
                console.warn('⚠️ Error en re-procesamiento, usando contenido original:', reprocessError)
                // Continuar con el contenido original si falla el re-procesamiento
            }
        }

        // ✅ NOTA: Se eliminó enforceWordLimit aquí.
        // La IA ya reduce el texto de forma inteligente (líneas 405-492),
        // garantizando oraciones completas sin truncamiento abrupto.

        // ✅ ANTI-REPETICIÓN: Detectar y corregir repeticiones
        const repetitionAnalysis = detectRepetitions(humanizedContent)

        if (!repetitionAnalysis.isValid) {
            console.warn(`⚠️ Repeticiones detectadas (score: ${repetitionAnalysis.score}):`,
                repetitionAnalysis.issues.map(i => i.details).join(', '))

            // Intentar corregir con prompt correctivo
            try {
                const correctivePrompt = buildCorrectivePrompt(
                    repetitionAnalysis.issues,
                    humanizedContent,
                    targetWords
                )

                const retryResponse = await fetchWithRetry(
                    CHUTES_CONFIG.endpoints.chatCompletions,
                    {
                        method: 'POST',
                        headers: getChutesHeaders(),
                        body: JSON.stringify({
                            model: CHUTES_CONFIG.model,
                            messages: [
                                { role: 'system', content: 'Eres un editor de radio chilena. Corrige textos con repeticiones para TTS.' },
                                { role: 'user', content: correctivePrompt }
                            ],
                            max_tokens: Math.max(600, targetWords * 4),
                            temperature: 0.7  // Más alto para mayor variación
                        })
                    },
                    { retries: 2, backoff: 2000 }
                )

                if (retryResponse.ok) {
                    const retryData = await retryResponse.json()
                    const correctedContent = retryData.choices?.[0]?.message?.content?.trim()

                    if (correctedContent) {
                        // Verificar que la corrección es mejor
                        const retryAnalysis = detectRepetitions(correctedContent)

                        if (retryAnalysis.score > repetitionAnalysis.score) {
                            console.log(`   ✅ Corrección exitosa: score ${repetitionAnalysis.score} → ${retryAnalysis.score}`)
                            humanizedContent = correctedContent // Sin enforceWordLimit para evitar truncamiento

                            // Registrar tokens del reintento
                            const retryTokens = Math.ceil((correctivePrompt.length + correctedContent.length) / 4)
                            await logTokenUsage({
                                user_id: userId,
                                servicio: 'chutes',
                                operacion: 'humanizacion_anti_repeticion',
                                tokens_usados: retryTokens,
                                costo: calculateChutesAICost(retryTokens)
                            })
                        } else {
                            console.warn(`   ⚠️ Corrección no mejoró (score: ${retryAnalysis.score}), manteniendo original`)
                        }
                    }
                }
            } catch (retryError) {
                console.warn('⚠️ Error en reintento anti-repetición:', retryError)
                // Continuar con el contenido original
            }
        } else {
            console.log(`   ✓ Texto sin repeticiones (score: ${repetitionAnalysis.score})`)
        }

        // Calcular tokens de salida
        const outputTokens = Math.ceil(humanizedContent.length / 4)
        const totalTokens = inputTokens + outputTokens
        const cost = calculateChutesAICost(totalTokens)

        // Registrar uso
        await logTokenUsage({
            user_id: userId,
            servicio: 'chutes',
            operacion: 'humanizacion',
            tokens_usados: totalTokens,
            costo: cost
        })

        return {
            content: humanizedContent,
            tokensUsed: totalTokens,
            cost
        }

    } catch (error) {
        console.error('Error en humanizeText:', error)
        // Fallback: limpiar texto básicamente
        const transitionPhrase = context ? getTransitionPhrase(context) : ''
        const targetWords = options?.targetWordCount || 150
        return fallbackHumanize(text, transitionPhrase, targetWords)
    }
}

// Fallback cuando la IA no está disponible - MEJORADO para respetar límite de palabras
function fallbackHumanize(text: string, transitionPhrase: string = '', targetWordCount: number = 150): HumanizeResult {
    // Limpiar el texto - FILTROS COMPLETOS para BioBioChile y otros
    let cleaned = text
        // Eliminar timestamps
        .replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/gi, '')
        // Eliminar prefijos urgentes
        .replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO|BREAKING)\s*[|•:-]\s*/gi, '')
        // Reemplazar pipes por puntos
        .replace(/\s+\|\s+/g, '. ')
        // Eliminar URLs
        .replace(/https?:\/\/[^\s]+/g, '')

        // ==========================================
        // FILTROS ESPECÍFICOS PARA BIOBIOCHILE
        // ==========================================
        // Formulario de corrección/contacto - MEJORADO
        .replace(/Nombre y Apellido.*?Comentario/gis, '')
        .replace(/Certifico que es información real.*?(BioBío|Bio Bio|BioBioChile)/gis, '')
        .replace(/Certifico que es información real y autorizo a Bio Bio para publicarla.*?conveniente/gis, '')
        .replace(/Correo electrónico.*?Teléfono/gis, '')
        .replace(/Ciudad o localización/gi, '')
        .replace(/Contacto Corrección o Comentario/gi, '')
        .replace(/Por favor complete todos los campos/gi, '')
        .replace(/haga check para certificar/gi, '')
        .replace(/veracidad de los datos/gi, '')
        .replace(/antes de enviar la corrección/gi, '')
        .replace(/Por favor ingrese.*?e-mail valido/gi, '')
        .replace(/Su mensaje fue enviado.*?exitosamente/gi, '')
        .replace(/Atenderemos su corrección/gi, '')
        .replace(/Atenderemos su correción/gi, '') // Con typo
        .replace(/cuanto antes/gi, '')
        .replace(/Enviando corrección.*?momento/gi, '')
        .replace(/ENVIAR/g, '')
        .replace(/y la antes de enviar la correccion\.?!?/gi, '')
        // ✅ NUEVO: Fragmentos adicionales
        .replace(/para publicarla de la forma\.?/gi, '')
        .replace(/de la forma\. y la/gi, '')
        .replace(/\.\.!/g, '.')
        .replace(/[×]/g, '')
        .replace(/Que estime conveniente,?\.?\s*/gi, '')
        // ✅ NUEVO: Categorías con >
        .replace(/^[A-Za-zÁÉÍÓÚáéíóúñÑ\s]+\s*>\s*/gm, '')
        .replace(/Fútbol\s*>/gi, '')
        .replace(/Inter\s*>/gi, '')
        .replace(/Región de [A-Za-zÁÉÍÓÚáéíóúñÑ\s]+\s*>/gi, '')
        .replace(/senadores electos diputados electos toda la cobertura/gi, '')
        // Metadatos de autor y visitas
        .replace(/por [A-Z][a-z]+ [A-Z][a-z]+ Periodista de Prensa en BioBioChile/gi, '')
        .replace(/Periodista de Prensa en BioBioChile/gi, '')
        .replace(/Megam Ossandón/gi, '')
        .replace(/\d+[\.,]\d+ visitas/gi, '')
        .replace(/VER RESUMEN/gi, '')
        .replace(/Resumen generado con.*?Inteligencia Artificial.*?BioBioChile/gis, '')
        .replace(/revisado por el autor de este artículo/gi, '')
        .replace(/Archivo Agencia UNO/gi, '')
        .replace(/Seguimos criterios de Ética y transparencia de BioBioChile/gi, '')
        .replace(/Capturas/gi, '')
        // Fechas con formato de BioBio
        .replace(/Noticia (Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d+ (de )?\w+ (de )?\d{4}/gi, '')
        .replace(/Agencia de noticias\s+(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo)/gi, '')
        .replace(/\d{1,2}:\d{2}/g, '')

        // ==========================================
        // LIMPIEZA GENERAL
        // ==========================================
        // Eliminar múltiples espacios
        .replace(/\s+/g, ' ')
        // Eliminar caracteres especiales problemáticos para TTS
        .replace(/[#@*_~`×•]/g, '')
        // Eliminar líneas vacías múltiples
        .replace(/\n{2,}/g, '\n')
        // Eliminar puntos múltiples
        .replace(/\.{2,}/g, '.')
        // Limpiar espacios antes de puntuación
        .replace(/\s+([.,;:!?])/g, '$1')
        .trim()

    // ✅ NUEVO: Recortar a las primeras N oraciones para respetar el objetivo de palabras
    const sentences = cleaned.split(/(?<=[.!?])\s+/)
    let result = ''
    let wordCount = 0

    for (const sentence of sentences) {
        const sentenceWords = sentence.split(' ').length
        if (wordCount + sentenceWords > targetWordCount * 1.2) {
            // Si ya tenemos suficientes palabras, parar
            if (wordCount >= targetWordCount * 0.5) break
        }
        result += (result ? ' ' : '') + sentence
        wordCount += sentenceWords
    }

    // Si el resultado es muy corto, usar más del texto original
    if (wordCount < 50 && cleaned.length > 0) {
        const words = cleaned.split(' ').slice(0, targetWordCount)
        result = words.join(' ')
        // Asegurar que termina en una oración completa
        const lastPeriod = result.lastIndexOf('.')
        if (lastPeriod > result.length * 0.5) {
            result = result.substring(0, lastPeriod + 1)
        }
    }

    // Agregar transición al inicio si existe
    if (transitionPhrase && result) {
        result = transitionPhrase + result
    }

    // Asegurar que termine con punto
    if (result && !result.endsWith('.') && !result.endsWith('?') && !result.endsWith('!')) {
        result += '.'
    }

    console.log(`   📋 Fallback: ${wordCount} palabras (objetivo: ${targetWordCount})`)

    return {
        content: result,
        tokensUsed: 0,
        cost: 0
    }
}

// Función para limpiar texto para TTS (sin humanizar) - INCLUYE FILTROS BIOBIOCHILE
export function sanitizeForTTS(text: string): string {
    if (!text) return ''

    return text
        // Eliminar timestamps
        .replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/gi, '')
        // Eliminar prefijos
        .replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO)\s*[|•-]\s*/gi, '')
        // Reemplazar pipes
        .replace(/\s+\|\s+/g, '. ')

        // FILTROS BIOBIOCHILE - MEJORADO
        .replace(/Nombre y Apellido.*?Comentario/gis, '')
        .replace(/Certifico que es información real.*?(BioBío|Bio Bio|BioBioChile)/gis, '')
        .replace(/Certifico que es información real y autorizo a Bio Bio para publicarla.*?conveniente/gis, '')
        .replace(/Correo electrónico.*?Teléfono/gis, '')
        .replace(/Ciudad o localización/gi, '')
        .replace(/Por favor complete todos los campos/gi, '')
        .replace(/haga check para certificar/gi, '')
        .replace(/veracidad de los datos/gi, '')
        .replace(/antes de enviar la corrección/gi, '')
        .replace(/Por favor ingrese.*?e-mail valido/gi, '')
        .replace(/Su mensaje fue enviado.*?exitosamente/gi, '')
        .replace(/Atenderemos su corrección/gi, '')
        .replace(/Enviando corrección.*?momento/gi, '')
        .replace(/ENVIAR/g, '')
        .replace(/[×]/g, '')
        .replace(/Que estime conveniente,?\.?\s*/gi, '')
        .replace(/Periodista de Prensa en BioBioChile/gi, '')
        .replace(/\d+[\.,]\d+ visitas/gi, '')
        .replace(/VER RESUMEN/gi, '')
        .replace(/Resumen generado con.*?Inteligencia Artificial.*?BioBioChile/gis, '')
        .replace(/revisado por el autor de este artículo/gi, '')
        .replace(/Seguimos criterios de Ética y transparencia de BioBioChile/gi, '')

        // Limpiar espacios
        .replace(/\s+/g, ' ')
        .trim()
}
