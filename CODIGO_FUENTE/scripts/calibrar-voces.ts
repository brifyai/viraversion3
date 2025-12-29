/**
 * SCRIPT DE CALIBRACIÓN DE VOCES TTS
 * 
 * Genera audio con cada voz Neural2 usando un texto de prueba
 * y mide la duración real para calcular WPM precisos.
 * 
 * Uso: npx ts-node scripts/calibrar-voces.ts
 */

// Cargar variables de entorno desde .env.local
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.resolve(__dirname, '../.env.local') })

const VOCES_A_CALIBRAR = [
    { id: 'es-US-Neural2-A', nombre: 'Sofía', genero: 'FEMALE' },
    { id: 'es-US-Neural2-B', nombre: 'Carlos', genero: 'MALE' },
    { id: 'es-US-Neural2-C', nombre: 'Diego', genero: 'MALE' },
]

// Texto de prueba: exactamente 100 palabras, con puntuación natural
const TEXTO_PRUEBA = `
La economía chilena mostró signos de recuperación durante el último trimestre del año. 
Según el Banco Central, el producto interno bruto creció un dos coma cinco por ciento 
respecto al mismo período anterior. Los analistas destacan que el sector minero fue 
el principal motor de este crecimiento, impulsado por los altos precios del cobre en 
los mercados internacionales. Sin embargo, la inflación sigue siendo un desafío para 
las autoridades económicas. El ministro de Hacienda anunció nuevas medidas para 
controlar los precios y proteger el poder adquisitivo de las familias chilenas. 
La tasa de desempleo se mantiene estable en un siete por ciento a nivel nacional.
`.trim()

// Contar palabras reales
const PALABRAS = TEXTO_PRUEBA.split(/\s+/).length
console.log(`📝 Texto de prueba: ${PALABRAS} palabras`)

// ============================================
// FUNCIÓN PRINCIPAL DE CALIBRACIÓN
// ============================================
async function calibrarVoces() {
    const API_KEY = process.env.GOOGLE_CLOUD_TTS_API_KEY

    if (!API_KEY) {
        console.error('❌ Error: GOOGLE_CLOUD_TTS_API_KEY no está configurada')
        console.log('Ejecuta: $env:GOOGLE_CLOUD_TTS_API_KEY = "tu-api-key"')
        process.exit(1)
    }

    console.log('\n🎤 === CALIBRACIÓN DE VOCES TTS ===\n')
    console.log(`📝 Texto de prueba: ${PALABRAS} palabras\n`)

    // Resultados
    const resultados: {
        voz: string
        nombre: string
        genero: string
        bytesAudio: number
        duracionSeg: number
        wpmReal: number
        wpmActual: number
    }[] = []

    // Calibración de bytes por segundo (de finalize-newscast-background.ts)
    const BYTES_PER_SECOND = 7500

    for (const voz of VOCES_A_CALIBRAR) {
        console.log(`🔊 Generando audio para ${voz.nombre} (${voz.id})...`)

        try {
            // Llamar API de Google Cloud TTS
            const response = await fetch(
                `https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        input: { text: TEXTO_PRUEBA },
                        voice: {
                            languageCode: 'es-US',
                            name: voz.id,
                            ssmlGender: voz.genero,
                        },
                        audioConfig: {
                            audioEncoding: 'MP3',
                            sampleRateHertz: 24000,
                            speakingRate: 1.0, // Velocidad normal
                            pitch: 0.0,       // Tono normal
                            effectsProfileId: ['medium-bluetooth-speaker-class-device'],
                        },
                    }),
                }
            )

            if (!response.ok) {
                console.error(`   ❌ Error API: ${response.status}`)
                continue
            }

            const data = await response.json()
            const audioBase64 = data.audioContent
            const audioBytes = Buffer.from(audioBase64, 'base64').length

            // Calcular duración real por tamaño
            const duracionSeg = audioBytes / BYTES_PER_SECOND

            // Calcular WPM real
            const wpmReal = Math.round((PALABRAS / duracionSeg) * 60)

            // WPM actual configurado (de tts-providers.ts)
            const wpmActuales: Record<string, number> = {
                'es-US-Neural2-A': 152, // Sofía
                'es-US-Neural2-B': 157, // Carlos
                'es-US-Neural2-C': 166, // Diego
            }

            resultados.push({
                voz: voz.id,
                nombre: voz.nombre,
                genero: voz.genero,
                bytesAudio: audioBytes,
                duracionSeg: Math.round(duracionSeg * 10) / 10,
                wpmReal,
                wpmActual: wpmActuales[voz.id] || 160,
            })

            console.log(`   ✅ ${audioBytes} bytes, ${duracionSeg.toFixed(1)}s → ${wpmReal} WPM`)
        } catch (error) {
            console.error(`   ❌ Error generando audio:`, error)
        }
    }

    // ============================================
    // MOSTRAR RESULTADOS
    // ============================================
    console.log('\n📊 === RESULTADOS DE CALIBRACIÓN ===\n')
    console.log('| Voz | Nombre | Bytes | Duración | WPM Real | WPM Actual | Diferencia |')
    console.log('|-----|--------|-------|----------|----------|------------|------------|')

    for (const r of resultados) {
        const diff = r.wpmReal - r.wpmActual
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`
        console.log(
            `| ${r.voz.split('-').pop()} | ${r.nombre.padEnd(7)} | ${r.bytesAudio.toLocaleString().padStart(6)} | ${r.duracionSeg.toFixed(1).padStart(6)}s | ${r.wpmReal.toString().padStart(8)} | ${r.wpmActual.toString().padStart(10)} | ${diffStr.padStart(10)} |`
        )
    }

    // ============================================
    // CÓDIGO SUGERIDO PARA ACTUALIZAR
    // ============================================
    console.log('\n📝 === CÓDIGO SUGERIDO PARA tts-providers.ts ===\n')
    console.log('export const GOOGLE_CLOUD_VOICES = {')
    for (const r of resultados) {
        console.log(`  '${r.voz}': {`)
        console.log(`    id: '${r.voz}',`)
        console.log(`    name: '${r.nombre} (${r.genero === 'FEMALE' ? 'Mujer' : 'Hombre'})',`)
        console.log(`    languageCode: 'es-US',`)
        console.log(`    ssmlGender: '${r.genero}',`)
        console.log(`    wpm: ${r.wpmReal},  // CALIBRADO ${new Date().toISOString().split('T')[0]}`)
        console.log(`  },`)
    }
    console.log('};')

    console.log('\n✅ Calibración completada\n')
}

// Ejecutar
calibrarVoces().catch(console.error)
