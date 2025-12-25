'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { Navigation } from '@/components/navigation'
import { ProtectedRoute } from '@/components/protected-route'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Music,
  Play,
  Pause,
  Trash2,
  Plus,
  Loader2,
  Volume2,
  HardDrive,
  AlertCircle,
  Settings
} from 'lucide-react'
import { UploadAudioModal } from './components/UploadAudioModal'
import { CreateCampaignModal } from './components/CreateCampaignModal'
import { toast } from 'react-toastify'
import Link from 'next/link'

interface AudioItem {
  id: string
  nombre: string
  audio: string
  tipo: string
  descripcion: string
  duracion: string
  duration_seconds: number
  drive_file_id: string | null
  is_active: boolean
  created_at: string
}

interface Campaign {
  id: string
  nombre: string
  descripcion: string
  url_audio: string
  duracion_segundos: number
  fecha_inicio: string
  fecha_fin: string
  esta_activo: boolean
  created_at: string
}

interface DriveStatus {
  connected: boolean
  email: string | null
  canModify: boolean
}

export default function BibliotecasPage() {
  const [audios, setAudios] = useState<AudioItem[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [campaignModalOpen, setCampaignModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('audios')

  useEffect(() => {
    loadData()
    loadDriveStatus()
  }, [])

  async function loadDriveStatus() {
    try {
      const res = await fetch('/api/integrations/google', { credentials: 'include' })
      if (res.ok) {
        const data = await res.json()
        setDriveStatus(data)
      }
    } catch (error) {
      console.error('Error cargando estado Drive:', error)
    }
  }

  async function loadData() {
    setLoading(true)
    try {
      // Cargar audios
      const audiosRes = await fetch('/api/biblioteca-audio', { credentials: 'include' })
      if (audiosRes.ok) {
        const data = await audiosRes.json()
        setAudios(data || [])
      }

      // Cargar campañas - solo las que tienen URLs de Drive
      const campaignsRes = await fetch('/api/campaigns', { credentials: 'include' })
      if (campaignsRes.ok) {
        const data = await campaignsRes.json()
        // Filtrar solo campañas con audio en Drive (URLs https://)
        const driveCampaigns = (data || []).filter((c: Campaign) =>
          !c.url_audio || c.url_audio.startsWith('https://')
        )
        setCampaigns(driveCampaigns)
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
    } finally {
      setLoading(false)
    }
  }

  function playAudio(url: string, id: string) {
    if (audioElement) {
      audioElement.pause()
    }

    if (playingId === id) {
      setPlayingId(null)
      return
    }

    // Usar proxy para URLs de Google Drive
    const audioSrc = url.startsWith('https://drive.google.com/')
      ? `/api/audio-proxy?url=${encodeURIComponent(url)}`
      : url

    const audio = new Audio(audioSrc)
    audio.onended = () => setPlayingId(null)
    audio.play()
    setAudioElement(audio)
    setPlayingId(id)
  }

  async function deleteAudio(id: string) {
    if (!confirm('¿Estás seguro de eliminar este audio?')) return

    try {
      const res = await fetch(`/api/biblioteca-audio/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (res.ok) {
        setAudios(audios.filter(a => a.id !== id))
        toast.success('Audio eliminado')
      } else {
        toast.error('Error al eliminar')
      }
    } catch (error) {
      toast.error('Error al eliminar')
    }
  }

  async function deleteCampaign(id: string) {
    if (!confirm('¿Estás seguro de eliminar esta campaña?')) return

    try {
      const res = await fetch(`/api/campaigns/${id}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (res.ok) {
        setCampaigns(campaigns.filter(c => c.id !== id))
        toast.success('Campaña eliminada')
      } else {
        toast.error('Error al eliminar')
      }
    } catch (error) {
      toast.error('Error al eliminar')
    }
  }

  const tipoLabels: Record<string, string> = {
    'cortina': '🎵 Cortina',
    'musica': '🎶 Música',
    'efecto': '🔊 Efecto',
    'jingle': '📻 Jingle',
    'intro': '🎬 Intro',
    'outro': '🔚 Outro',
    'publicidad': '📢 Publicidad'
  }

  // Si no tiene Drive vinculado, mostrar aviso
  const showDriveWarning = driveStatus && !driveStatus.connected && driveStatus.canModify

  return (
    <ProtectedRoute requiredRole="admin">
      <div className="min-h-screen bg-gray-50">
        <Navigation />

        <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Biblioteca de Audio</h1>
              <p className="text-gray-600">Gestiona cortinas, publicidad y archivos de audio</p>
            </div>
            {driveStatus?.connected && (
              <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                <HardDrive className="h-4 w-4" />
                <span>Conectado a Google Drive</span>
              </div>
            )}
          </div>

          {/* Aviso si no tiene Drive vinculado */}
          {showDriveWarning && (
            <Card className="mb-6 border-amber-200 bg-amber-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  <div className="p-2 bg-amber-100 rounded-lg">
                    <AlertCircle className="h-6 w-6 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-amber-800">
                      Google Drive no vinculado
                    </h3>
                    <p className="text-sm text-amber-700 mt-1">
                      Para subir archivos de audio necesitas vincular tu cuenta de Google Drive.
                      Todos los archivos se almacenarán de forma segura en tu Drive.
                    </p>
                    <Button asChild size="sm" className="mt-3 bg-amber-600 hover:bg-amber-700">
                      <Link href="/integraciones">
                        <Settings className="h-4 w-4 mr-2" />
                        Ir a Integraciones
                      </Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList>
              <TabsTrigger value="audios" className="flex items-center gap-2">
                <Music className="h-4 w-4" />
                Audios ({audios.length})
              </TabsTrigger>
              <TabsTrigger value="campaigns" className="flex items-center gap-2">
                <Volume2 className="h-4 w-4" />
                Campañas ({campaigns.length})
              </TabsTrigger>
            </TabsList>

            {/* Tab de Audios */}
            <TabsContent value="audios">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Mis Audios</CardTitle>
                  <Button
                    onClick={() => setUploadModalOpen(true)}
                    disabled={!driveStatus?.connected}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Subir Audio
                  </Button>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : audios.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Music className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                      <p>No tienes audios aún</p>
                      <p className="text-sm">Sube cortinas, efectos o música</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {audios.map(audio => (
                        <div
                          key={audio.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => playAudio(audio.audio, audio.id)}
                              className="p-2 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200"
                            >
                              {playingId === audio.id ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </button>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{audio.nombre}</p>
                                <span className="text-xs text-green-600 flex items-center gap-1">
                                  <HardDrive className="h-3 w-3" />
                                  Drive
                                </span>
                              </div>
                              <p className="text-xs text-gray-500">
                                {tipoLabels[audio.tipo] || audio.tipo} • {audio.duracion}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteAudio(audio.id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Tab de Campañas */}
            <TabsContent value="campaigns">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>Campañas Publicitarias</CardTitle>
                  <Button
                    onClick={() => setCampaignModalOpen(true)}
                    disabled={!driveStatus?.connected}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Nueva Campaña
                  </Button>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                    </div>
                  ) : campaigns.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Volume2 className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                      <p>No tienes campañas aún</p>
                      <p className="text-sm">Crea campañas publicitarias para tus noticieros</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {campaigns.map(campaign => (
                        <div
                          key={campaign.id}
                          className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                        >
                          <div className="flex items-center gap-3">
                            {campaign.url_audio && (
                              <button
                                onClick={() => playAudio(campaign.url_audio, campaign.id)}
                                className="p-2 rounded-full bg-purple-100 text-purple-600 hover:bg-purple-200"
                              >
                                {playingId === campaign.id ? (
                                  <Pause className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-medium text-sm">{campaign.nombre}</p>
                                {campaign.esta_activo && (
                                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                                    Activa
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-500">
                                {campaign.duracion_segundos}s •
                                {new Date(campaign.fecha_inicio).toLocaleDateString()} -
                                {new Date(campaign.fecha_fin).toLocaleDateString()}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => deleteCampaign(campaign.id)}
                            className="p-2 text-red-500 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>

        <UploadAudioModal
          open={uploadModalOpen}
          onOpenChange={setUploadModalOpen}
          onUploadSuccess={() => {
            loadData()
            toast.success('Audio subido a Google Drive')
          }}
        />

        <CreateCampaignModal
          open={campaignModalOpen}
          onOpenChange={setCampaignModalOpen}
          onSuccess={() => {
            loadData()
          }}
        />
      </div>
    </ProtectedRoute>
  )
}
