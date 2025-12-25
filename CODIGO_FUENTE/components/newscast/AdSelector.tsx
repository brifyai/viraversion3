'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Loader2, Volume2, Clock, AlertCircle } from 'lucide-react'

interface Campaign {
    id: string
    nombre: string
    descripcion?: string
    url_audio?: string
    duracion_segundos?: number
    fecha_inicio: string
    fecha_fin: string
    esta_activo: boolean
}

interface AdSelectorProps {
    adCount: number
    onAdCountChange: (count: number) => void
    selectedAdIds: string[]
    onSelectedAdsChange: (adIds: string[]) => void
    onTotalDurationChange?: (durationSeconds: number) => void  // ✅ NUEVO: Callback para duración total
    maxAds?: number
}

export function AdSelector({
    adCount,
    onAdCountChange,
    selectedAdIds,
    onSelectedAdsChange,
    onTotalDurationChange,  // ✅ NUEVO
    maxAds = 5
}: AdSelectorProps) {
    const [campaigns, setCampaigns] = useState<Campaign[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    // Cargar campañas activas al montar
    useEffect(() => {
        console.log('🔄 AdSelector MONTADO - v2 - Cargando campañas...')
        async function loadCampaigns() {
            try {
                setLoading(true)
                setError(null)

                const response = await fetch('/api/campaigns', {
                    credentials: 'include'
                })

                if (!response.ok) {
                    throw new Error('Error al cargar campañas')
                }

                const data = await response.json()

                // Fecha de hoy (solo fecha, sin hora)
                const today = new Date().toISOString().split('T')[0]

                // Filtrar: solo campañas activas, vigentes por fecha, y con URL de Drive o texto
                const activeCampaigns = data.filter((c: Campaign) => {
                    // Debe estar activa
                    if (!c.esta_activo) return false

                    // Verificar fechas
                    const inicio = c.fecha_inicio?.split('T')[0] || c.fecha_inicio
                    const fin = c.fecha_fin?.split('T')[0] || c.fecha_fin
                    if (inicio && inicio > today) return false // Aún no inicia
                    if (fin && fin < today) return false // Ya terminó

                    // Si tiene url_audio, debe ser de Drive (https://)
                    // Si no tiene url_audio (texto), también está OK
                    if (c.url_audio && !c.url_audio.startsWith('https://')) {
                        return false // Excluir archivos locales
                    }

                    return true
                })

                console.log(`📢 Campañas válidas (activas hoy): ${activeCampaigns.length}`)
                setCampaigns(activeCampaigns)

                // Auto-seleccionar las primeras N campañas si no hay selección previa
                if (selectedAdIds.length === 0 && activeCampaigns.length > 0) {
                    const autoSelect = activeCampaigns.slice(0, adCount).map((c: Campaign) => c.id)
                    onSelectedAdsChange(autoSelect)
                }

            } catch (err: any) {
                console.error('Error loading campaigns:', err)
                setError(err.message || 'Error al cargar campañas')
            } finally {
                setLoading(false)
            }
        }

        loadCampaigns()
    }, [])

    // Sincronizar selección cuando cambia adCount
    useEffect(() => {
        if (selectedAdIds.length > adCount) {
            // Reducir selección si hay más de los permitidos
            onSelectedAdsChange(selectedAdIds.slice(0, adCount))
        } else if (selectedAdIds.length < adCount && campaigns.length > 0) {
            // Agregar más si faltan
            const availableToAdd = campaigns
                .filter(c => !selectedAdIds.includes(c.id))
                .slice(0, adCount - selectedAdIds.length)
                .map(c => c.id)
            if (availableToAdd.length > 0) {
                onSelectedAdsChange([...selectedAdIds, ...availableToAdd])
            }
        }
    }, [adCount, campaigns])

    const handleToggleCampaign = (campaignId: string) => {
        if (selectedAdIds.includes(campaignId)) {
            // Deseleccionar
            onSelectedAdsChange(selectedAdIds.filter(id => id !== campaignId))
        } else {
            // Seleccionar (solo si no excede el límite)
            if (selectedAdIds.length < adCount) {
                onSelectedAdsChange([...selectedAdIds, campaignId])
            }
        }
    }

    // Calcular duración total de publicidades seleccionadas
    const totalAdDuration = campaigns
        .filter(c => selectedAdIds.includes(c.id))
        .reduce((sum, c) => sum + (c.duracion_segundos || 25), 0)

    // ✅ NUEVO: Notificar al padre cuando cambia la duración total
    useEffect(() => {
        if (onTotalDurationChange) {
            onTotalDurationChange(totalAdDuration)
        }
    }, [totalAdDuration, onTotalDurationChange])

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Volume2 className="h-5 w-5 text-purple-600" />
                    Publicidades
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Slider de cantidad */}
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <Label className="text-sm text-gray-600">Cantidad de anuncios</Label>
                        <Badge variant="secondary" className="font-mono">
                            {adCount} {adCount === 1 ? 'anuncio' : 'anuncios'}
                        </Badge>
                    </div>
                    <Slider
                        value={[adCount]}
                        onValueChange={([value]) => onAdCountChange(value)}
                        min={0}
                        max={maxAds}
                        step={1}
                        className="w-full"
                    />
                    <div className="flex justify-between text-xs text-gray-400">
                        <span>Sin anuncios</span>
                        <span>{maxAds} máx</span>
                    </div>
                </div>

                {/* Lista de campañas */}
                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                        <span className="ml-2 text-sm text-gray-500">Cargando campañas...</span>
                    </div>
                ) : error ? (
                    <div className="flex items-center gap-2 text-red-500 text-sm py-2">
                        <AlertCircle className="h-4 w-4" />
                        {error}
                    </div>
                ) : campaigns.length === 0 ? (
                    <div className="text-center py-4 text-sm text-gray-500">
                        No hay campañas activas. Crea una en{' '}
                        <a href="/bibliotecas/publicidad" className="text-blue-600 hover:underline">
                            Bibliotecas → Publicidad
                        </a>
                    </div>
                ) : (
                    <div className="space-y-2">
                        <p className="text-xs text-gray-500 mb-2">Mostrando {campaigns.length} campañas disponibles:</p>
                        {campaigns.map((campaign) => {
                            const isSelected = selectedAdIds.includes(campaign.id)
                            const isDisabled = !isSelected && selectedAdIds.length >= adCount

                            return (
                                <div
                                    key={campaign.id}
                                    className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${isSelected
                                        ? 'bg-purple-50 border-purple-200'
                                        : isDisabled
                                            ? 'bg-gray-50 border-gray-100 opacity-50'
                                            : 'bg-white border-gray-200 hover:bg-gray-50'
                                        }`}
                                >
                                    <Checkbox
                                        id={campaign.id}
                                        checked={isSelected}
                                        onCheckedChange={() => handleToggleCampaign(campaign.id)}
                                        disabled={isDisabled && !isSelected}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <Label
                                            htmlFor={campaign.id}
                                            className={`text-sm font-medium cursor-pointer truncate block ${isDisabled && !isSelected ? 'text-gray-400' : 'text-gray-700'
                                                }`}
                                        >
                                            {campaign.nombre}
                                        </Label>
                                        {campaign.descripcion && (
                                            <p className="text-xs text-gray-500 truncate">{campaign.descripcion}</p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 text-xs text-gray-500">
                                        <Clock className="h-3 w-3" />
                                        {campaign.duracion_segundos || 25}s
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {/* Resumen */}
                {adCount > 0 && selectedAdIds.length > 0 && (
                    <div className="pt-2 border-t flex justify-between text-sm">
                        <span className="text-gray-600">
                            {selectedAdIds.length}/{adCount} seleccionadas
                        </span>
                        <span className="text-gray-600 flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            ~{Math.round(totalAdDuration / 60 * 10) / 10} min de publicidad
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
