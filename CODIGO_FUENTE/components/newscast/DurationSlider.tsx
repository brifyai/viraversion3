'use client'

import { Slider } from '@/components/ui/slider'
import { Clock } from 'lucide-react'

interface DurationSliderProps {
    duration: number
    onDurationChange: (duration: number) => void
    min?: number
    max?: number
    step?: number
}

export function DurationSlider({
    duration,
    onDurationChange,
    min = 5,
    max = 60,
    step = 5
}: DurationSliderProps) {
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

            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                <p>
                    ⏱️ Duración estimada: <strong>{duration} minutos</strong> ({Math.round(duration * 60)} segundos)
                </p>
                <p className="text-xs text-gray-500 mt-1">
                    El sistema ajustará automáticamente la cantidad de noticias para cumplir con esta duración
                </p>
            </div>
        </div>
    )
}
