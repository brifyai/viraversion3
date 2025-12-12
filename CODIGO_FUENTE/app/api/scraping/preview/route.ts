import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { supabaseAdmin } from '@/lib/supabase-server'
import { getResourceOwnerId } from '@/lib/resource-owner'

// Constantes de ScrapingBee
const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY
const SCRAPINGBEE_BASE_URL = 'https://app.scrapingbee.com/api/v1/'

interface NewsPreview {
    id: string
    titulo: string
    bajada: string
    url: string
    categoria: string
    fuente: string
    fuente_id: string
    imagen_url?: string
}

// Función para categorizar noticias automáticamente
function categorizarNoticia(titulo: string, bajada: string = ''): string {
    const texto = `${titulo} ${bajada}`.toLowerCase()

    // Orden de prioridad: específico a genérico
    const categorias: { [key: string]: string[] } = {
        // Regionales primero (más específico) - incluye regiones y ciudades de Chile
        'Regionales': [
            'región', 'regional', 'provincial', 'comunal', 'municipio', 'alcalde', 'gobernador', 'local',
            'ñuble', 'chillán', 'concepción', 'biobío', 'bio-bio', 'talca', 'maule', 'valparaíso',
            'viña del mar', 'antofagasta', 'temuco', 'araucanía', 'puerto montt', 'los lagos',
            'coquimbo', 'la serena', 'rancagua', 'o\'higgins', 'arica', 'iquique', 'punta arenas',
            'magallanes', 'aysén', 'los ríos', 'valdivia', 'osorno', 'atacama', 'copiapó'
        ],
        'Deportes': [
            'fútbol', 'futbol', 'gol', 'partido', 'estadio', 'selección', 'colo colo', 'colo-colo',
            'universidad de chile', 'universidad católica', 'liga', 'copa', 'deportes', 'jugador',
            'técnico', 'entrenador', 'campeonato', 'atleta', 'olímpico', 'mundial', 'champions',
            'libertadores', 'sudamericana', 'tenis', 'nadal', 'arturo vidal', 'alexis sánchez'
        ],
        'Política': [
            'gobierno', 'presidente', 'ministro', 'congreso', 'senado', 'diputado', 'elecciones',
            'votación', 'político', 'ley', 'decreto', 'boric', 'piñera', 'bachelet', 'carabineros',
            'pdi', 'fiscalía', 'fiscal', 'tribunal', 'suprema', 'constitucional', 'parlamentario',
            'izquierda', 'derecha', 'oposición', 'oficialismo', 'reforma', 'proyecto de ley'
        ],
        'Economía': [
            'dólar', 'economía', 'banco', 'imacec', 'inflación', 'mercado', 'bolsa', 'inversión',
            'finanzas', 'empresas', 'comercio', 'pib', 'cobre', 'minería', 'exportaciones',
            'importaciones', 'afp', 'pensiones', 'sueldo', 'empleo', 'desempleo', 'precio',
            'uf', 'ipsa', 'sii', 'impuestos', 'bce', 'banco central', 'recesión', 'crecimiento'
        ],
        'Mundo': [
            'internacional', 'eeuu', 'estados unidos', 'china', 'rusia', 'ucrania', 'europa',
            'brasil', 'argentina', 'perú', 'bolivia', 'extranjero', 'trump', 'biden', 'putin',
            'onu', 'otan', 'unión europea', 'medio oriente', 'israel', 'palestina', 'gaza',
            'venezuela', 'maduro', 'guerra', 'conflicto internacional'
        ],
        'Tecnología': [
            'tecnología', 'apple', 'google', 'microsoft', 'inteligencia artificial', 'ia', 'openai',
            'chatgpt', 'smartphone', 'app', 'digital', 'internet', 'ciberseguridad', 'bitcoin',
            'criptomonedas', 'elon musk', 'tesla', 'meta', 'facebook', 'starlink', 'innovación',
            'startup', 'software', 'datos', 'privacidad digital'
        ],
        'Tendencias': [
            'viral', 'redes sociales', 'instagram', 'tiktok', 'twitter', 'x.com', 'farándula',
            'espectáculo', 'celebridad', 'influencer', 'youtuber', 'streaming', 'netflix',
            'trending', 'meme', 'cultura pop'
        ],
        // Nacionales al final (más genérico, actúa como fallback)
        'Nacionales': [
            'chile', 'chileno', 'chilena', 'santiago', 'nacional', 'país', 'la moneda',
            'metro de santiago', 'transantiago', 'red metropolitana'
        ]
    }

    for (const [categoria, keywords] of Object.entries(categorias)) {
        if (keywords.some(keyword => texto.includes(keyword))) {
            return categoria
        }
    }

    return 'Nacionales' // Default
}

