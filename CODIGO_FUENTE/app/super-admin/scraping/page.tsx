'use client'

import { useState, useEffect } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase'
import { Navigation } from '@/components/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
    RefreshCw,
    Play,
    TrendingUp,
    DollarSign,
    Database,
    Clock,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Loader2
} from 'lucide-react'
import Swal from 'sweetalert2'
import { toast } from 'react-toastify'

// Definir tipos localmente para evitar importar desde scraping-service
interface FuenteFinal {
    id: string
    region: string
    nombre_fuente: string
    url: string
    rss_url?: string
    esta_activo: boolean
    requiere_js?: boolean
    frecuencia_scraping_minutos: number
}

interface FuenteConMetricas extends FuenteFinal {
    total_scrapes: number
    scrapes_exitosos: number
    scrapes_fallidos: number
    tasa_exito: number
    ultima_ejecucion: string | null
    proxima_ejecucion: string | null
}

interface MonthlyMetrics {
    total_credits_used: number
    total_cost_usd: number
    rss_requests: number
    scrapingbee_requests: number
    total_news: number
}

export default function SuperAdminScrapingPage() {
    const [fuentes, setFuentes] = useState<FuenteConMetricas[]>([])
    const [metrics, setMetrics] = useState<MonthlyMetrics | null>(null)
    const [loading, setLoading] = useState(true)
    const [scraping, setScraping] = useState<string | null>(null)
    const [selectedRegion, setSelectedRegion] = useState<string>('all')
    const [regions, setRegions] = useState<string[]>([])
    const [authorized, setAuthorized] = useState(false)
    const supabase = createSupabaseBrowser()

    // Verificar acceso - solo super_admin
    useEffect(() => {
        async function checkAccess() {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) {
                    window.location.href = '/auth/signin'
                    return
                }

                const { data: userData } = await supabase
                    .from('users')
                    .select('role')
                    .eq('id', user.id)
                    .single()

                if (userData?.role !== 'super_admin') {
                    toast.error('Acceso denegado. Solo para Super Admin.')
                    window.location.href = '/'
                    return
                }

                setAuthorized(true)
                loadData()
            } catch (error) {
                console.error('Error checking access:', error)
                window.location.href = '/'
            }
        }

        checkAccess()
    }, [])

    async function loadData() {
        try {
            setLoading(true)

            // Cargar fuentes
            const { data: fuentesData, error: fuentesError } = await supabase
                .from('fuentes_final')
                .select('*')
                .order('region', { ascending: true })
                .order('nombre_fuente', { ascending: true })

            if (fuentesError) throw fuentesError

            setFuentes(fuentesData || [])

            // Obtener regiones únicas
            const uniqueRegions = [...new Set(fuentesData?.map(f => f.region) || [])]
            setRegions(uniqueRegions)

            // Cargar métricas mensuales desde la BD directamente
            const startOfMonth = new Date()
            startOfMonth.setDate(1)
            startOfMonth.setHours(0, 0, 0, 0)

            const { data: logsData } = await supabase
                .from('logs_scraping')
                .select('*')
                .gte('created_at', startOfMonth.toISOString())

            if (logsData) {
                const monthlyMetrics = logsData.reduce((acc, log) => {
                    acc.total_credits_used += log.scrapingbee_credits_usados || 0
                    acc.total_cost_usd += log.costo_estimado_usd || 0
                    acc.total_news += log.noticias_nuevas || 0
                    acc.scrapingbee_requests++
                    return acc
                }, {
                    total_credits_used: 0,
                    total_cost_usd: 0,
                    rss_requests: 0,
                    scrapingbee_requests: 0,
                    total_news: 0
                })

                setMetrics(monthlyMetrics)
            }

        } catch (error) {
            console.error('Error loading data:', error)
            toast.error('No se pudieron cargar los datos')
        } finally {
            setLoading(false)
        }
    }

    async function handleScrapeFuente(fuente: FuenteConMetricas) {
        try {
            setScraping(fuente.id)

            // Llamar al API endpoint en lugar de la función directamente
            const response = await fetch('/api/scrape-source', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fuente_id: fuente.id })
            })

            const result = await response.json()

            if (result.success) {
                Swal.fire({
                    title: '✅ Scraping exitoso',
                    html: `
            <div class="text-left">
              <p><strong>Fuente:</strong> ${fuente.nombre_fuente}</p>
              <p><strong>Noticias encontradas:</strong> ${result.noticias_encontradas}</p>
              <p><strong>Noticias nuevas:</strong> ${result.noticias_nuevas}</p>
              <p><strong>Método:</strong> ${result.metodo}</p>
              <p><strong>Créditos usados:</strong> ${result.credits_used}</p>
              <p><strong>Costo:</strong> $${result.cost_usd.toFixed(6)} USD</p>
              <p><strong>Tiempo:</strong> ${(result.execution_time_ms / 1000).toFixed(2)}s</p>
            </div>
          `,
                    icon: 'success'
                })
            } else {
                toast.error(result.error || 'Error desconocido')
            }

            // Recargar datos
            await loadData()

        } catch (error) {
            console.error('Error scraping:', error)
            toast.error('Error al ejecutar scraping')
        } finally {
            setScraping(null)
        }
    }

    async function handleScrapeAll() {
        const result = await Swal.fire({
            title: '¿Scrapear todas las fuentes?',
            text: 'Esto puede tomar varios minutos y consumir créditos de ScrapingBee',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Sí, scrapear',
            cancelButtonText: 'Cancelar'
        })

        if (!result.isConfirmed) return

        try {
            setScraping('all')

            // Llamar al endpoint de cron manualmente
            const response = await fetch('/api/cron/scrape-news', {
                method: 'GET',
                credentials: 'include' // Enviar cookies para autenticación
            })

            const data = await response.json()

            if (data.success) {
                Swal.fire({
                    title: '✅ Scraping completado',
                    html: `
            <div class="text-left">
              <p><strong>Regiones procesadas:</strong> ${data.stats.regions_processed}</p>
              <p><strong>Noticias encontradas:</strong> ${data.stats.total_news_found}</p>
              <p><strong>Noticias nuevas:</strong> ${data.stats.total_new_news}</p>
              <p><strong>Créditos usados:</strong> ${data.stats.total_credits_used}</p>
              <p><strong>Costo total:</strong> $${data.stats.total_cost_usd.toFixed(4)} USD</p>
              <p><strong>Tiempo:</strong> ${(data.execution_time_ms / 1000).toFixed(2)}s</p>
            </div>
          `,
                    icon: 'success'
                })
            } else {
                toast.error(data.error || 'Error desconocido')
            }

            await loadData()

        } catch (error) {
            console.error('Error:', error)
            toast.error('Error al ejecutar scraping masivo')
        } finally {
            setScraping(null)
        }
    }

    const fuentesFiltradas = selectedRegion === 'all'
        ? fuentes
        : fuentes.filter(f => f.region === selectedRegion)

    const creditLimit = 350000 // Plan Startup
    const creditUsagePercent = metrics ? (metrics.total_credits_used / creditLimit) * 100 : 0
    const isApproachingLimit = creditUsagePercent > 70
    const isNearLimit = creditUsagePercent > 90

    if (loading || !authorized) {
        return (
            <div className="min-h-screen bg-gray-50">
                <Navigation />
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gray-50">
            <Navigation />

            <div className="container mx-auto px-4 py-8 max-w-7xl">
                {/* Header */}
                <div className="mb-8">
                    <h1 className="text-4xl font-bold text-gray-900 mb-2">
                        Panel de Scraping (Super Admin)
                    </h1>
                    <p className="text-gray-600">
                        Monitoreo y control del sistema de scraping automático
                    </p>
                </div>

                {/* Métricas principales */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-gray-600">
                                Noticias del Mes
                            </CardTitle>
                            <Database className="h-4 w-4 text-blue-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-gray-900">
                                {metrics?.total_news || 0}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                {metrics?.rss_requests || 0} RSS + {metrics?.scrapingbee_requests || 0} ScrapingBee
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-gray-600">
                                Créditos Usados
                            </CardTitle>
                            <TrendingUp className="h-4 w-4 text-purple-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-gray-900">
                                {metrics?.total_credits_used.toLocaleString() || 0}
                            </div>
                            <div className="mt-2">
                                <div className="w-full bg-gray-200 rounded-full h-2">
                                    <div
                                        className={`h-2 rounded-full transition-all ${isNearLimit ? 'bg-red-600' :
                                            isApproachingLimit ? 'bg-yellow-600' :
                                                'bg-green-600'
                                            }`}
                                        style={{ width: `${Math.min(creditUsagePercent, 100)}%` }}
                                    />
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                    {creditUsagePercent.toFixed(1)}% del límite mensual
                                </p>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-gray-600">
                                Costo del Mes
                            </CardTitle>
                            <DollarSign className="h-4 w-4 text-green-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-gray-900">
                                ${(metrics?.total_cost_usd || 0).toFixed(2)}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                USD (Plan Startup: $99/mes)
                            </p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                            <CardTitle className="text-sm font-medium text-gray-600">
                                Fuentes Activas
                            </CardTitle>
                            <CheckCircle className="h-4 w-4 text-blue-600" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-gray-900">
                                {fuentes.filter(f => f.esta_activo).length}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                                de {fuentes.length} totales
                            </p>
                        </CardContent>
                    </Card>
                </div>

                {/* Alertas */}
                {isNearLimit && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-red-900">⚠️ Límite de créditos casi alcanzado</h3>
                            <p className="text-sm text-red-700 mt-1">
                                Has usado el {creditUsagePercent.toFixed(1)}% de tus créditos mensuales.
                                Considera reducir la frecuencia de scraping o priorizar fuentes RSS.
                            </p>
                        </div>
                    </div>
                )}

                {isApproachingLimit && !isNearLimit && (
                    <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
                        <div>
                            <h3 className="font-semibold text-yellow-900">Acercándose al límite</h3>
                            <p className="text-sm text-yellow-700 mt-1">
                                Has usado el {creditUsagePercent.toFixed(1)}% de tus créditos mensuales.
                            </p>
                        </div>
                    </div>
                )}

                {/* Controles */}
                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle>Controles de Scraping</CardTitle>
                    </CardHeader>
                    <CardContent className="flex gap-4 flex-wrap">
                        <Button
                            onClick={handleScrapeAll}
                            disabled={scraping !== null}
                            className="flex items-center gap-2"
                        >
                            {scraping === 'all' ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Scrapeando...
                                </>
                            ) : (
                                <>
                                    <Play className="h-4 w-4" />
                                    Scrapear Todas las Fuentes
                                </>
                            )}
                        </Button>

                        <Button
                            onClick={loadData}
                            variant="outline"
                            className="flex items-center gap-2"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Actualizar Datos
                        </Button>

                        <select
                            value={selectedRegion}
                            onChange={(e) => setSelectedRegion(e.target.value)}
                            className="px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="all">Todas las regiones</option>
                            {regions.map(region => (
                                <option key={region} value={region}>{region}</option>
                            ))}
                        </select>
                    </CardContent>
                </Card>

                {/* Tabla de fuentes */}
                <Card>
                    <CardHeader>
                        <CardTitle>Fuentes de Noticias ({fuentesFiltradas.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-gray-200">
                                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Fuente</th>
                                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Región</th>
                                        <th className="text-center py-3 px-4 font-semibold text-gray-700">Método</th>
                                        <th className="text-center py-3 px-4 font-semibold text-gray-700">Tasa Éxito</th>
                                        <th className="text-center py-3 px-4 font-semibold text-gray-700">Total</th>
                                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Última Ejecución</th>
                                        <th className="text-center py-3 px-4 font-semibold text-gray-700">Estado</th>
                                        <th className="text-center py-3 px-4 font-semibold text-gray-700">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {fuentesFiltradas.map(fuente => (
                                        <tr key={fuente.id} className="border-b border-gray-100 hover:bg-gray-50">
                                            <td className="py-3 px-4">
                                                <div className="font-medium text-gray-900">{fuente.nombre_fuente}</div>
                                                {fuente.requiere_js && (
                                                    <Badge variant="outline" className="mt-1 text-xs">JS</Badge>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-gray-600">{fuente.region}</td>
                                            <td className="py-3 px-4 text-center">
                                                <Badge variant={fuente.rss_url ? 'default' : 'secondary'}>
                                                    {fuente.rss_url ? 'RSS' : 'ScrapingBee'}
                                                </Badge>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className={`font-semibold ${fuente.tasa_exito >= 80 ? 'text-green-600' :
                                                        fuente.tasa_exito >= 50 ? 'text-yellow-600' :
                                                            'text-red-600'
                                                        }`}>
                                                        {fuente.tasa_exito?.toFixed(0) || 0}%
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-center text-gray-600">
                                                <div className="text-sm">
                                                    <div className="text-green-600">{fuente.scrapes_exitosos || 0} ✓</div>
                                                    <div className="text-red-600">{fuente.scrapes_fallidos || 0} ✗</div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4">
                                                {fuente.ultima_ejecucion ? (
                                                    <div className="text-sm text-gray-600">
                                                        <Clock className="h-3 w-3 inline mr-1" />
                                                        {new Date(fuente.ultima_ejecucion).toLocaleString('es-CL')}
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">Nunca</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                {fuente.esta_activo ? (
                                                    <CheckCircle className="h-5 w-5 text-green-600 mx-auto" />
                                                ) : (
                                                    <XCircle className="h-5 w-5 text-gray-400 mx-auto" />
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleScrapeFuente(fuente)}
                                                    disabled={scraping !== null || !fuente.esta_activo}
                                                >
                                                    {scraping === fuente.id ? (
                                                        <Loader2 className="h-4 w-4 animate-spin" />
                                                    ) : (
                                                        <Play className="h-4 w-4" />
                                                    )}
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
