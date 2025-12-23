import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions'
import { createClient } from '@supabase/supabase-js'

// Crear cliente Supabase con service role (para background functions)
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Configuración de Chutes AI
const CHUTES_CONFIG = {
    apiKey: process.env.CHUTES_API_KEY || '',
    endpoints: {
        chatCompletions: process.env.CHUTES_CHAT_COMPLETIONS_URL || 'https://llm.chutes.ai/v1/chat/completions'
    },
    model: process.env.CHUTES_MODEL || 'deepseek-ai/DeepSeek-V3-0324'
}

// Constantes de timing
const CORRECTION_FACTOR = 0.95
const WORDS_PER_NEWS = 100
const SILENCE_BETWEEN_NEWS = 1.5
const INTRO_DURATION = 12
const OUTRO_DURATION = 15
const AD_DURATION = 15

/**
 * Background Function para generar noticieros
 * Se ejecuta de forma asíncrona y puede tardar hasta 15 minutos
 * El nombre del archivo DEBE terminar en -background para que Netlify lo reconozca
 */
const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
    console.log('🚀 Background Function iniciada')

    try {
        const body = JSON.parse(event.body || '{}')
        const { jobId, config } = body

        if (!jobId || !config) {
            console.error('❌ jobId o config faltantes')
            return { statusCode: 400, body: JSON.stringify({ error: 'jobId y config son requeridos' }) }
        }

        console.log(`📋 Job ID: ${jobId}`)
        console.log(`📋 Config recibida:`, JSON.stringify(config, null, 2).substring(0, 500))

        // Actualizar estado: processing
        await updateJobStatus(jobId, 'processing', 0, 'Iniciando generación...')

        // =====================================================
        // AQUÍ VA LA LÓGICA PRINCIPAL DE GENERACIÓN
        // (Migrada desde app/api/generate-newscast/route.ts)
        // =====================================================

        const {
            region,
            radioName,
            categories,
            categoryConfig,
            specificNewsUrls,
            targetDuration,
            voiceWPM = 168,
            voiceSettings,
            voiceModel,
            adCount = 2,
            userId
        } = config

        console.log(`🎙️ Generando noticiero para ${region} (${targetDuration}s planificados)`)

        await updateJobStatus(jobId, 'processing', 10, 'Buscando noticias en base de datos...')

        // 1. Obtener noticias
        const uniqueUrls: string[] = specificNewsUrls
            ? [...new Set(specificNewsUrls as string[])]
            : []

        let selectedNews: any[] = []

        if (uniqueUrls.length > 0) {
            const { data: newsData, error } = await supabase
                .from('noticias_scrapeadas')
                .select('*')
                .in('url', uniqueUrls)

            if (error) {
                throw new Error(`Error obteniendo noticias: ${error.message}`)
            }
            selectedNews = newsData || []
        }

        console.log(`📰 ${selectedNews.length} noticias encontradas`)
        await updateJobStatus(jobId, 'processing', 20, `${selectedNews.length} noticias encontradas`)

        if (selectedNews.length === 0) {
            throw new Error('No se encontraron noticias para generar el noticiero')
        }

        // 2. Humanizar noticias (simulado - aquí iría la llamada real)
        await updateJobStatus(jobId, 'processing', 30, 'Humanizando textos...')

        // TODO: Importar y ejecutar humanizeText para cada noticia
        // Por ahora, simular el procesamiento
        const processedNews = selectedNews.map((news, index) => ({
            ...news,
            humanizedContent: news.contenido || news.resumen || news.titulo,
            palabras: Math.round((news.contenido?.length || 500) / 6)
        }))

        await updateJobStatus(jobId, 'processing', 60, 'Generando estructura del noticiero...')

        // 3. Crear estructura del timeline
        const timeline = buildTimeline(processedNews, {
            region,
            radioName: radioName || `Radio ${region}`,
            adCount,
            targetDuration,
            voiceWPM
        })

        await updateJobStatus(jobId, 'processing', 80, 'Guardando en base de datos...')

        // 4. Guardar noticiero en DB
        const { data: noticiero, error: insertError } = await supabase
            .from('noticieros')
            .insert({
                titulo: `Noticiero ${region} - ${new Date().toLocaleDateString('es-CL')}`,
                region,
                datos_timeline: timeline,
                duracion_segundos: targetDuration,
                estado: 'generado',
                user_id: userId,
                metadata: {
                    voiceModel,
                    voiceSettings,
                    generatedAt: new Date().toISOString(),
                    newsCount: selectedNews.length,
                    generatedViaBackground: true
                }
            })
            .select()
            .single()

        if (insertError || !noticiero) {
            throw new Error(`Error guardando noticiero: ${insertError?.message || 'Unknown error'}`)
        }

        console.log(`✅ Noticiero guardado: ${noticiero.id}`)

        // 5. Marcar job como completado
        await updateJobStatus(jobId, 'completed', 100, '¡Noticiero generado exitosamente!', noticiero.id)

        return {
            statusCode: 202,
            body: JSON.stringify({
                success: true,
                jobId,
                newscastId: noticiero.id
            })
        }

    } catch (error) {
        console.error('❌ Error en Background Function:', error)

        const body = JSON.parse(event.body || '{}')
        if (body.jobId) {
            await updateJobStatus(
                body.jobId,
                'failed',
                0,
                'Error en generación',
                undefined,
                error instanceof Error ? error.message : 'Error desconocido'
            )
        }

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error instanceof Error ? error.message : 'Error desconocido'
            })
        }
    }
}