// Scrapea la página principal de una fuente con ScrapingBee
async function scanSourceHomepage(source: { id: string, url: string, nombre_fuente: string }): Promise<NewsPreview[]> {
    if (!SCRAPINGBEE_API_KEY) {
        console.error('❌ SCRAPINGBEE_API_KEY no configurada')
        return []
    }

    try {
        console.log(`🔍 Escaneando: ${source.nombre_fuente} - ${source.url}`)

        const params = new URLSearchParams({
            api_key: SCRAPINGBEE_API_KEY,
            url: source.url,
            render_js: 'true',
            premium_proxy: 'true',
            country_code: 'cl'
        })

        const response = await fetch(`${SCRAPINGBEE_BASE_URL}?${params.toString()}`)

        if (!response.ok) {
            console.error(`❌ Error ScrapingBee: ${response.status}`)
            return []
        }

        const html = await response.text()

        // Parsear HTML para extraer noticias
        const noticias = parseNewsFromHTML(html, source)
        console.log(`✅ Encontradas ${noticias.length} noticias en ${source.nombre_fuente}`)

        return noticias

    } catch (error) {
        console.error(`❌ Error escaneando ${source.nombre_fuente}:`, error)
        return []
    }
}

// Parser genérico de noticias desde HTML
function parseNewsFromHTML(html: string, source: { id: string, url: string, nombre_fuente: string }): NewsPreview[] {
    const noticias: NewsPreview[] = []

    // Usar regex para extraer noticias (compatible con servidor sin DOM)
    // Patrón para encontrar artículos/links de noticias

    // Buscar patrones comunes de titulares
    const patterns = [
        // Patrón 1: <h2><a href="URL">TITULO</a></h2>
        /<h[1-3][^>]*>\s*<a[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi,
        // Patrón 2: <a href="URL" class="...title...">TITULO</a>
        /<a[^>]*href=["']([^"']+)["'][^>]*class=["'][^"']*(?:title|headline|titular)[^"']*["'][^>]*>([^<]+)<\/a>/gi,
        // Patrón 3: <article><a href="URL">...<h2>TITULO</h2></a></article>
        /<article[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<h[1-3][^>]*>([^<]+)<\/h[1-3]>/gi,
    ]

    const seenUrls = new Set<string>()
    const baseUrl = new URL(source.url).origin

    for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(html)) !== null) {
            let [, url, titulo] = match

            // Normalizar URL
            if (url.startsWith('/')) {
                url = baseUrl + url
            }

            // Filtrar URLs duplicadas y no-noticias
            if (seenUrls.has(url)) continue
            if (!url.includes('http')) continue
            if (url.includes('#') || url.includes('javascript:')) continue
            if (titulo.length < 20 || titulo.length > 300) continue

            // Limpiar título
            titulo = titulo.trim().replace(/\s+/g, ' ')

            seenUrls.add(url)

            const categoria = categorizarNoticia(titulo)

            noticias.push({
                id: `preview-${Date.now()}-${noticias.length}`,
                titulo,
                bajada: '', // Se obtiene en scraping profundo
                url,
                categoria,
                fuente: source.nombre_fuente,
                fuente_id: source.id
            })

            if (noticias.length >= 50) break // Límite por fuente
        }
        if (noticias.length >= 50) break
    }

    return noticias
}

