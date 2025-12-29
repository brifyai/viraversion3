// ==================================================
// VIRA - Configuración de Google Gemini AI
// ==================================================
// Configuración para humanización de texto y IA directora
// Migrado desde Chutes AI
// ==================================================

export const GEMINI_CONFIG = {
    // API Key de Gemini (Google AI Studio)
    apiKey: process.env.GEMINI_API_KEY || '',

    // Modelo a usar (gemini-2.0-flash-001 es rápido y económico)
    model: 'gemini-2.0-flash-001',

    // Endpoints
    endpoints: {
        generateContent: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent'
    },

    // Configuración de generación por defecto
    defaultGenerationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2000
    }
}

/**
 * Headers para requests a Gemini API
 */
export function getGeminiHeaders(): Record<string, string> {
    return {
        'Content-Type': 'application/json'
    }
}

/**
 * Construye el URL completo con API key
 */
export function getGeminiUrl(): string {
    return `${GEMINI_CONFIG.endpoints.generateContent}?key=${GEMINI_CONFIG.apiKey}`
}

/**
 * Construye el body para una request de generación de texto
 */
export function buildGeminiRequestBody(prompt: string, config?: Partial<typeof GEMINI_CONFIG.defaultGenerationConfig>) {
    return {
        contents: [
            {
                parts: [
                    { text: prompt }
                ]
            }
        ],
        generationConfig: {
            ...GEMINI_CONFIG.defaultGenerationConfig,
            ...config
        }
    }
}

/**
 * Parsea la respuesta de Gemini y extrae el texto
 */
export function parseGeminiResponse(data: any): string {
    if (!data || !data.candidates || !data.candidates[0]) {
        throw new Error('Respuesta inválida de Gemini API')
    }

    const text = data.candidates[0].content?.parts?.[0]?.text

    if (!text) {
        throw new Error('No se recibió texto de Gemini API')
    }

    return text
}

/**
 * Verifica que la configuración de Gemini tenga la API key
 */
export function validateGeminiConfig(): { valid: boolean; missing: string[] } {
    const missing: string[] = []

    if (!GEMINI_CONFIG.apiKey) {
        missing.push('GEMINI_API_KEY')
    }

    return {
        valid: missing.length === 0,
        missing
    }
}

export default GEMINI_CONFIG
