import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { getResourceOwnerId } from '@/lib/resource-owner'

const supabase = supabaseAdmin

export async function GET() {
    try {
        // Solo cargar voces clonadas del usuario/admin (no voces genéricas del sistema)
        let userVoices: any[] = []
        const currentUser = await getCurrentUser()

        if (currentUser) {
            // Obtener el ID del propietario de recursos (admin_id para USER, propio id para ADMIN)
            const resourceOwnerId = getResourceOwnerId(currentUser)

            console.log(`[Voices] User: ${currentUser.email}, Role: ${currentUser.role}`)
            console.log(`[Voices] Loading voices for resource owner: ${resourceOwnerId}`)

            const { data: audioData, error: audioError } = await supabase
                .from('biblioteca_audio')
                .select('*')
                .eq('user_id', resourceOwnerId)
                .eq('tipo', 'voz')
                .eq('is_active', true)
                .order('created_at', { ascending: false })

            if (audioError) {
                console.error('[Voices] Error loading voices:', audioError)
            }

            if (audioData) {
                console.log(`[Voices] Found ${audioData.length} cloned voices`)
                userVoices = audioData.map(audio => ({
                    id: audio.audio, // The filename (UUID) is the ID for TTS
                    name: audio.nombre,
                    language: audio.idioma || 'es',
                    type: 'cloned',
                    isUserVoice: true,
                    // Incluir voice_stats para estimación de duración
                    wpm: audio.metadata?.voice_stats?.wpm || 150,
                    tempo: audio.metadata?.voice_stats?.tempo || 4.0,
                    avg_pause_ms: audio.metadata?.voice_stats?.avg_pause_ms || 400,
                    energy_profile: audio.metadata?.voice_stats?.energy_profile || 'mixed'
                }))
            }
        }

        // Voces del sistema VoiceMaker (siempre disponibles si hay API key)
        // ✅ WPM calibrado considerando MasterSpeed +15 (valores sincronizados con tts-providers.ts)
        const voicemakerVoices = process.env.VOICEMAKER_API_KEY ? [
            {
                id: 'ai3-es-CL-Vicente',
                name: '🎙️ Vicente (VoiceMaker)',
                language: 'es-CL',
                type: 'voicemaker',
                isUserVoice: false,
                wpm: 175,  // Calibrado: voz masculina rápida + MasterSpeed +15
                tempo: 4.0,
                avg_pause_ms: 200,
                energy_profile: 'news'
            },
            {
                id: 'ai3-es-CL-Eliana',
                name: '🎙️ Eliana (VoiceMaker)',
                language: 'es-CL',
                type: 'voicemaker',
                isUserVoice: false,
                wpm: 168,  // Calibrado: voz femenina moderada + MasterSpeed +15
                tempo: 4.0,
                avg_pause_ms: 250,
                energy_profile: 'news'
            }
        ] : []

        // Combinar voces VoiceMaker + voces clonadas del usuario
        const allVoices = [...voicemakerVoices, ...userVoices]

        return NextResponse.json({ voices: allVoices })

    } catch (error) {
        console.error('Error fetching voices:', error)
        return NextResponse.json(
            { error: 'Error al obtener voces disponibles' },
            { status: 500 }
        )
    }
}
