import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { JSDOM } from 'jsdom'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      url,
      region,
      render_js = false,
      premium_proxy = false,
      country_code
    } = body

    // 1. MODO REGIÓN: Scraping de múltiples fuentes por región
    if (region) {
      return await handleRegionScraping(region)
    }

    // 2. MODO URL ÚNICA: Scraping de una URL específica (existente)
    if (!url) {
      return NextResponse.json(
        { error: 'URL o región es requerida' },
        { status: 400 }
      )
    }

    // Usar API key del .env
    const api_key = process.env.SCRAPINGBEE_API_KEY

    if (!api_key) {
      return NextResponse.json(
        { error: 'SCRAPINGBEE_API_KEY no configurada en variables de entorno' },
        { status: 500 }
      )
    }

    // Construir la URL de ScrapingBee
    const scrapingBeeUrl = new URL('https://app.scrapingbee.com/api/v1/')
    scrapingBeeUrl.searchParams.append('api_key', api_key)
    scrapingBeeUrl.searchParams.append('url', url)
    scrapingBeeUrl.searchParams.append('render_js', render_js ? 'true' : 'false')
    scrapingBeeUrl.searchParams.append('premium_proxy', premium_proxy ? 'true' : 'false')

    if (country_code) {
      scrapingBeeUrl.searchParams.append('country_code', country_code)
    }

    console.log(`🔍 Haciendo scraping de: ${url}`)

    const response = await fetch(scrapingBeeUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Error de ScrapingBee: ${response.status}`)
      return NextResponse.json(
        { error: `Error de ScrapingBee: ${response.status}`, details: errorText },
        { status: response.status }
      )
    }

    const html = await response.text()
    console.log(`✅ HTML obtenido, longitud: ${html.length} caracteres`)

    return NextResponse.json({
      success: true,
      html: html,
      length: html.length,
      url: url
    })

  } catch (error) {
    console.error('❌ Error en API de scraping:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Error interno del servidor',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

// Manejador para scraping por región
async function handleRegionScraping(region: string) {
  console.log(`🌍 Iniciando scraping para región: ${region}`)

  try {
    // Validar que la región existe y está activa
    const { data: regionConfig, error: regionError } = await supabase
      .from('configuraciones_regiones')
      .select('region, esta_activo')
      .eq('region', region)
      .single()

    if (regionError || !regionConfig) {
      return NextResponse.json({
        success: false,
        error: `Región inválida: ${region}. Debe ser una región configurada en el sistema.`
      }, { status: 400 })
    }

    if (!regionConfig.esta_activo) {
      return NextResponse.json({
        success: false,
        error: `Región ${region} está desactivada.`
      }, { status: 400 })
    }

    // 1. Obtener fuentes activas para la región
    const { data: sources, error } = await supabase
      .from('fuentes_final')
      .select('*')
      .eq('region', region) // 'region' es la columna correcta ahora
      .eq('esta_activo', true)

    if (error) throw error

    if (!sources || sources.length === 0) {
      return NextResponse.json({
        success: false,
        message: `No hay fuentes configuradas para la región ${region}`,
        count: 0
      })
    }

    console.log(`📚 Encontradas ${sources.length} fuentes para ${region}`)
    const results = []
    let totalNewItems = 0

    // 2. Procesar cada fuente
    for (const source of sources) {
      // Priorizar RSS si existe
      if (source.rss_url) {
        try {
          console.log(`📡 Leyendo RSS de ${source.nombre_fuente}: ${source.rss_url}`)
          const feedItems = await parseRSS(source.rss_url)

          if (feedItems.length > 0) {
            // Guardar en DB
            let savedCount = 0
            for (const item of feedItems) {
              // Verificar si ya existe
              const { data: existing } = await supabase
                .from('noticias_scrapeadas')
                .select('id')
                .eq('url', item.link)
                .single()

              if (!existing) {
                await supabase.from('noticias_scrapeadas').insert({
                  titulo: item.title,
                  contenido: item.content || item.description,
                  resumen: item.description,
                  url: item.link,
                  fuente: source.nombre_fuente,
                  categoria: 'general', // Por defecto
                  region: region,
                  fecha_publicacion: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
                  fecha_scraping: new Date().toISOString(),
                  fue_procesada: false
                })
                savedCount++
              }
            }
            console.log(`✅ Guardadas ${savedCount} noticias nuevas de ${source.nombre_fuente}`)
            totalNewItems += savedCount
            results.push({ source: source.nombre_fuente, status: 'success', items: feedItems.length, new: savedCount })
          }
        } catch (err) {
          console.error(`❌ Error procesando RSS de ${source.nombre_fuente}:`, err)
          results.push({ source: source.nombre_fuente, status: 'error', error: String(err) })
        }
      } else {
        // TODO: Implementar scraping directo de HTML si no hay RSS
        // Por ahora saltamos
        console.log(`⚠️ Fuente ${source.nombre_fuente} no tiene RSS configurado, saltando...`)
        results.push({ source: source.nombre_fuente, status: 'skipped', reason: 'no_rss' })
      }
    }

    return NextResponse.json({
      success: true,
      region,
      sources_processed: sources.length,
      total_new_items: totalNewItems,
      details: results
    })

  } catch (error) {
    console.error('Error en handleRegionScraping:', error)
    return NextResponse.json(
      { error: 'Error procesando scraping por región', details: String(error) },
      { status: 500 }
    )
  }
}

// Función auxiliar para parsear RSS usando JSDOM
async function parseRSS(url: string) {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP error ${response.status}`)

    const xmlText = await response.text()
    const dom = new JSDOM(xmlText, { contentType: "text/xml" })
    const doc = dom.window.document

    const items = Array.from(doc.querySelectorAll("item"))

    return items.map(item => ({
      title: item.querySelector("title")?.textContent || "Sin título",
      link: item.querySelector("link")?.textContent || "",
      description: item.querySelector("description")?.textContent || "",
      content: item.querySelector("content\\:encoded")?.textContent || item.querySelector("description")?.textContent || "",
      pubDate: item.querySelector("pubDate")?.textContent || new Date().toISOString()
    })).filter(i => i.link && i.title) // Filtrar items inválidos

  } catch (error) {
    console.error(`Error parsing RSS from ${url}:`, error)
    return []
  }
}

export async function GET() {
  return NextResponse.json(
    {
      message: 'API de scraping',
      usage: {
        single_url: 'POST { "url": "..." }',
        region: 'POST { "region": "..." }'
      }
    },
    { status: 200 }
  )
}