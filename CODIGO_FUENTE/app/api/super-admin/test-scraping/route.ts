import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/supabase-auth'
import { parseRSSFeed } from '@/lib/rss-parser'

const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY
const SCRAPINGBEE_BASE_URL = 'https://app.scrapingbee.com/api/v1/'

// POST: Probar scraping de una URL
export async function POST(request: NextRequest) {
    const user = await getCurrentUser()
    if (!user || user.role !== 'super_admin') {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const body = await request.json()
    const { url, rss_url, tipo_scraping, selectores_css } = body

    if (!url) {
        return NextResponse.json({ error: 'URL requerida' }, { status: 400 })
    }

    const results: { method: string; success: boolean; chars: number; preview: string; error?: string }[] = []

    // Probar RSS si está disponible
    if (rss_url && (tipo_scraping === 'rss' || tipo_scraping === 'ambos')) {
        try {
            console.log(`🧪 Probando RSS: ${rss_url}`)
            const rssFeed = await parseRSSFeed(rss_url, 'Test')

            if (rssFeed.items.length > 0) {
                const firstItem = rssFeed.items[0]
                results.push({
                    method: 'RSS',
                    success: firstItem.contenido.length > 100,
                    chars: firstItem.contenido.length,
                    preview: firstItem.contenido.substring(0, 300) + '...'
                })
            } else {
                results.push({
                    method: 'RSS',
                    success: false,
                    chars: 0,
                    preview: '',
                    error: 'No se encontraron items en el feed'
                })
            }
        } catch (error) {
            results.push({
                method: 'RSS',
                success: false,
                chars: 0,
                preview: '',
                error: String(error)
            })
        }
    }

    // Probar ScrapingBee
    if (SCRAPINGBEE_API_KEY && (tipo_scraping === 'web' || tipo_scraping === 'ambos' || !rss_url)) {
        try {
            console.log(`🧪 Probando ScrapingBee: ${url}`)

            const params = new URLSearchParams({
                api_key: SCRAPINGBEE_API_KEY,
                url,
                render_js: 'true',
                premium_proxy: 'false',
                country_code: 'cl',
                wait: '2000'
            })

            const response = await fetch(`${SCRAPINGBEE_BASE_URL}?${params.toString()}`)

            if (response.ok) {
                const html = await response.text()

                // Parsear con JSDOM
                const { JSDOM } = await import('jsdom')
                const dom = new JSDOM(html)
                const doc = dom.window.document

                // Remover elementos basura
                doc.querySelectorAll('script, style, nav, header, footer, .ads').forEach(el => el.remove())

                let contenido = ''

                // Probar selectores personalizados
                if (selectores_css?.contenido && selectores_css.contenido.length > 0) {
                    for (const selector of selectores_css.contenido) {
                        try {
                            const el = doc.querySelector(selector)
                            if (el) {
                                contenido = el.textContent?.trim() || ''
                                if (contenido.length > 100) {
                                    console.log(`✅ Selector ${selector} exitoso: ${contenido.length} chars`)
                                    break
                                }
                            }
                        } catch (e) {
                            // Selector inválido
                        }
                    }
                }

                // Fallback a selectores genéricos
                if (contenido.length < 100) {
                    const genericSelectors = ['article', '.article-body', '.entry-content', 'main']
                    for (const sel of genericSelectors) {
                        const el = doc.querySelector(sel)
                        if (el && el.textContent && el.textContent.trim().length > 100) {
                            contenido = el.textContent.trim()
                            break
                        }
                    }
                }

                results.push({
                    method: 'ScrapingBee',
                    success: contenido.length > 200,
                    chars: contenido.length,
                    preview: contenido.substring(0, 300) + '...'
                })
            } else {
                results.push({
                    method: 'ScrapingBee',
                    success: false,
                    chars: 0,
                    preview: '',
                    error: `HTTP ${response.status}`
                })
            }
        } catch (error) {
            results.push({
                method: 'ScrapingBee',
                success: false,
                chars: 0,
                preview: '',
                error: String(error)
            })
        }
    }

    // Determinar si fue exitoso
    const anySuccess = results.some(r => r.success)

    return NextResponse.json({
        success: anySuccess,
        results,
        recommendation: anySuccess
            ? (results.find(r => r.method === 'RSS' && r.success) ? 'Usar RSS' : 'Usar ScrapingBee')
            : 'Revisar selectores o probar premium'
    })
}
