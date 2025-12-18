'use client'

import { Slider } from '@/components/ui/slider'
import { Clock, AlertTriangle, CheckCircle } from 'lucide-react'

interface DurationSliderProps {
    duration: number
    onDurationChange: (duration: number) => void
    min?: number
    max?: number
    step?: number
    selectedNewsCount?: number  // Noticias seleccionadas actualmente
}

// Constantes de calibración
const AVG_SECONDS_PER_NEWS = 55  // ~55s por noticia (basado en datos reales)
const INTRO_OUTRO_SECONDS = 30   // Intro + outro

export function DurationSlider({
    duration,
    onDurationChange,
    min = 5,
    max = 60,
    step = 5,
    selectedNewsCount = 0
}: DurationSliderProps) {
    // Calcular rango recomendado de noticias para esta duración
    const targetSeconds = duration * 60
    const newsTimeAvailable = targetSeconds - INTRO_OUTRO_SECONDS
    const recommendedNewsMin = Math.max(1, Math.floor(newsTimeAvailable / 65))  // ~65s máx por noticia
    const recommendedNewsMax = Math.ceil(newsTimeAvailable / 45)  // ~45s mín por noticia

    // Estado de validación
    const isNewsCountOk = selectedNewsCount >= recommendedNewsMin
    const newsDeficit = recommendedNewsMin - selectedNewsCount

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 flex items-center">
                    <Clock className="h-4 w-4 mr-2" />
                    Duración del Noticiero
                </label>
                <span className="text-2xl font-bold text-blue-600">
                    {duration} min
                </span>
            </div>

            <Slider
                value={[duration]}
                onValueChange={(value) => onDurationChange(value[0])}
                min={min}
                max={max}
                step={step}
                className="w-full"
            />

            <div className="flex justify-between text-xs text-gray-500">
                <span>{min} min</span>
                <span>{max} min</span>
            </div>

            {/* Guía de cantidad de noticias */}
            <div className={`rounded-lg p-3 border ${selectedNewsCount === 0
                    ? 'bg-blue-50 border-blue-200'
                    : isNewsCountOk
                        ? 'bg-green-50 border-green-200'
                        : 'bg-amber-50 border-amber-200'
                }`}>
                {selectedNewsCount === 0 ? (
                    // Sin noticias seleccionadas - mostrar recomendación
                    <div className="text-sm text-blue-700">
                        <p className="font-medium">📰 Recomendación para {duration} minutos:</p>
                        <p className="mt-1">
                            Selecciona entre <strong>{recommendedNewsMin}</strong> y <strong>{recommendedNewsMax}</strong> noticias
                        </p>
                    </div>
                ) : isNewsCountOk ? (
                    // Suficientes noticias
                    <div className="flex items-start text-sm text-green-700">
                        <CheckCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-medium">✅ {selectedNewsCount} noticias seleccionadas</p>
                            <p className="text-xs text-green-600 mt-0.5">
                                Suficiente para {duration} minutos (recomendado: {recommendedNewsMin}-{recommendedNewsMax})
                            </p>
                        </div>
                    </div>
                ) : (
                    // Faltan noticias
                    <div className="flex items-start text-sm text-amber-700">
                        <AlertTriangle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-medium">⚠️ Faltan noticias para {duration} minutos</p>
                            <p className="text-xs text-amber-600 mt-0.5">
                                Tienes {selectedNewsCount} pero necesitas al menos <strong>{recommendedNewsMin}</strong> noticias
                            </p>
                            <p className="text-xs text-amber-600">
                                Agrega {newsDeficit} más o reduce la duración a ~{Math.max(5, Math.floor(selectedNewsCount * AVG_SECONDS_PER_NEWS / 60))} min
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
