/**
 * CONFIGURACIÓN DE CHUTES AI PARA NETLIFY FUNCTIONS
 * 
 * Versión compatible con Netlify Functions (sin 'server-only')
 * Usado por generate-newscast-background.ts
 */

// Configuración de Chutes AI desde variables de entorno
export const CHUTES_CONFIG = {
    apiKey: process.env.CHUTES_API_KEY || '',
    endpoints: {
        chatCompletions: process.env.CHUTES_CHAT_COMPLETIONS_URL || 'https://llm.chutes.ai/v1/chat/completions',
        textToSpeech: process.env.CHUTES_TTS_URL || 'https://chutes-kokoro.chutes.ai/speak'
    },
    model: process.env.CHUTES_MODEL || 'deepseek-ai/DeepSeek-V3-0324',
    voice: process.env.CHUTES_VOICE || 'af_heart',
    defaultOptions: {
        chatCompletions: {
            model: process.env.CHUTES_MODEL || 'deepseek-ai/DeepSeek-V3-0324',
            stream: false,
            max_tokens: 1024,
            temperature: 0.7
        }
    }
}

export const getChutesHeaders = (contentType: string = 'application/json') => ({
    'Authorization': `Bearer ${CHUTES_CONFIG.apiKey}`,
    'Content-Type': contentType
})

export default CHUTES_CONFIG
