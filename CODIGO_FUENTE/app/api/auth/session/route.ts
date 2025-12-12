import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase-server'

/**
 * Endpoint para mantener la sesión activa durante operaciones largas
 * Usado por el keep-alive en useNewscastGeneration
 */
export async function GET() {
    try {
        const supabase = await createSupabaseServer()
        const { data: { user }, error } = await supabase.auth.getUser()

        if (error || !user) {
            return NextResponse.json({
                valid: false,
                error: 'No session'
            }, { status: 401 })
        }

        // Sesión válida - esto también refresca las cookies automáticamente
        return NextResponse.json({
            valid: true,
            email: user.email,
            timestamp: new Date().toISOString()
        })
    } catch (error) {
        console.error('[Session Keep-Alive] Error:', error)
        return NextResponse.json({
            valid: false,
            error: 'Session check failed'
        }, { status: 500 })
    }
}
