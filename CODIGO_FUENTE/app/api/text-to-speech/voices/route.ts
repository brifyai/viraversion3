export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

export async function GET() {
    try {
        // ✅ Voces Google Cloud TTS Neural2 para es-US (6 voces disponibles)
        // WPM = Palabras Por Minuto BASE (antes de ajuste de velocidad)
        const googleCloudVoices = process.env.GOOGLE_CLOUD_TTS_API_KEY ? [
            {
                id: 'es-US-Neural2-B',
                name: '🎙️ Carlos (Hombre - Profunda)',
                language: 'es-US',
                type: 'google-cloud',
                isUserVoice: false,
                wpm: 157,  // AJUSTADO con pausas SSML (288s/306s)
                ssmlGender: 'MALE',
                description: 'Voz masculina profunda, ideal para noticias serias'
            },
            {
                id: 'es-US-Neural2-A',
                name: '🎙️ Sofía (Mujer - Suave)',
                language: 'es-US',
                type: 'google-cloud',
                isUserVoice: false,
                wpm: 152,  // AJUSTADO con pausas SSML
                ssmlGender: 'FEMALE',
                description: 'Voz femenina suave, ideal para noticias tranquilas'
            },
            {
                id: 'es-US-Neural2-C',
                name: '🎙️ Diego (Hombre - Clara)',
                language: 'es-US',
                type: 'google-cloud',
                isUserVoice: false,
                wpm: 166,  // AJUSTADO con pausas SSML
                ssmlGender: 'MALE',
                description: 'Voz masculina clara y articulada'
            }
        ] : []

        return NextResponse.json({ voices: googleCloudVoices })

    } catch (error) {
        console.error('Error fetching voices:', error)
        return NextResponse.json(
            { error: 'Error al obtener voces disponibles' },
            { status: 500 }
        )
    }
}
