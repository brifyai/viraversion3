/**
 * SCRIPT DE CALIBRACIÓN DE VOCES TTS
 * 
 * Genera audio con cada voz Neural2 usando un texto de prueba
 * y mide la duración real para calcular WPM precisos.
 * 
 * Uso: node scripts/calibrar-voces.mjs
 */

import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// Cargar .env.local
const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env.local') })

const VOCES_A_CALIBRAR = [
    { id: 'es-US-Neural2-A', nombre: 'Sofía', genero: 'FEMALE' },
    { id: 'es-US-Neural2-B', nombre: 'Carlos', genero: 'MALE' },
    { id: 'es-US-Neural2-C', nombre: 'Diego', genero: 'MALE' },
]

// Texto de prueba: ~100 palabras, con puntuación natural
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

// Calibración de bytes por segundo (de finalize-newscast-background.ts)
const BYTES_PER_SECOND = 7500

// WPM actuales en el código
const wpmActuales = {
    'es-US-Neural2-A': 152,
    'es-US-Neural2-B': 157,
    'es-US-Neural2-C': 166,
}

async function calibrarVoces() {
    const API_KEY = process.env.GOOGLE_CLOUD_TTS_API_KEY

    if (!API_KEY) {
        console.error('❌ Error: GOOGLE_CLOUD_TTS_API_KEY no está configurada en .env.local')
        process.exit(1)
    }

    console.log('\n🎤 === CALIBRACIÓN DE VOCES TTS ===\n')
    console.log(`📝 Texto de prueba: ${PALABRAS} palabras\n`)

    const resultados = []

    for (const voz of VOCES_A_CALIBRAR) {
        console.log(`🔊 Generando audio para ${voz.nombre} (${voz.id})...`)

        try {
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
                            speakingRate: 1.0,
                            pitch: 0.0,
                            effectsProfileId: ['medium-bluetooth-speaker-class-device'],
                        },
                    }),
                }
            )

            if (!response.ok) {
                const error = await response.text()
                console.error(`   ❌ Error API: ${response.status} - ${error.substring(0, 100)}`)
                continue
            }

            const data = await response.json()
            const audioBytes = Buffer.from(data.audioContent, 'base64').length

            // Calcular duración por tamaño
            const duracionSeg = audioBytes / BYTES_PER_SECOND
            const wpmReal = Math.round((PALABRAS / duracionSeg) * 60)

            resultados.push({
                voz: voz.id,
                nombre: voz.nombre,
                genero: voz.genero,
                bytesAudio: audioBytes,
                duracionSeg: Math.round(duracionSeg * 10) / 10,
                wpmReal,
                wpmActual: wpmActuales[voz.id] || 160,
            })

            console.log(`   ✅ ${audioBytes.toLocaleString()} bytes, ${duracionSeg.toFixed(1)}s → ${wpmReal} WPM`)
        } catch (error) {
            console.error(`   ❌ Error:`, error.message)
        }
    }

    // Mostrar resultados
    console.log('\n📊 === RESULTADOS DE CALIBRACIÓN ===\n')
    console.log('| Voz | Nombre  | Bytes   | Duración | WPM Real | WPM Actual | Diferencia |')
    console.log('|-----|---------|---------|----------|----------|------------|------------|')

    for (const r of resultados) {
        const diff = r.wpmReal - r.wpmActual
        const diffStr = diff > 0 ? `+${diff}` : `${diff}`
        console.log(
            `| ${r.voz.split('-').pop().padEnd(3)} | ${r.nombre.padEnd(7)} | ${r.bytesAudio.toLocaleString().padStart(7)} | ${(r.duracionSeg + 's').padStart(8)} | ${r.wpmReal.toString().padStart(8)} | ${r.wpmActual.toString().padStart(10)} | ${diffStr.padStart(10)} |`
        )
    }

    // Código sugerido
    console.log('\n📝 === ACTUALIZACIÓN SUGERIDA PARA tts-providers.ts ===\n')
    for (const r of resultados) {
        console.log(`'${r.voz}': { ..., wpm: ${r.wpmReal} },  // CALIBRADO ${new Date().toISOString().split('T')[0]}`)
    }

    console.log('\n✅ Calibración completada\n')
}

calibrarVoces().catch(console.error)
