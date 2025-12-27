/**
 * COLOCACIÓN INTELIGENTE DE AUDIO CON IA
 * 
 * Este módulo usa Chutes AI para decidir dónde colocar los audios
 * (cortinas, intro, outro, efectos) en el timeline del noticiero
 * basándose en las descripciones de los audios.
 */

import { createClient } from '@supabase/supabase-js'
import { GEMINI_CONFIG, getGeminiUrl, parseGeminiResponse } from './gemini-config'
import { logTokenUsage, calculateChutesAICost } from './usage-logger'
import { fetchWithRetry } from './utils'

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Tipos para los audios
export interface AudioItem {
    id: string
    nombre: string
    tipo: 'cortina' | 'musica' | 'efecto' | 'jingle' | 'intro' | 'outro'
    descripcion?: string
    audio: string
    duracion?: string  // Formato legible "0:30"
    duration_seconds?: number  // Duración en segundos (preferido)
}

// Tipos para el timeline
export interface TimelineItem {
    id: string
    type: 'news' | 'weather' | 'time' | 'ad' | 'audio' | 'intro' | 'outro' | 'cortina'
    title?: string
    category?: string
    content?: string
    audioUrl?: string
    audioId?: string
    audioName?: string
    duration?: number  // Duración en segundos
}

// Resultado del placement
export interface AudioPlacement {
    audioId: string
    audioName: string
    audioUrl: string
    position: number
    reason: string
    duration?: number  // Duración en segundos
}

/**
 * Carga los audios del usuario desde la base de datos
 */
export async function loadUserAudios(
    userEmail: string,
    tipos?: string[]
): Promise<AudioItem[]> {
    try {
        const tiposABuscar = tipos || ['cortina', 'musica', 'efecto', 'jingle', 'intro', 'outro']

        console.log(`🔍 Buscando audios para usuario: ${userEmail}`)
        console.log(`   Tipos buscados: ${tiposABuscar.join(', ')}`)

        // Query simple: traer todos los audios activos del tipo correcto
        const { data, error } = await supabase
            .from('biblioteca_audio')
            .select('*')
            .in('tipo', tiposABuscar)

        if (error) {
            console.error('❌ Error cargando audios:', error)
            return []
        }

        console.log(`   📦 Query retornó ${data?.length || 0} registros`)

        // Filtrar por usuario en código (más robusto)
        let audiosFiltrados = (data || []).filter(a => {
            // Audios globales
            if (a.usuario === 'todos') return true
            // Audios del usuario actual
            if (a.usuario === userEmail) return true
            // Audios sin usuario asignado (globales por defecto)
            if (!a.usuario) return true
            return false
        })

        // ✅ NUEVO: Filtrar solo audios con URLs de Drive (no archivos locales)
        audiosFiltrados = audiosFiltrados.filter(a => {
            if (!a.audio) return false
            // Solo incluir URLs de Drive (https://)
            if (a.audio.startsWith('https://')) return true
            // Excluir archivos locales (/audio/...)
            if (a.audio.startsWith('/')) {
                console.log(`   ⚠️ Ignorando audio local: "${a.nombre}" (${a.audio.substring(0, 30)}...)`)
                return false
            }
            return false
        })

        // Log detallado
        console.log(`🎵 Filtrados ${audiosFiltrados.length} audios para este usuario (con Drive):`)
        audiosFiltrados.forEach(a => {
            console.log(`   - "${a.nombre}" (${a.tipo})`)
            if (a.descripcion) {
                console.log(`     📝 "${a.descripcion}"`)
            } else {
                console.log(`     ⚠️ Sin descripción - será ignorado por la IA`)
            }
        })

        return audiosFiltrados
    } catch (error) {
        console.error('❌ Error en loadUserAudios:', error)
        return []
    }
}

/**
 * Construye el prompt para que la IA decida posiciones
 */
