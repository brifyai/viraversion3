import { NextRequest, NextResponse } from 'next/server'

// Proxy para reproducir audio desde Google Drive
// Soluciona problemas de CORS con URLs de Drive
export async function GET(request: NextRequest) {
    try {
        const url = request.nextUrl.searchParams.get('url')

        if (!url) {
            return NextResponse.json({ error: 'URL no proporcionada' }, { status: 400 })
        }

        // Validar que sea una URL de Google Drive
        if (!url.startsWith('https://drive.google.com/')) {
            return NextResponse.json({ error: 'URL no permitida' }, { status: 403 })
        }

        // Descargar el audio
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        })

        if (!response.ok) {
            return NextResponse.json({ error: 'Error al obtener audio' }, { status: response.status })
        }

        const arrayBuffer = await response.arrayBuffer()
        const contentType = response.headers.get('content-type') || 'audio/mpeg'

        return new NextResponse(arrayBuffer, {
            headers: {
                'Content-Type': contentType,
                'Content-Length': arrayBuffer.byteLength.toString(),
                'Cache-Control': 'public, max-age=3600',
                'Accept-Ranges': 'bytes'
            }
        })
    } catch (error: any) {
        console.error('Error en proxy de audio:', error)
        return NextResponse.json({ error: 'Error interno' }, { status: 500 })
    }
}
