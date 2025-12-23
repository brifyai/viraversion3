import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/scraping/job-status?id=<jobId>
 * 
 * Consulta el estado de un job de scraping asíncrono
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const jobId = searchParams.get('id')

        if (!jobId) {
            return NextResponse.json({ error: 'ID de job requerido' }, { status: 400 })
        }

        const { data: job, error } = await supabaseAdmin
            .from('scraping_jobs')
            .select('*')
            .eq('id', jobId)
            .single()

        if (error || !job) {
            return NextResponse.json({ error: 'Job no encontrado' }, { status: 404 })
        }

        return NextResponse.json({
            id: job.id,
            status: job.status,
            progress: job.progress,
            total: job.total,
            noticias_procesadas: job.noticias_procesadas,
            noticias_fallidas: job.noticias_fallidas,
            result: job.status === 'completed' ? job.result : undefined,
            error: job.error
        })

    } catch (error) {
        console.error('Error consultando job:', error)
        return NextResponse.json(
            { error: 'Error interno' },
            { status: 500 }
        )
    }
}
