/**
 * CONFIGURACIÓN DE GEMINI AI PARA NETLIFY FUNCTIONS
 * 
 * Versión compatible con Netlify Functions
 * Usado por generate-newscast-background.ts
 */

// Configuración de Gemini AI
export const GEMINI_CONFIG = {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: 'gemini-2.0-flash-001',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models'
}

/**
 * Helper function to call Gemini API
 * @param prompt - The prompt to send to Gemini
 * @param maxTokens - Maximum tokens in response
 * @param temperature - Temperature for generation (0-1)
 * @returns The generated text or null if failed
 */
export async function callGemini(
    prompt: string,
    maxTokens: number = 1000,
    temperature: number = 0.5
): Promise<string | null> {
    if (!GEMINI_CONFIG.apiKey) {
        console.warn('⚠️ GEMINI_API_KEY no configurada')
        return null
    }

    try {
        const url = `${GEMINI_CONFIG.baseUrl}/${GEMINI_CONFIG.model}:generateContent?key=${GEMINI_CONFIG.apiKey}`

        // LOG DEBUG (Solo para diagnósticos, borrar después)
        console.log(`📡 Llamando a Gemini: ${GEMINI_CONFIG.model}`)
        console.log(`🔗 URL: ${url.replace(GEMINI_CONFIG.apiKey, 'HIDDEN_KEY')}`)

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature,
                    maxOutputTokens: maxTokens,
                    topK: 40,
                    topP: 0.95
                }
            })
        })

        if (response.status === 429) {
            console.warn('⚠️ Gemini rate limit (429)')
            return null
        }

        if (!response.ok) {
            const errorText = await response.text()
            console.warn(`⚠️ Gemini error: ${response.status} - ${response.statusText}`)
            console.warn(`📝 Detalles del error: ${errorText}`)
            return null
        }

        const data = await response.json()
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
        return text || null
    } catch (error) {
        console.error('❌ Gemini API error:', error)
        return null
    }
}

export default GEMINI_CONFIG