// Helper para obtener fuentes del usuario
async function getUserSources(resourceOwnerId: string): Promise<{ id: string, url: string, nombre_fuente: string, region: string }[]> {
    try {
        const { data: suscripciones, error: subError } = await supabaseAdmin
            .from('user_fuentes_suscripciones')
            .select(`
                id,
                categoria,
                fuente:fuentes_final (
                    id,
                    url,
                    nombre_fuente,
                    region,
                    esta_activo
                )
            `)
            .eq('user_id', resourceOwnerId)
            .eq('esta_activo', true)

        if (!subError && suscripciones && suscripciones.length > 0) {
            return suscripciones
                .filter((s: any) => s.fuente?.esta_activo)
                .map((s: any) => ({
                    id: s.fuente.id,
                    url: s.fuente.url,
                    nombre_fuente: s.fuente.nombre_fuente,
                    region: s.fuente.region
                }))
        }
    } catch (subError) {
        console.log('Tabla user_fuentes_suscripciones no disponible')
    }

    // Fallback: usar fuentes_final directamente
    const { data: fuentesData } = await supabaseAdmin
        .from('fuentes_final')
        .select('id, url, nombre_fuente, region')
        .eq('esta_activo', true)
        .limit(20)

    return fuentesData || []
}

export async function GET(request: NextRequest) {
    try {
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const resourceOwnerId = getResourceOwnerId(user)
        const fuentes = await getUserSources(resourceOwnerId)

        return NextResponse.json({
            success: true,
            fuentes
        })
    } catch (error) {
        console.error('Error en GET sources:', error)
        return NextResponse.json({ error: 'Error obteniendo fuentes' }, { status: 500 })
    }
}

export async function POST(request: NextRequest) {
    try {
        // Autenticar usuario usando getCurrentUser (funciona con cookies)
        const user = await getCurrentUser()
        if (!user) {
            return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
        }

        const resourceOwnerId = getResourceOwnerId(user)

        // Obtener body para ver si hay filtro de fuentes
        let sourceIds: string[] | undefined
        try {
            const body = await request.json()
            if (body.sourceIds && Array.isArray(body.sourceIds)) {
                sourceIds = body.sourceIds
            }
        } catch (e) {
            // Body vacío es válido (escanear todas)
        }

        // Obtener fuentes disponibles
        let fuentes = await getUserSources(resourceOwnerId)

        if (fuentes.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No hay fuentes de noticias configuradas en el sistema.',
                noticias: [],
                por_categoria: {}
            })
        }

        // Filtrar si se especificaron IDs
        if (sourceIds && sourceIds.length > 0) {
            console.log(`🎯 Filtrando por ${sourceIds.length} fuentes seleccionadas`)
            fuentes = fuentes.filter(f => sourceIds!.includes(f.id))
        }

        if (fuentes.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No hay fuentes seleccionadas para escanear',
                noticias: [],
                por_categoria: {}
            })
        }

        console.log(`📡 Escaneando ${fuentes.length} fuentes para usuario ${user.email}`)

        // Escanear cada fuente en paralelo (máx 3 a la vez)
        const allNoticias: NewsPreview[] = []
        const batchSize = 3

        for (let i = 0; i < fuentes.length; i += batchSize) {
            const batch = fuentes.slice(i, i + batchSize)
            const results = await Promise.all(batch.map(scanSourceHomepage))
            results.forEach(noticias => allNoticias.push(...noticias))
        }

        // Contar por categoría
        const porCategoria: { [key: string]: number } = {}
        allNoticias.forEach(n => {
            porCategoria[n.categoria] = (porCategoria[n.categoria] || 0) + 1
        })

        console.log(`✅ Total: ${allNoticias.length} noticias encontradas`)
        console.log(`📊 Por categoría:`, porCategoria)

        return NextResponse.json({
            success: true,
            noticias: allNoticias,
            por_categoria: porCategoria,
            fuentes_escaneadas: fuentes.length,
            total_noticias: allNoticias.length
        })

    } catch (error: any) {
        console.error('Error en preview scraping:', error)
        return NextResponse.json(
            { error: error.message || 'Error interno del servidor' },
            { status: 500 }
        )
    }
}
