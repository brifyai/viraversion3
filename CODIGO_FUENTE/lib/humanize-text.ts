// ==================================================
// VIRA - Servicio de Humanización de Texto
// ==================================================
// Transforma contenido de noticias en texto natural
// para ser leído por TTS (Text-to-Speech)
// ==================================================

import { logTokenUsage, calculateChutesAICost } from './usage-logger'
import { CHUTES_CONFIG, getChutesHeaders } from './chutes-config'
import { fetchWithRetry } from './utils'

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

        // ============================================================
        // PROMPT MEJORADO - Radio Chilena + TTS Optimizado v3
        // ============================================================
        const systemPrompt = `Eres un locutor y redactor profesional de noticias para radio chilena.
Tu trabajo es reformular noticias como un guion de locución radial, pensado para ser leído por un sistema de texto a voz (TTS).

El texto debe sonar natural, humano y continuo, como una noticia leída al aire por un locutor profesional.

🎙️ ESTILO NOTICIERO CHILENO (OPTIMIZADO PARA VOZ)
- Tono serio, informativo y cercano
- Frases medianas y bien encadenadas, pensadas para ser dichas en voz alta
- Ninguna frase debe ser tan larga que no pueda decirse de una sola respiración
- Evita incluir más de dos acciones o ideas informativas en una misma oración
- Ritmo natural, con pausas claras marcadas por puntos
- Texto continuo y narrativo, no telegráfico ni administrativo
- Vocabulario chileno profesional

📝 REGLAS DE PUNTUACIÓN PARA TTS
- Usa comas solo cuando sean estrictamente necesarias para la comprensión
- Si una oración incluye varias acciones, divídela en dos o más oraciones
- Prefiere puntos para separar ideas completas
- No utilices punto y coma ni dos puntos innecesarios
- Evita paréntesis, guiones largos o estructuras visuales
- Escribe números grandes en palabras cuando suene más natural al oído

📊 ESTRUCTURA DE LA NOTICIA
1. Gancho inicial: El hecho más relevante, en una oración clara y directa.
2. Desarrollo: Contexto y detalles relevantes, repartidos en frases fluidas. Evita concentrar demasiada información en una sola oración.
3. Cierre: Frase final clara, informativa y con sentido de cierre radial.

⚠️ REGLAS CRÍTICAS
- Nunca inventes datos, cifras, nombres ni declaraciones
- Usa solo información presente en el texto original
- No menciones autores, medios ni expresiones como "según fuentes"
- No uses emojis ni caracteres especiales
- Mantén absoluta precisión informativa

📏 LONGITUD
- Extensión objetivo: ${targetWords} palabras
- Si el contenido es largo, resume lo esencial
- Si es breve, agrega contexto general sin inventar información

🔚 INSTRUCCIÓN FINAL
Devuelve únicamente el texto reformulado, como guion de noticiero radial, listo para ser leído al aire por un sistema de voz.`

        const userPrompt = `Reformula esta noticia para RADIO CHILENA, en formato de locución radial continua (objetivo aproximado: ${targetWords} palabras).

CONTENIDO ORIGINAL:
"${cleanedText}"

${transitionPhrase ? `COMENZAR CON: "${transitionPhrase}"` : ''}
REGIÓN: ${region}

Devuelve solo el texto reformulado, listo para locución radial.`

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
        let humanizedContent = data.choices?.[0]?.message?.content?.trim()

        if (!humanizedContent) {
            console.warn('⚠️ Respuesta vacía de Chutes AI. Usando fallback.')
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

            // Prompt mejorado para reducir manteniendo ritmo de locución v2
            const strictPrompt = `Revisa y ajusta el siguiente texto para un máximo de ${targetWords} palabras.

OBJETIVO PRINCIPAL:
- Eliminar comas innecesarias que afecten la lectura en voz alta
- Dividir oraciones largas en frases más cortas
- Usar puntos para marcar pausas naturales
- Asegurar que cada frase pueda decirse de una sola respiración

REGLAS:
- Mantén solo la información esencial
- No agregues datos nuevos
- No compactes información uniendo acciones en una sola oración
- Prefiere eliminar frases completas antes que saturar una oración
- Evita más de una coma por oración, salvo que sea estrictamente necesaria
- No uses punto y coma, dos puntos ni paréntesis
- El texto debe sonar humano, fluido y radial
- Debe terminar en una oración completa y clara

TEXTO A AJUSTAR:
"${humanizedContent}"

Devuelve solo el texto final, listo para ser leído por un sistema TTS.`

            try {
                const reprocessResponse = await fetchWithRetry(
                    CHUTES_CONFIG.endpoints.chatCompletions,
                    {
                        method: 'POST',
                        headers: getChutesHeaders(),
                        body: JSON.stringify({
                            model: CHUTES_CONFIG.model,
                            messages: [
                                { role: 'system', content: 'Eres un editor profesional de noticias radiales para radio chilena. Tu tarea es reducir y corregir textos para que suenen naturales al ser leídos por un sistema de texto a voz (TTS). Tu prioridad no es ahorrar palabras, sino mejorar la respiración, el ritmo y la claridad de la locución.' },
                                { role: 'user', content: strictPrompt }
                            ],
                            max_tokens: targetWords * 3,
                            temperature: 0.3
                        })
                    },
                    { retries: 2, backoff: 2000 }  // ✅ Aumentado para evitar 429 en producción
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
