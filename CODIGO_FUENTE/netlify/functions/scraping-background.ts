import { createClient } from '@supabase/supabase-js'

// Background function for scraping in Netlify
// Can run up to 15 minutes
// Invoked via /.netlify/functions/scraping-background

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

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface ScrapingPayload {
    jobId: string
    noticias: Array<{
        url: string
        titulo: string
        categoria: string
        fuente: string
        fuente_id: string
    }>
    region: string
    userId: string
}

export const handler = async (event: NetlifyEvent): Promise<NetlifyResponse> => {
    console.log('🚀 Background Function: scraping-background iniciada')

    let jobId: string | undefined

    try {
        if (!event.body) {
            console.error('No body provided')
            return { statusCode: 400, body: 'No body' }
        }

        const payload: ScrapingPayload = JSON.parse(event.body)
        jobId = payload.jobId
        const { noticias, region, userId } = payload

        console.log(`📋 Job ${jobId}: procesando ${noticias.length} noticias`)

        // Update job status to processing
        await supabase
            .from('scraping_jobs')
            .update({ status: 'processing' })
            .eq('id', jobId)

        // Construir URL - priorizar NEXT_PUBLIC_APP_URL
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.URL || process.env.DEPLOY_PRIME_URL

        console.log(`🔗 Base URL: ${baseUrl}`)
        console.log(`🔗 NEXT_PUBLIC_APP_URL: ${process.env.NEXT_PUBLIC_APP_URL}`)
        console.log(`🔗 URL: ${process.env.URL}`)
        console.log(`🔗 DEPLOY_PRIME_URL: ${process.env.DEPLOY_PRIME_URL}`)

        if (!baseUrl) {
            throw new Error('No se pudo determinar la URL base del sitio')
        }

        const endpoint = `${baseUrl}/api/scraping/deep`
        console.log(`🔗 Calling: ${endpoint}`)

        // Fetch con timeout de 10 minutos (600000ms)
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 600000)

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noticias, region, userId }),
            signal: controller.signal
        })

        clearTimeout(timeoutId)

        if (response.ok) {
            const data = await response.json()

            await supabase
                .from('scraping_jobs')
                .update({
                    status: 'completed',
                    progress: 100,
                    noticias_procesadas: data.noticias_procesadas || 0,
                    noticias_fallidas: data.noticias_fallidas || 0,
                    result: data,
                    completed_at: new Date().toISOString()
                })
                .eq('id', jobId)

            console.log(`✅ Job ${jobId} completado: ${data.noticias_procesadas} noticias`)

            return {
                statusCode: 200,
                body: JSON.stringify({ success: true, jobId })
            }
        } else {
            const errorText = await response.text()
            throw new Error(`Scraping failed: ${response.status} - ${errorText}`)
        }

    } catch (error) {
        console.error('❌ Background scraping error:', error)

        // Update job as failed
        if (jobId) {
            await supabase
                .from('scraping_jobs')
                .update({
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error',
                    completed_at: new Date().toISOString()
                })
                .eq('id', jobId)
        }

        return {
            statusCode: 500,
            body: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' })
        }
    }
}
