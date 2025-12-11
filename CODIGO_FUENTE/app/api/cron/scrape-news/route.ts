import { NextRequest, NextResponse } from 'next/server'
import { scrapeSingleSource, type FuenteFinal } from '@/lib/scraping-service'
import { getSupabaseSession, supabaseAdmin } from '@/lib/supabase-server'

const supabase = supabaseAdmin

export async function GET(request: NextRequest) {
    try {
        // 1. Verificar autenticación (CRON_SECRET o Sesión de Admin)
        const authHeader = request.headers.get('authorization')
        const cronSecret = process.env.CRON_SECRET
        let isAuthorized = false

        // A) Verificar CRON_SECRET (para Vercel Cron)
        if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
            isAuthorized = true
        }

        // B) Verificar Sesión (para trigger manual desde Admin)
        if (!isAuthorized) {
            const session = await getSupabaseSession()
            console.log('🔍 [scrape-news] Session check:', {
                hasSession: !!session,
                userEmail: session?.user?.email,
                userRole: session?.user?.role
            })
            if (session?.user?.role === 'super_admin') {
                isAuthorized = true
                console.log('👤 Scraping iniciado manualmente por super_admin:', session.user.email)
            }
        }

        if (!isAuthorized) {
            console.error('❌ Unauthorized cron request - No valid session or CRON_SECRET')
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        console.log('🕐 Cron de scraping ejecutado:', new Date().toISOString())
        const startTime = Date.now()

        // 1. Obtener regiones activas
        const { data: regionsData, error: regionsError } = await supabase
            .from('configuraciones_regiones')
            .select('region')
            .eq('esta_activo', true)

        if (regionsError) {
            throw new Error(`Error obteniendo regiones: ${regionsError.message}`)
        }

        const regions = regionsData || []
        console.log(`📍 Procesando ${regions.length} regiones`)

        const results = []
        let totalNewsFound = 0
        let totalNewNews = 0
        let totalCreditsUsed = 0
        let totalCostUsd = 0

        // 2. Para cada región, obtener fuentes que tienen suscriptores activos
        for (const { region } of regions) {
            console.log(`\n🌍 Procesando región: ${region}`)

            // Obtener IDs de fuentes que tienen al menos un suscriptor activo
            const { data: suscribedFuentes, error: subError } = await supabase
                .from('user_fuentes_suscripciones')
                .select('fuente_id')
                .eq('esta_activo', true)

            if (subError) {
                console.error(`❌ Error obteniendo suscripciones:`, subError)
                continue
            }

            const fuenteIdsConSuscriptores = [...new Set(suscribedFuentes?.map(s => s.fuente_id) || [])]

            if (fuenteIdsConSuscriptores.length === 0) {
                console.log(`⚠️ No hay fuentes con suscriptores activos`)
                continue
            }

            // Obtener fuentes activas de esta región que tienen suscriptores
            const { data: sources, error: sourcesError } = await supabase
                .from('fuentes_final')
                .select('*')
                .eq('region', region)
                .eq('esta_activo', true)
                .in('id', fuenteIdsConSuscriptores)
                .or(`proxima_ejecucion.is.null,proxima_ejecucion.lte.${new Date().toISOString()}`)

            if (sourcesError) {
                console.error(`❌ Error obteniendo fuentes de ${region}:`, sourcesError)
                continue
            }

            if (!sources || sources.length === 0) {
                console.log(`⚠️ No hay fuentes pendientes con suscriptores en ${region}`)
                continue
            }

            console.log(`📚 ${sources.length} fuentes con suscriptores en ${region}`)

            // 3. Procesar fuentes en paralelo (máximo 5 simultáneas)
            const BATCH_SIZE = 5
            for (let i = 0; i < sources.length; i += BATCH_SIZE) {
                const batch = sources.slice(i, i + BATCH_SIZE)

                const batchResults = await Promise.allSettled(
                    batch.map(source => scrapeSingleSource(source as FuenteFinal))
                )

                // Procesar resultados del batch
                for (const result of batchResults) {
                    if (result.status === 'fulfilled') {
                        const scrapingResult = result.value
                        totalNewsFound += scrapingResult.noticias_encontradas
                        totalNewNews += scrapingResult.noticias_nuevas
                        totalCreditsUsed += scrapingResult.credits_used
                        totalCostUsd += scrapingResult.cost_usd

                        console.log(
                            `${scrapingResult.success ? '✅' : '❌'} ${scrapingResult.region} - ` +
                            `${scrapingResult.noticias_nuevas} nuevas (${scrapingResult.metodo}) ` +
                            `[${scrapingResult.credits_used} créditos, $${scrapingResult.cost_usd.toFixed(6)}]`
                        )
                    } else {
                        console.error('❌ Error en scraping:', result.reason)
                    }
                }

                // Delay entre batches para no sobrecargar
                if (i + BATCH_SIZE < sources.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000))
                }
            }

            results.push({
                region,
                sources_processed: sources.length,
                news_found: totalNewsFound,
                new_news: totalNewNews
            })
        }

        const executionTime = Date.now() - startTime

        // 4. Registrar ejecución en logs_procesamiento
        await supabase.from('logs_procesamiento').insert({
            tipo_proceso: 'scraping',
            estado: 'completado',
            inicio: new Date(startTime).toISOString(),
            fin: new Date().toISOString(),
            duracion_segundos: Math.floor(executionTime / 1000),
            metadata: {
                regions_processed: regions.length,
                total_news_found: totalNewsFound,
                total_new_news: totalNewNews,
                total_credits_used: totalCreditsUsed,
                total_cost_usd: totalCostUsd,
                results
            }
        })

        console.log('\n📊 Resumen de ejecución:')
        console.log(`   Regiones procesadas: ${regions.length}`)
        console.log(`   Noticias encontradas: ${totalNewsFound}`)
        console.log(`   Noticias nuevas: ${totalNewNews}`)
        console.log(`   Créditos usados: ${totalCreditsUsed}`)
        console.log(`   Costo total: $${totalCostUsd.toFixed(4)} USD`)
        console.log(`   Tiempo de ejecución: ${(executionTime / 1000).toFixed(2)}s`)

        return NextResponse.json({
            success: true,
            message: 'Scraping completado exitosamente',
            timestamp: new Date().toISOString(),
            execution_time_ms: executionTime,
            stats: {
                regions_processed: regions.length,
                total_news_found: totalNewsFound,
                total_new_news: totalNewNews,
                total_credits_used: totalCreditsUsed,
                total_cost_usd: totalCostUsd
            },
            details: results
        })

    } catch (error) {
        console.error('❌ Error en cron de scraping:', error)

        // Registrar error
        await supabase.from('logs_procesamiento').insert({
            tipo_proceso: 'scraping',
            estado: 'fallido',
            inicio: new Date().toISOString(),
            fin: new Date().toISOString(),
            mensaje_error: error instanceof Error ? error.message : 'Error desconocido',
            metadata: {
                error_details: error instanceof Error ? error.stack : String(error)
            }
        })

        return NextResponse.json(
            {
                success: false,
                error: 'Error interno del servidor',
                details: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        )
    }
}
