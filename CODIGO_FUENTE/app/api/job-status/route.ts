import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/job-status?id=<jobId>
 * Consulta el estado de un job de generación de noticiero
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const jobId = searchParams.get('id')

        if (!jobId) {
            return NextResponse.json(
                { error: 'Se requiere el parámetro id' },
                { status: 400 }
            )
        }

        const { data: job, error } = await supabaseAdmin
            .from('newscast_jobs')
            .select('*')
            .eq('id', jobId)
            .single()

        if (error || !job) {
            return NextResponse.json(
                { error: 'Job no encontrado' },
                { status: 404 }
            )
        }

        return NextResponse.json({
            id: job.id,
            status: job.status,
            progress: job.progress,
            progressMessage: job.progress_message,
            newscastId: job.newscast_id,
            error: job.error,
            startedAt: job.started_at,
            completedAt: job.completed_at,
            createdAt: job.created_at
        })

    } catch (error) {
        console.error('Error consultando job status:', error)
        return NextResponse.json(
            { error: 'Error interno del servidor' },
            { status: 500 }
        )
    }
}
