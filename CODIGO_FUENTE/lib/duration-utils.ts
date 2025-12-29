/**
 * SSML Duration Estimation Utilities
 * 
 * Funciones para estimar duración de audio TTS considerando pausas SSML.
 * Usado por generate-newscast-background.ts y tts-providers.ts
 */

/**
 * Estima duración de audio considerando pausas SSML
 * Basado en los tiempos reales usados en textToSSML():
 * - Oraciones (. ): 600ms
 * - Preguntas/Exclamaciones (? !): 700ms
 * - Comas: 250ms
 * 
 * @param texto - Texto a sintetizar
 * @param wpm - Palabras por minuto de la voz
 * @returns Duración estimada en segundos
 */
export function estimarDuracionConSSML(texto: string, wpm: number): number {
    // 1. Duración base por palabras
    const palabras = texto.trim().split(/\s+/).length;
    const duracionBaseSeg = (palabras / wpm) * 60;

    // 2. Contar puntuación para estimar pausas SSML
    const oracionesNormales = (texto.match(/\./g) || []).length;
    const preguntasExclamaciones = (texto.match(/[?!]/g) || []).length;
    const comas = (texto.match(/,/g) || []).length;

    // 3. Calcular pausas SSML (valores exactos del código textToSSML)
    const pausasOraciones = oracionesNormales * 0.6;        // 600ms por oración
    const pausasPregExcl = preguntasExclamaciones * 0.7;    // 700ms por ?!
    const pausasComas = comas * 0.25;                       // 250ms por coma

    // 4. Total + 3% margen de seguridad
    const duracionTotal = (duracionBaseSeg + pausasOraciones + pausasPregExcl + pausasComas) * 1.03;

    return Math.round(duracionTotal);
}

// TIMING CONSTANTS - Para cálculos de duración (exportado para compatibilidad)
export const TIMING_CONSTANTS = {
    SILENCE_BETWEEN_NEWS: 1.5,     // Segundos de silencio entre noticias
    INTRO_DURATION: 12,            // Duración real medida (incluye pausas TTS)
    OUTRO_DURATION: 6,             // Duración estimada del outro (~15 palabras)
    AD_DURATION: 25,               // Duración promedio de publicidad
    CORTINA_DURATION: 5,           // Duración de cortina musical
    BUFFER_PERCENTAGE: 0.05        // 5% de buffer para variaciones
};

// WPM calibrados de las 3 voces en producción (sincronizado con tts-providers.ts)
export const VOICE_WPM = {
    'es-US-Neural2-A': 152,  // Sofía
    'es-US-Neural2-B': 157,  // Carlos
    'es-US-Neural2-C': 166   // Diego
};
