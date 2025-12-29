// ==================================================
// VIRA - Servicio de Humanización de Texto
// ==================================================
// Transforma contenido de noticias en texto natural
// para ser leído por TTS (Text-to-Speech)
// ==================================================

import { logTokenUsage, calculateGeminiAICost } from './usage-logger'
import { GEMINI_CONFIG, getGeminiUrl, buildGeminiRequestBody, parseGeminiResponse } from './gemini-config'
import { fetchWithRetry } from './utils'
import { detectRepetitions, buildCorrectivePrompt, type RepetitionAnalysis } from './text-validation'
import { getHumanizerSystemPrompt, getHumanizerUserPrompt, getReductionPrompt, ANTI_REPETITION_SYSTEM } from './prompts'

// Helper function para llamar a Gemini AI (reemplaza Chutes AI)
async function callGeminiAI(
    systemPrompt: string,
    userPrompt: string,
    options?: { maxTokens?: number; temperature?: number }
): Promise<{ success: boolean; content?: string; error?: string }> {
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`

    try {
        const response = await fetchWithRetry(
            getGeminiUrl(),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    generationConfig: {
                        temperature: options?.temperature ?? 0.7,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: options?.maxTokens ?? 2000
                    }
                })
            },
            { retries: 3, backoff: 2000 }
        )

        if (!response.ok) {
            const errorText = await response.text()
            console.warn(`⚠️ Gemini API error: ${response.status} - ${errorText}`)
            return { success: false, error: `Gemini error: ${response.status}` }
        }

        const data = await response.json()
        const content = parseGeminiResponse(data)

        return { success: true, content }
    } catch (error) {
        console.error('❌ Gemini API call failed:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
}

// ==================================================
// CONVERSIÓN DE NÚMEROS A PALABRAS (ESPAÑOL CHILENO)
// ==================================================
// Convierte números a texto para TTS preciso
// Ej: 155772 -> "ciento cincuenta y cinco mil setecientos setenta y dos"
// ==================================================

const UNIDADES = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve']
const ESPECIALES = ['diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve']
const DECENAS = ['', 'diez', 'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function convertirCentenas(n: number): string {
    if (n === 0) return ''
    if (n === 100) return 'cien'

    const centena = Math.floor(n / 100)
    const resto = n % 100

    let resultado = CENTENAS[centena]

    if (resto > 0) {
        resultado += (resultado ? ' ' : '') + convertirDecenas(resto)
    }

    return resultado
}

function convertirDecenas(n: number): string {
    if (n === 0) return ''
    if (n < 10) return UNIDADES[n]
    if (n < 20) return ESPECIALES[n - 10]
    if (n < 30) {
        if (n === 20) return 'veinte'
        return 'veinti' + UNIDADES[n - 20]
    }

    const decena = Math.floor(n / 10)
    const unidad = n % 10

    if (unidad === 0) return DECENAS[decena]
    return DECENAS[decena] + ' y ' + UNIDADES[unidad]
}

function convertirMiles(n: number): string {
    if (n === 0) return ''
    if (n === 1000) return 'mil'

    const miles = Math.floor(n / 1000)
    const resto = n % 1000

    let resultado = ''
    if (miles === 1) {
        resultado = 'mil'
    } else if (miles > 1) {
        resultado = convertirCentenas(miles) + ' mil'
    }

    if (resto > 0) {
        resultado += ' ' + convertirCentenas(resto)
    }

    return resultado.trim()
}

function convertirMillones(n: number): string {
    if (n === 0) return 'cero'
    if (n < 1000) return convertirCentenas(n)
    if (n < 1000000) return convertirMiles(n)

    const millones = Math.floor(n / 1000000)
    const resto = n % 1000000

    let resultado = ''
    if (millones === 1) {
        resultado = 'un millón'
    } else {
        resultado = convertirMiles(millones) + ' millones'
    }

    if (resto > 0) {
        if (resto < 1000) {
            resultado += ' ' + convertirCentenas(resto)
        } else {
            resultado += ' ' + convertirMiles(resto)
        }
    }

    return resultado.trim()
}

/**
 * Convierte un número a palabras en español chileno
 * @param num Número a convertir (0 a 999,999,999)
 * @returns Texto en español
 */
export function numberToWords(num: number): string {
    // Manejar negativos
    if (num < 0) return 'menos ' + numberToWords(Math.abs(num))

    // Manejar cero
    if (num === 0) return 'cero'

    // Limitar a mil millones
    if (num >= 1000000000) {
        const billones = Math.floor(num / 1000000000)
        const resto = num % 1000000000
        let resultado = billones === 1 ? 'mil millones' : convertirMiles(billones) + ' mil millones'
        if (resto > 0) resultado += ' ' + convertirMillones(resto)
        return resultado.trim()
    }

    return convertirMillones(Math.floor(num))
}

/**
 * Convierte números en un texto a palabras
 * Maneja formatos: 155.772 (miles con punto), 1,5 (decimales con coma), 1.5 (decimales con punto simple)
 */
export function convertNumbersInText(text: string): string {
    if (!text) return ''

    return text
        // Formato chileno: 155.772 (punto como separador de miles)
        .replace(/\b(\d{1,3}(?:\.\d{3})+)\b/g, (match) => {
            const num = parseInt(match.replace(/\./g, ''), 10)
            return numberToWords(num)
        })
        // Números simples: 15, 100, 2024
        .replace(/\b(\d+)\b/g, (match) => {
            const num = parseInt(match, 10)
            // No convertir años (1900-2100) ni números muy pequeños en contexto de fechas
            if (num >= 1900 && num <= 2100) {
                // Mantener años como están - TTS los lee bien
                return match
            }
            return numberToWords(num)
        })
}


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
        // PROMPTS CENTRALIZADOS (desde lib/prompts.ts)
        // ============================================================
        const systemPrompt = getHumanizerSystemPrompt(targetWords)
        const userPrompt = getHumanizerUserPrompt({
            region,
            topicAnchor,
            cleanedText,
            transitionPhrase
        })

        // Calcular tokens aproximados
        const inputTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)

        // ✅ MIGRADO A GEMINI AI
        const geminiResult = await callGeminiAI(systemPrompt, userPrompt, {
            maxTokens: Math.max(600, targetWords * 4),
            temperature: 0.5
        })

        if (!geminiResult.success || !geminiResult.content) {
            console.warn(`⚠️ Error en Gemini AI: ${geminiResult.error}. Usando texto original limpio.`)
            return fallbackHumanize(text, transitionPhrase, targetWords)
        }

        let humanizedContent = geminiResult.content.trim()

        if (!humanizedContent) {
            console.warn('⚠️ Respuesta vacía de Gemini AI. Usando fallback.')
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
                // ✅ MIGRADO A GEMINI AI
                const reprocessResult = await callGeminiAI(
                    'Editor de radio chilena. REDUCE textos para TTS. CERO comas. Máx 14 palabras por oración. No inventes nada.',
                    strictPrompt,
                    { maxTokens: Math.min(500, targetWords * 3), temperature: 0.1 }
                )

                if (reprocessResult.success && reprocessResult.content) {
                    const reducedContent = reprocessResult.content.trim()

                    if (reducedContent) {
                        const reducedWordCount = reducedContent.split(' ').length
                        console.log(`   ✂️ Reducido: ${generatedWordCount} → ${reducedWordCount} palabras`)

                        // Registrar tokens extra del re-procesamiento
                        const reprocessTokens = Math.ceil((strictPrompt.length + reducedContent.length) / 4)
                        const reprocessCost = calculateGeminiAICost(reprocessTokens)

                        await logTokenUsage({
                            user_id: userId,
                            servicio: 'gemini' as const,
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

                // ✅ MIGRADO A GEMINI AI
                const retryResult = await callGeminiAI(
                    'Eres un editor de radio chilena. Corrige textos con repeticiones para TTS.',
                    correctivePrompt,
                    { maxTokens: Math.max(600, targetWords * 4), temperature: 0.7 }
                )

                if (retryResult.success && retryResult.content) {
                    const correctedContent = retryResult.content.trim()

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
                                servicio: 'gemini' as const,
                                operacion: 'humanizacion_anti_repeticion',
                                tokens_usados: retryTokens,
                                costo: calculateGeminiAICost(retryTokens)
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
        const cost = calculateGeminiAICost(totalTokens)

        // Registrar uso
        await logTokenUsage({
            user_id: userId,
            servicio: 'gemini',
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

    // Paso 1: Limpiar el texto
    let cleaned = text
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

    // Paso 2: Convertir números a palabras para conteo preciso
    // Esto permite que "155.772 hectáreas" se cuente como ~10 palabras, no 2
    cleaned = convertNumbersInText(cleaned)

    return cleaned
}