function buildPlacementPrompt(audios: AudioItem[], timeline: TimelineItem[]): string {
    // Formatear audios disponibles con IDs reales
    const audiosStr = audios.map((a, i) =>
        `- ID: "${a.id}" | Nombre: "${a.nombre}" | Tipo: ${a.tipo} | Descripción: "${a.descripcion || 'Sin descripción específica'}"`
    ).join('\n')

    // Formatear timeline
    const timelineStr = timeline.map((item, i) => {
        if (item.type === 'news') {
            return `${i}. [NOTICIA] ${item.title || 'Sin título'} (categoría: ${item.category || 'general'})`
        } else if (item.type === 'intro') {
            return `${i}. [INTRO] Introducción del noticiero`
        } else if (item.type === 'weather') {
            return `${i}. [CLIMA] Reporte del tiempo`
        } else if (item.type === 'ad') {
            return `${i}. [PUBLICIDAD] Anuncio comercial`
        }
        return `${i}. [${item.type.toUpperCase()}]`
    }).join('\n')

    return `Eres un editor de noticiero de radio. Debes colocar los audios disponibles en el timeline.

AUDIOS DISPONIBLES:
${audiosStr}

TIMELINE ACTUAL (${timeline.length} elementos):
${timelineStr}

INSTRUCCIONES:
1. Analiza la descripción de cada audio para decidir dónde colocarlo.
2. Si la descripción menciona "inicio", "empiezan", "comenzar" → posición 1 (justo después de la intro)
3. Si la descripción menciona "final", "cierre", "terminar" → posición ${timeline.length}
4. Si la descripción menciona "deportes" → antes de la primera noticia deportiva
5. Si la descripción menciona "entre noticias" o "separar" → posición intermedia
6. Si no hay descripción específica pero es tipo "cortina" → posición 1

IMPORTANTE: 
- USA EL ID EXACTO del audio (el UUID que aparece después de "ID:")
- Cada audio DEBE colocarse en alguna posición, no dejes ninguno sin usar
- Responde SOLO con JSON, sin texto adicional

Formato de respuesta:
{"placements": [{"audioId": "uuid-exacto-del-audio", "position": 1, "reason": "Razón breve"}]}`
}

/**
 * Llama a Chutes AI para decidir la ubicación de los audios
 */
export async function decideAudioPlacements(
    audios: AudioItem[],
    timeline: TimelineItem[],
    userId?: string
): Promise<AudioPlacement[]> {
    try {
        // Si no hay audios, retornar vacío
        if (!audios || audios.length === 0) {
            console.log('⚠️ No hay audios disponibles para placement')
            return []
        }

        // Si no hay timeline, retornar vacío
        if (!timeline || timeline.length === 0) {
            console.log('⚠️ No hay timeline para colocar audios')
            return []
        }

        // Verificar que Gemini está configurado
        if (!GEMINI_CONFIG.apiKey) {
            console.error('❌ GEMINI_API_KEY no configurada')
            return []
        }

        const prompt = buildPlacementPrompt(audios, timeline)
        console.log('🤖 Solicitando placement de audios a Gemini AI...')

        // ✅ MIGRADO A GEMINI AI
        const systemPrompt = 'Eres un asistente que responde SOLO con JSON válido. No uses markdown ni explicaciones.'
        const fullPrompt = `${systemPrompt}\n\n${prompt}`

        const response = await fetchWithRetry(
            getGeminiUrl(),
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: fullPrompt }] }],
                    generationConfig: {
                        temperature: 0.3,
                        topK: 40,
                        topP: 0.95,
                        maxOutputTokens: 1024
                    }
                })
            },
            {
                retries: 2,
                backoff: 1000,
                onRetry: (attempt: number) => console.log(`🔄 Reintentando placement(intento ${attempt})...`)
            }
        )

        if (!response.ok) {
            const errorText = await response.text()
            console.error('❌ Error de Gemini AI:', errorText)
            return []
        }

        const data = await response.json()

        // Parsear respuesta de Gemini
        let content = '{}'
        try {
            content = parseGeminiResponse(data)
        } catch (e) {
            console.error('❌ Error parseando respuesta Gemini:', e)
            return []
        }

        // Calcular tokens usados (estimación)
        const tokensUsed = Math.ceil((prompt.length + content.length) / 4)
        const cost = calculateChutesAICost(tokensUsed)

        // Registrar uso de tokens
        if (tokensUsed > 0) {
            await logTokenUsage({
                user_id: userId,
                servicio: 'chutes' as const,  // ✅ Compatible con tipo existente
                operacion: 'audio_placement',
                tokens_usados: tokensUsed,
                costo: cost,
                metadata: {
                    model: GEMINI_CONFIG.model,
                    audios_count: audios.length,
                    timeline_count: timeline.length
                }
            })
        }

        // Limpiar respuesta (quitar posible markdown)
        let cleanContent = content.trim()
        if (cleanContent.startsWith('```json')) {
            cleanContent = cleanContent.slice(7)
        }
        if (cleanContent.startsWith('```')) {
            cleanContent = cleanContent.slice(3)
        }
        if (cleanContent.endsWith('```')) {
            cleanContent = cleanContent.slice(0, -3)
        }

        const result = JSON.parse(cleanContent)
        const placements: AudioPlacement[] = []

        // Mapear placements con datos completos del audio
        if (result.placements && Array.isArray(result.placements)) {
            for (const p of result.placements) {
                const audio = audios.find(a => a.id === p.audioId)
                if (audio) {
                    // Obtener duración: preferir duration_seconds (int), luego parsear duracion (string)
                    let durationSeconds = 30 // Default

                    if (audio.duration_seconds && audio.duration_seconds > 0) {
                        // Usar el campo entero directamente (preferido)
                        durationSeconds = audio.duration_seconds
                    } else if (audio.duracion) {
                        // Parsear formato string "0:30" o "30"
                        if (typeof audio.duracion === 'string' && audio.duracion.includes(':')) {
                            const [mins, secs] = audio.duracion.split(':').map(Number)
                            durationSeconds = (mins || 0) * 60 + (secs || 0)
                        } else {
                            durationSeconds = parseInt(audio.duracion as string) || 30
                        }
                    }

                    console.log(`   ⏱️ Audio "${audio.nombre}": duración ${durationSeconds}s`)

                    placements.push({
                        audioId: audio.id,
                        audioName: audio.nombre,
                        audioUrl: audio.audio,
                        position: p.position,
                        reason: p.reason || 'Decidido por IA',
                        duration: durationSeconds
                    })
                }
            }
        }

        console.log(`✅ IA decidió ${placements.length} posiciones de audio`)
        placements.forEach(p => {
            console.log(`   📍 "${p.audioName}" → posición ${p.position} (${p.reason})`)
        })

        return placements

    } catch (error) {
        console.error('❌ Error en decideAudioPlacements:', error)
        return []
    }
}