/**
 * Actualizar estado del job en Supabase
 */
async function updateJobStatus(
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress: number,
    progressMessage: string,
    newscastId?: string,
    error?: string
) {
    const updateData: any = {
        status,
        progress,
        progress_message: progressMessage,
        updated_at: new Date().toISOString()
    }

    if (status === 'processing' && progress === 0) {
        updateData.started_at = new Date().toISOString()
    }

    if (status === 'completed' || status === 'failed') {
        updateData.completed_at = new Date().toISOString()
    }

    if (newscastId) {
        updateData.newscast_id = newscastId
    }

    if (error) {
        updateData.error = error
    }

    const { error: dbError } = await supabase
        .from('newscast_jobs')
        .update(updateData)
        .eq('id', jobId)

    if (dbError) {
        console.error('Error actualizando job status:', dbError)
    } else {
        console.log(`📊 Job ${jobId}: ${status} (${progress}%) - ${progressMessage}`)
    }
}

/**
 * Construir timeline básico del noticiero
 */
function buildTimeline(news: any[], config: any) {
    const timeline: any[] = []

    // Intro
    timeline.push({
        id: 'intro',
        type: 'intro',
        title: 'Intro',
        text: `Bienvenidos al noticiero de ${config.radioName}.`,
        duration: INTRO_DURATION
    })

    // Noticias con publicidades intercaladas
    const newsPerAd = config.adCount > 0 ? Math.ceil(news.length / (config.adCount + 1)) : news.length
    let adIndex = 0

    news.forEach((item, index) => {
        // Agregar noticia
        timeline.push({
            id: item.id,
            type: 'news',
            title: item.titulo,
            text: item.humanizedContent,
            duration: Math.round(item.palabras / (config.voiceWPM / 60)),
            category: item.categoria
        })

        // Agregar publicidad si corresponde
        if ((index + 1) % newsPerAd === 0 && adIndex < config.adCount) {
            timeline.push({
                id: `ad-${adIndex}`,
                type: 'ad',
                title: `Publicidad ${adIndex + 1}`,
                duration: AD_DURATION
            })
            adIndex++
        }
    })

    // Outro
    timeline.push({
        id: 'outro',
        type: 'outro',
        title: 'Cierre',
        text: `Esto ha sido todo en ${config.radioName}. ¡Hasta la próxima!`,
        duration: OUTRO_DURATION
    })

    return timeline
}

export { handler }
