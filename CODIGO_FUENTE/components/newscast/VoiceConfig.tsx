'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Settings2, Zap } from 'lucide-react'

export interface VoiceConfigSettings {
  speed: number      // -50 a +50
  pitch: number      // -30 a +30
  volume: number     // -10 a +10 (dB)
  fmRadioEffect: boolean
  fmRadioIntensity: number  // 0-100
}

interface VoiceConfigProps {
  settings: VoiceConfigSettings
  onChange: (settings: VoiceConfigSettings) => void
  disabled?: boolean
}

export function VoiceConfig({ settings, onChange, disabled }: VoiceConfigProps) {
  const handleSpeedChange = (value: number[]) => {
    onChange({ ...settings, speed: value[0] })
  }

  const handlePitchChange = (value: number[]) => {
    onChange({ ...settings, pitch: value[0] })
  }

  const handleVolumeChange = (value: number[]) => {
    onChange({ ...settings, volume: value[0] })
  }

  return (
    <div className="space-y-6 p-4 bg-gray-50 rounded-lg border">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
        <Settings2 className="h-4 w-4" />
        Configuración de Voz
      </div>

      {/* Velocidad */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-2 text-sm">
            <Zap className="h-4 w-4 text-yellow-500" />
            Velocidad
          </Label>
          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
            {settings.speed > 0 ? '+' : ''}{settings.speed}
          </span>
        </div>
        <Slider
          value={[settings.speed]}
          onValueChange={handleSpeedChange}
          min={-50}
          max={50}
          step={5}
          disabled={disabled}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Más lento</span>
          <span>Normal</span>
          <span>Más rápido</span>
        </div>
      </div>

      {/* Tono */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Tono de Voz</Label>
          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
            {settings.pitch > 0 ? '+' : ''}{settings.pitch}
          </span>
        </div>
        <Slider
          value={[settings.pitch]}
          onValueChange={handlePitchChange}
          min={-30}
          max={30}
          step={5}
          disabled={disabled}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Más grave</span>
          <span>Normal</span>
          <span>Más agudo</span>
        </div>
      </div>

      {/* Volumen */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm">Volumen</Label>
          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">
            {settings.volume > 0 ? '+' : ''}{settings.volume}dB
          </span>
        </div>
        <Slider
          value={[settings.volume]}
          onValueChange={handleVolumeChange}
          min={-10}
          max={10}
          step={1}
          disabled={disabled}
          className="w-full"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>Más bajo</span>
          <span>Normal</span>
          <span>Más alto</span>
        </div>
      </div>
    </div>
  )
}

// Default settings - Valores normales (0 = sin ajuste)
export const defaultVoiceConfig: VoiceConfigSettings = {
  speed: 0,       // Velocidad normal
  pitch: 0,       // Tono normal
  volume: 0,      // Volumen normal
  fmRadioEffect: false,
  fmRadioIntensity: 0
}