/**
 * Inserta los audios en el timeline según las posiciones decididas
 */
export function insertAudiosInTimeline(
    timeline: TimelineItem[],
    placements: AudioPlacement[]
): TimelineItem[] {
    if (!placements || placements.length === 0) {
        return timeline
    }

    // Copiar timeline para no modificar el original
    const newTimeline = [...timeline]

    // Ordenar placements de mayor a menor posición para insertar desde el final
    const sortedPlacements = [...placements].sort((a, b) => b.position - a.position)

    for (const placement of sortedPlacements) {
        const audioItem: TimelineItem = {
            id: `audio-${placement.audioId}`,
            type: 'cortina',  // Tipo cortina para que la UI lo muestre correctamente
            title: placement.audioName,
            audioUrl: placement.audioUrl,
            audioId: placement.audioId,
            audioName: placement.audioName,
            duration: placement.duration || 30  // Duración real del audio
        }

        // Insertar en la posición indicada
        const insertPosition = Math.min(placement.position, newTimeline.length)
        newTimeline.splice(insertPosition, 0, audioItem)
    }

    console.log(`📝 Timeline actualizado: ${timeline.length} → ${newTimeline.length} elementos`)
    return newTimeline
}

/**
 * Función principal: Carga audios, decide posiciones e inserta en timeline
 */
export async function applyIntelligentAudioPlacement(
    timeline: TimelineItem[],
    userEmail: string,
    userId?: string,
    audioConfig?: {
        cortinas_enabled?: boolean
        tipos_audio?: string[]
    }
): Promise<TimelineItem[]> {
    try {
        // Verificar si está habilitado
        if (!audioConfig?.cortinas_enabled) {
            console.log('⏭️ Audio placement deshabilitado')
            return timeline
        }

        // 1. Cargar audios del usuario
        const tiposAudio = audioConfig?.tipos_audio || ['cortina', 'intro', 'outro', 'jingle', 'efecto']
        const audios = await loadUserAudios(userEmail, tiposAudio)

        if (audios.length === 0) {
            console.log('⚠️ No hay audios configurados para este usuario')
            return timeline
        }

        // 2. Pedir a la IA que decida posiciones
        const placements = await decideAudioPlacements(audios, timeline, userId)

        if (placements.length === 0) {
            console.log('ℹ️ La IA no encontró audios apropiados para colocar')
            return timeline
        }

        // 3. Insertar audios en el timeline
        const newTimeline = insertAudiosInTimeline(timeline, placements)

        return newTimeline

    } catch (error) {
        console.error('❌ Error en applyIntelligentAudioPlacement:', error)
        return timeline // Retornar timeline original en caso de error
    }
}
