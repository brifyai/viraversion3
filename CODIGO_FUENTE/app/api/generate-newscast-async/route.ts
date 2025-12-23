import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'
import { v4 as uuidv4 } from 'uuid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Usar cliente admin para operaciones internas
const supabase = supabaseAdmin

/**
 * POST /api/generate-newscast-async
 * 
 * Dispatcher que:
 * 1. Crea un job en newscast_jobs
 * 2. Invoca la Background Function de Netlify
 * 3. Retorna inmediatamente el jobId
 * 
 * El frontend debe hacer polling a /api/job-status para ver el progreso
 */
export async function POST(request: NextRequest) {
    try {
        const config = await request.json()

        // Autenticación (igual que generate-newscast)
        const session = await getSupabaseSession()
        let userId = session?.user?.id
        let authMethod = 'session'

        // Fallback: si sesión expiró pero viene userId en body
        if (!userId && config.userId) {
            console.log('⚠️ Sesión expirada, intentando fallback con userId del body...')

            const { data: userCheck, error: userError } = await supabase
                .from('users')
                .select('id, email')
                .eq('id', config.userId)
                .single()

            if (userCheck && !userError) {
                userId = config.userId
                authMethod = 'fallback'
                console.log(`✅ Fallback exitoso: Usuario verificado ${userCheck.email}`)
            }
        }

        if (!userId) {
            return NextResponse.json(
                { error: 'No autenticado' },
                { status: 401 }
            )
        }

        console.log(`🔐 Autenticación exitosa via ${authMethod}: ${userId}`)

        const jobId = uuidv4()

        console.log(`🚀 Creando job async: ${jobId}`)

        // 1. Crear job en la base de datos
        const { error: insertError } = await supabase
            .from('newscast_jobs')
            .insert({
                id: jobId,
                user_id: userId,
                status: 'pending',
                progress: 0,
                progress_message: 'Job creado, esperando procesamiento...',
                config: config
            })

        if (insertError) {
            console.error('Error creando job:', insertError)
            return NextResponse.json(
                { error: 'Error creando job' },
                { status: 500 }
            )
        }

        // 2. Detectar si estamos en Netlify o netlify dev
        // - netlify dev: URL suele ser localhost:8888 y NETLIFY=true o CONTEXT existe
        // - Production: URL contiene netlify.app
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
        const isNetlifyDev = appUrl.includes('localhost:8888') || process.env.CONTEXT !== undefined
        const isNetlifyProd = appUrl.includes('netlify.app') || appUrl.includes('.app')
        const isNetlify = isNetlifyDev || isNetlifyProd || process.env.NETLIFY === 'true'

        if (isNetlify) {
            // Producción: invocar la Background Function de Netlify
            const siteUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.URL || process.env.DEPLOY_PRIME_URL || '').replace(/\/$/, '')
            const functionUrl = `${siteUrl}/.netlify/functions/generate-newscast-background`

            console.log(`📡 Invocando Background Function: ${functionUrl}`)

            // Invocar de forma asíncrona (fire-and-forget)
            fetch(functionUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    jobId,
                    config: {
                        ...config,
                        userId: userId
                    }
                })
            }).catch(err => {
                console.error('Error invocando background function:', err)
                // No esperamos la respuesta - es una background function
            })

        } else {
            // Desarrollo local: procesar directamente en el servidor
            // Esto permite probar sin Netlify
            console.log('⚙️ Modo desarrollo: procesando en servidor local')

            // Actualizar job a processing e invocar la API normal
            await supabase
                .from('newscast_jobs')
                .update({
                    status: 'processing',
                    progress: 5,
                    progress_message: 'Iniciando generación (modo desarrollo)...',
                    started_at: new Date().toISOString()
                })
                .eq('id', jobId)

            // En desarrollo, llamar al endpoint normal y actualizar el job
            // Esto es un workaround para desarrollo local
            processInBackground(jobId, config, userId, supabase)
        }

        // 3. Retornar el jobId inmediatamente
        return NextResponse.json({
            success: true,
            jobId,
            message: 'Job creado. Usa /api/job-status?id=' + jobId + ' para consultar el progreso.'
        })

    } catch (error) {
        console.error('Error en generate-newscast-async:', error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Error interno' },
            { status: 500 }
        )
    }
}

/**
 * Procesar en background (solo para desarrollo local)
 * En producción, esto se hace en la Background Function de Netlify
 */
async function processInBackground(jobId: string, config: any, userId: string, supabase: any) {
    try {
        // Llamar al endpoint de generación normal
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

        const response = await fetch(`${baseUrl}/api/generate-newscast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ...config,
                userId
            })
        })

        if (response.ok) {
            const data = await response.json()

            // Actualizar job como completado
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
        } else {
            const errorText = await response.text()
            throw new Error(`Error ${response.status}: ${errorText}`)
        }

    } catch (error) {
        console.error(`❌ Job ${jobId} falló:`, error)

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
}
