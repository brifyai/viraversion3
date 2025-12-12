// ==================================================
// VIRA - Servicio de Humanización de Texto
// ==================================================
// Transforma contenido de noticias en texto natural
// para ser leído por TTS (Text-to-Speech)
// ==================================================

import { logTokenUsage, calculateChutesAICost } from './usage-logger'
import { CHUTES_CONFIG, getChutesHeaders } from './chutes-config'
import { fetchWithRetry } from './utils'

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
        // Intentar humanizar con IA (Chutes AI)
        const transitionPhrase = context ? getTransitionPhrase(context) : ''
        const targetWords = options?.targetWordCount || 100  // Default 100 palabras

        // Prompt mejorado con énfasis en FIDELIDAD y control de longitud
        const systemPrompt = `Eres un locutor de noticias profesional de radio chilena. Tu trabajo es reformular noticias para que suenen naturales al ser leídas en voz alta.

⚠️ REGLA CRÍTICA - FIDELIDAD:
- NUNCA inventes datos específicos, cifras, nombres o detalles que no estén en el contenido original
- Mantén la precisión de los hechos reportados

📏 LONGITUD OBJETIVO: Aproximadamente ${targetWords} palabras.
- Si el contenido original es más largo: resume los puntos más importantes
- Si el contenido original es más corto: AMPLÍA con:
  * Contexto general del tema (sin inventar datos específicos)
  * Implicaciones y posibles consecuencias
  * Preguntas retóricas para el oyente
  * Conexiones con temas de actualidad
  * Frases de cierre reflexivas

📝 FORMATO:
1. Usa un tono profesional pero cercano
2. Evita jerga técnica innecesaria
3. NO uses emojis, hashtags, ni caracteres especiales
4. NO menciones fuentes ni autores
5. USA español chileno cuando sea apropiado
6. Elimina timestamps, pipes y metadata
7. Asegúrate que el texto fluya naturalmente para TTS
8. Incluye pausas naturales y transiciones suaves

IMPORTANTE: Solo devuelve el texto reformulado, sin explicaciones adicionales.`

        const userPrompt = `Reformula esta noticia para radio (objetivo: ~${targetWords} palabras):

"${text}"

${transitionPhrase ? `Comienza con: "${transitionPhrase}"` : ''}
Región: ${region}

Recuerda: SOLO usa información del texto original. NO inventes datos.`

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
                    max_tokens: Math.max(400, targetWords * 2),  // Ajustar max_tokens según objetivo
                    temperature: 0.5  // Reducir temperatura para más fidelidad
                })
            },
            { retries: 3, backoff: 1000 }
        )

        if (!response.ok) {
            console.warn(`⚠️ Error en Chutes AI: ${response.status}. Usando texto original limpio.`)
            return fallbackHumanize(text, transitionPhrase)
        }

        const data = await response.json()
        const humanizedContent = data.choices?.[0]?.message?.content?.trim()

        if (!humanizedContent) {
            console.warn('⚠️ Respuesta vacía de Chutes AI. Usando fallback.')
            return fallbackHumanize(text, transitionPhrase)
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
        return fallbackHumanize(text, transitionPhrase)
    }
}

// Fallback cuando la IA no está disponible
function fallbackHumanize(text: string, transitionPhrase: string = ''): HumanizeResult {
    // Limpiar el texto básicamente
    let cleaned = text
        // Eliminar timestamps
        .replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/gi, '')
        // Eliminar prefijos urgentes
        .replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO|BREAKING)\s*[|•:-]\s*/gi, '')
        // Reemplazar pipes por puntos
        .replace(/\s+\|\s+/g, '. ')
        // Eliminar URLs
        .replace(/https?:\/\/[^\s]+/g, '')
        // Eliminar múltiples espacios
        .replace(/\s+/g, ' ')
        // Eliminar caracteres especiales problemáticos para TTS
        .replace(/[#@*_~`]/g, '')
        .trim()

    // Agregar transición al inicio si existe
    if (transitionPhrase && cleaned) {
        cleaned = transitionPhrase + cleaned
    }

    // Asegurar que termine con punto
    if (cleaned && !cleaned.endsWith('.') && !cleaned.endsWith('?') && !cleaned.endsWith('!')) {
        cleaned += '.'
    }

    return {
        content: cleaned,
        tokensUsed: 0,
        cost: 0
    }
}

// Función para limpiar texto para TTS (sin humanizar)
export function sanitizeForTTS(text: string): string {
    if (!text) return ''

    return text
        // Eliminar timestamps
        .replace(/^\d{1,2}:\d{2}\s*(hrs|horas|pm|am)?\s*[|•-]\s*/gi, '')
        // Eliminar prefijos
        .replace(/^(URGENTE|AHORA|ÚLTIMO MINUTO)\s*[|•-]\s*/gi, '')
        // Reemplazar pipes
        .replace(/\s+\|\s+/g, '. ')
        // Limpiar espacios
        .replace(/\s+/g, ' ')
        .trim()
}
