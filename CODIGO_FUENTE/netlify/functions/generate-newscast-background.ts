import { createClient } from '@supabase/supabase-js'

// Simple types for Netlify function (avoids @netlify/functions dependency)
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

// Crear cliente Supabase con service role
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Background Function para generar noticieros
 * Se ejecuta de forma asíncrona y puede tardar hasta 15 minutos
 * El nombre del archivo DEBE terminar en -background para que Netlify lo reconozca
 * 
 * ESTRATEGIA: Esta función simplemente llama al endpoint /api/generate-newscast
 * que ya tiene toda la lógica de humanización con IA.
 */
const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
    console.log('🚀 Background Function generate-newscast-background iniciada')

    let jobId: string | undefined

    try {
        const body = JSON.parse(event.body || '{}')
        jobId = body.jobId
        const config = body.config

        if (!jobId || !config) {
            console.error('❌ jobId o config faltantes')
            return { statusCode: 400, body: JSON.stringify({ error: 'jobId y config son requeridos' }) }
        }

        console.log(`📋 Job ID: ${jobId}`)
        console.log(`📋 Región: ${config.region}`)

        // Actualizar estado: processing
        await updateJobStatus(jobId, 'processing', 5, 'Iniciando generación...')

        // Obtener la URL base del sitio
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL

        console.log(`🔗 Calling: ${baseUrl}/api/generate-newscast`)

        // Llamar al endpoint de generación real que tiene toda la lógica de IA
        const response = await fetch(`${baseUrl}/api/generate-newscast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        })

        if (response.ok) {
            const data = await response.json()

            // Actualizar job como completado con el newscastId del resultado
            await supabase
                .from('newscast_jobs')
                .update({
                    status: 'completed',
                    progress: 100,
                    progress_message: '¡Noticiero generado exitosamente!',
                    newscast_id: data.newscastId,
                    completed_at: new Date().toISOString()
                })
                .eq('id', jobId)

            console.log(`✅ Job ${jobId} completado: ${data.newscastId}`)

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, jobId, newscastId: data.newscastId })
            }
        } else {
            const errorText = await response.text()
            throw new Error(`Generate newscast failed: ${response.status} - ${errorText}`)
        }

    } catch (error) {
        console.error('❌ Background Function error:', error)

        // Actualizar job como fallido
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

/**
 * Actualizar estado del job en Supabase
 */
async function updateJobStatus(
    jobId: string,
    status: 'pending' | 'processing' | 'completed' | 'failed',
    progress: number,
    progressMessage: string
) {
    const { error } = await supabase
        .from('newscast_jobs')
        .update({
            status,
            progress,
            progress_message: progressMessage,
            started_at: status === 'processing' ? new Date().toISOString() : undefined,
            updated_at: new Date().toISOString()
        })
        .eq('id', jobId)

    if (error) {
        console.error('Error actualizando job status:', error)
    } else {
        console.log(`📊 Job ${jobId}: ${status} (${progress}%) - ${progressMessage}`)
    }
}

export { handler }
