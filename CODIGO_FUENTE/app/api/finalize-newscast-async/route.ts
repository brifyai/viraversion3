import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'

const supabase = supabaseAdmin

export async function POST(request: NextRequest) {
    try {
        const session = await getSupabaseSession()
        const userId = session?.user?.id

        if (!userId) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const body = await request.json()
        const { newscastId, config } = body

        if (!newscastId) {
            return NextResponse.json({ error: 'newscastId es requerido' }, { status: 400 })
        }

        console.log(`🎵 Iniciando job de finalización async para: ${newscastId}`)

        // 1. Crear job en finalize_jobs
        const jobId = crypto.randomUUID()

        const { error: insertError } = await supabase
            .from('finalize_jobs')
            .insert({
                id: jobId,
                user_id: userId,
                newscast_id: newscastId,
                status: 'pending',
                progress: 0,
                progress_message: 'Job creado, esperando procesamiento...',
                config: config || {},
                created_at: new Date().toISOString()
            })

        if (insertError) {
            console.error('Error creando finalize job:', insertError)
            return NextResponse.json(
                { error: `Error creando job: ${insertError.message}` },
                { status: 500 }
            )
        }

        console.log(`📋 Finalize Job creado: ${jobId}`)

        // 2. Detectar entorno y invocar Background Function
        const isNetlify = process.env.NETLIFY === 'true' ||
            process.env.CONTEXT === 'production' ||
            process.env.CONTEXT === 'deploy-preview'

        if (isNetlify) {
            // Invocar Background Function
            const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://virav3.netlify.app'
            const functionUrl = `${siteUrl}/.netlify/functions/finalize-newscast-background`

            console.log(`📡 Invocando Background Function: ${functionUrl}`)

            fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId,
                    newscastId,
                    config
                })
            }).catch(err => {
                console.error('Error invocando background function:', err)
            })

        } else {
            // Local: procesar directamente (simulando async)
            console.log(`💻 Modo local: procesando directamente`)

            const localUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:8888'
            const functionUrl = `${localUrl}/.netlify/functions/finalize-newscast-background`

            fetch(functionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jobId,
                    newscastId,
                    config
                })
            }).catch(err => {
                console.error('Error invocando función local:', err)
            })
        }

        return NextResponse.json({
            success: true,
            jobId,
            message: 'Generación de audio iniciada'
        })

    } catch (error) {
        console.error('Error en finalize-newscast-async:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        )
    }
}
