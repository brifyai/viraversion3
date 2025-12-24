import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const supabase = supabaseAdmin

// Detectar si estamos en Netlify - usar URL ya que NETLIFY/CONTEXT no están disponibles en Next.js runtime
const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
const isNetlify = appUrl.includes('netlify.app') || appUrl.includes('.app') || process.env.NETLIFY === 'true'

/**
 * POST /api/scraping/deep-async
 * 
 * Dispatcher para scraping asíncrono:
 * 1. Crea un job en scraping_jobs
 * 2. En desarrollo: procesa directamente
 * 3. En Netlify: invoca Background Function
 * 4. Retorna jobId inmediatamente
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { noticias, region = 'Nacional', userId: bodyUserId } = body

        // Autenticación
        const session = await getSupabaseSession()
        let userId = session?.user?.id

        // Fallback: userId en body
        if (!userId && bodyUserId) {
            const { data: userCheck } = await supabase
                .from('users')
                .select('id, email')
                .eq('id', bodyUserId)
                .single()

            if (userCheck) {
                userId = bodyUserId
            }
        }

        if (!userId) {
            return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
        }

        if (!noticias || !Array.isArray(noticias) || noticias.length === 0) {
            return NextResponse.json({ error: 'Debes enviar noticias para scrapear' }, { status: 400 })
        }

        const jobId = uuidv4()
        console.log(`🚀 Creando job de scraping: ${jobId} (${noticias.length} noticias)`)

        // Crear job en DB
        const { error: insertError } = await supabase
            .from('scraping_jobs')
            .insert({
                id: jobId,
                user_id: userId,
                status: 'pending',
                progress: 0,
                total: noticias.length,
                noticias_procesadas: 0
            })

        if (insertError) {
            console.error('Error creando job:', insertError)
            return NextResponse.json({ error: 'Error creando job' }, { status: 500 })
        }

        // En Netlify: invocar Background Function
        // En desarrollo: procesar en background local
        if (isNetlify) {
            const baseUrl = process.env.URL || process.env.NEXT_PUBLIC_APP_URL
            const functionUrl = `${baseUrl}/.netlify/functions/scraping-background`

            console.log('🌐 Netlify detectado: invocando Background Function')
            console.log(`   📡 URL: ${functionUrl}`)
            console.log(`   📋 Payload: jobId=${jobId}, noticias=${noticias.length}`)

            // IMPORTANTE: Esperar la respuesta inicial (202) antes de retornar
            // Esto garantiza que la Background Function fue invocada correctamente
            // Sin esto, la función puede terminar antes de que el fetch complete
            try {
                const bgResponse = await fetch(functionUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jobId, noticias, region, userId })
                })

                if (bgResponse.ok || bgResponse.status === 202) {
                    console.log(`   ✅ Background function invocada exitosamente: ${bgResponse.status}`)
                } else {
                    const errorText = await bgResponse.text().catch(() => 'No body')
                    console.error(`   ❌ Background function error: ${bgResponse.status} - ${errorText}`)
                    // No fallamos, el job ya está creado y se puede reintentar
                }
            } catch (fetchError) {
                console.error('   ❌ Error de red invocando background function:', fetchError)
                // No fallamos, el job ya está creado y se puede reintentar
            }
        } else {
            console.log('💻 Desarrollo: procesando en background local')
            processScrapingInBackground(jobId, noticias, region, userId)
        }

        return NextResponse.json({
            success: true,
            jobId,
            message: `Scraping iniciado. Polling en /api/scraping/job-status?id=${jobId}`
        })

    } catch (error) {
        console.error('Error en scraping-async:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        )
    }
}

/**
 * Procesa el scraping en background (fire-and-forget)
 */
async function processScrapingInBackground(
    jobId: string,
    noticias: any[],
    region: string,
    userId: string
) {
    try {
        // Actualizar estado a processing
        await supabase
            .from('scraping_jobs')
            .update({ status: 'processing' })
            .eq('id', jobId)

        // Llamar al endpoint sync
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
        const response = await fetch(`${baseUrl}/api/scraping/deep`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noticias, region, userId })
        })

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

            console.log(`✅ Job scraping ${jobId} completado: ${data.noticias_procesadas} noticias`)
        } else {
            const errorText = await response.text()
            throw new Error(`Error ${response.status}: ${errorText}`)
        }

    } catch (error) {
        console.error(`❌ Job scraping ${jobId} falló:`, error)

        await supabase
            .from('scraping_jobs')
            .update({
                status: 'failed',
                error: error instanceof Error ? error.message : 'Error desconocido',
                completed_at: new Date().toISOString()
            })
            .eq('id', jobId)
    }
}
