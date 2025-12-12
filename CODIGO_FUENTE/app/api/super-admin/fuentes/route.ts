import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { supabaseAdmin } from '@/lib/supabase-server'

// GET: Obtener todas las fuentes
export async function GET() {
    const user = await getCurrentUser()
    if (!user || user.role !== 'super_admin') {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { data, error } = await supabaseAdmin
        .from('fuentes_final')
        .select('*')
        .order('region')
        .order('nombre_fuente')

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

// POST: Crear nueva fuente
export async function POST(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== 'super_admin') {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { region, nombre_fuente, url, rss_url, tipo_scraping, selectores_css } = body

    if (!region || !nombre_fuente || !url) {
        return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('fuentes_final')
        .insert({
            region,
            nombre_fuente,
            url,
            rss_url: rss_url || null,
            tipo_scraping: tipo_scraping || 'web',
            selectores_css: selectores_css || {},
            esta_activo: true
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

// PUT: Actualizar fuente existente
export async function PUT(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== 'super_admin') {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
        return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from('fuentes_final')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

// DELETE: Eliminar fuente
export async function DELETE(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== 'super_admin') {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
        return NextResponse.json({ error: 'ID requerido' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
        .from('fuentes_final')
        .delete()
        .eq('id', id)

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
