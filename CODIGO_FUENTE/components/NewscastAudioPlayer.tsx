'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
    Play,
    Pause,
    Download,
    Loader2,
    SkipForward,
    SkipBack,
    Volume2,
    Music
} from 'lucide-react'
import { toast } from 'react-toastify'
import {
    concatenateAudioSegments,
    downloadBlob,
    AudioSegment,
    ConcatenationProgress
} from '@/lib/audio-concatenation'

interface TimelineItem {
    id: string
    title?: string
    audioUrl?: string
    duration?: number
    type?: string
    content?: string
}

interface NewscastAudioPlayerProps {
    timeline: TimelineItem[]
    newscastName?: string
}

export function NewscastAudioPlayer({ timeline, newscastName = 'noticiero' }: NewscastAudioPlayerProps) {
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentIndex, setCurrentIndex] = useState(0)
    const [isDownloading, setIsDownloading] = useState(false)
    const [downloadProgress, setDownloadProgress] = useState<ConcatenationProgress | null>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    // Filter items that have audio
    const audioItems = timeline.filter(item => item.audioUrl)
    const currentItem = audioItems[currentIndex]

    // Calculate total duration
    const totalDuration = audioItems.reduce((sum, item) => sum + (item.duration || 0), 0)

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.onended = () => {
                // Play next track
                if (currentIndex < audioItems.length - 1) {
                    setCurrentIndex(prev => prev + 1)
                } else {
                    setIsPlaying(false)
                    setCurrentIndex(0)
                }
            }
        }
    }, [currentIndex, audioItems.length])

    useEffect(() => {
        if (isPlaying && audioRef.current && currentItem?.audioUrl) {
            audioRef.current.src = currentItem.audioUrl
            audioRef.current.play().catch(err => {
                console.error('Error playing audio:', err)
                setIsPlaying(false)
            })
        }
    }, [currentIndex, isPlaying, currentItem?.audioUrl])

    const handlePlayPause = () => {
        if (!audioRef.current) return

        if (isPlaying) {
            audioRef.current.pause()
            setIsPlaying(false)
        } else {
            if (currentItem?.audioUrl) {
                audioRef.current.src = currentItem.audioUrl
                audioRef.current.play()
                    .then(() => {
                        setIsPlaying(true)
                    })
                    .catch(err => {
                        console.error('Error playing:', err)
                        // Si hay error CORS, abrir en nueva pestaña
                        window.open(currentItem.audioUrl, '_blank')
                        toast.info('Audio abierto en nueva pestaña')
                    })
            }
        }
    }

    const handleNext = () => {
        if (currentIndex < audioItems.length - 1) {
            setCurrentIndex(prev => prev + 1)
        }
    }

    const handlePrev = () => {
        if (currentIndex > 0) {
            setCurrentIndex(prev => prev - 1)
        }
    }

    const handleDownload = async () => {
        if (audioItems.length === 0) {
            toast.error('No hay audios para descargar')
            return
        }

        setIsDownloading(true)
        setDownloadProgress(null)

        try {
            const segments: AudioSegment[] = audioItems.map(item => ({
                url: item.audioUrl!,
                title: item.title || item.type || 'Audio',
                duration: item.duration
            }))

            const blob = await concatenateAudioSegments(segments, setDownloadProgress)

            const timestamp = new Date().toISOString().slice(0, 10)
            const filename = `${newscastName.replace(/\s+/g, '-')}_${timestamp}.wav`

            downloadBlob(blob, filename)
            toast.success('¡Audio descargado exitosamente!')
        } catch (error) {
            console.error('Download error:', error)
            toast.error('Error al descargar: ' + (error instanceof Error ? error.message : 'Error desconocido'))
        } finally {
            setIsDownloading(false)
            setDownloadProgress(null)
        }
    }

    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60)
        const secs = Math.floor(seconds % 60)
        return `${mins}:${secs.toString().padStart(2, '0')}`
    }

    if (audioItems.length === 0) {
        return null
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Hidden audio element */}
            <audio ref={audioRef} />

            {/* Header con info del track actual */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 border-b border-gray-100">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                            <Music className="h-6 w-6 text-blue-600" />
                        </div>
                        <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wide">
                                Track {currentIndex + 1} de {audioItems.length}
                            </p>
                            <h3 className="font-semibold text-gray-900 truncate max-w-xs">
                                {currentItem?.title || currentItem?.type || `Segmento ${currentIndex + 1}`}
                            </h3>
                        </div>
                    </div>
                    <div className="text-right">
                        <p className="text-sm text-gray-500">Duración total</p>
                        <p className="font-mono font-semibold text-gray-900">{formatDuration(totalDuration)}</p>
                    </div>
                </div>

                {/* Progress bar */}
                <div className="mt-4 flex gap-1">
                    {audioItems.map((_, idx) => (
                        <div
                            key={idx}
                            className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${idx < currentIndex
                                ? 'bg-green-500'
                                : idx === currentIndex
                                    ? 'bg-blue-500'
                                    : 'bg-gray-200'
                                }`}
                        />
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div className="p-4 flex items-center justify-center gap-4 bg-white">
                <Button
                    variant="outline"
                    size="icon"
                    onClick={handlePrev}
                    disabled={currentIndex === 0}
                    className="h-10 w-10 rounded-full"
                >
                    <SkipBack className="h-4 w-4" />
                </Button>

                <Button
                    size="lg"
                    onClick={handlePlayPause}
                    className="w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center"
                >
                    {isPlaying ? (
                        <Pause className="h-6 w-6" fill="white" />
                    ) : (
                        <Play className="h-6 w-6 ml-0.5" fill="white" />
                    )}
                </Button>

                <Button
                    variant="outline"
                    size="icon"
                    onClick={handleNext}
                    disabled={currentIndex === audioItems.length - 1}
                    className="h-10 w-10 rounded-full"
                >
                    <SkipForward className="h-4 w-4" />
                </Button>
            </div>

            {/* Playlist */}
            <div className="border-t border-gray-100 max-h-48 overflow-y-auto">
                <div className="p-2">
                    {audioItems.map((item, idx) => (
                        <button
                            key={item.id}
                            onClick={() => {
                                setCurrentIndex(idx)
                                if (isPlaying && audioRef.current) {
                                    audioRef.current.src = item.audioUrl!
                                    audioRef.current.play()
                                }
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${idx === currentIndex
                                ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                : 'hover:bg-gray-50 text-gray-700'
                                }`}
                        >
                            <div className="flex items-center gap-3">
                                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${idx === currentIndex
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gray-100 text-gray-600'
                                    }`}>
                                    {idx === currentIndex && isPlaying ? (
                                        <Volume2 className="h-3 w-3 animate-pulse" />
                                    ) : (
                                        idx + 1
                                    )}
                                </span>
                                <span className="truncate flex-1">
                                    {item.title || item.type || `Segmento ${idx + 1}`}
                                </span>
                                {item.duration && (
                                    <span className="text-xs text-gray-400 font-mono">
                                        {formatDuration(item.duration)}
                                    </span>
                                )}
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Download Section */}
            <div className="p-4 bg-gray-50 border-t border-gray-100">
                <Button
                    onClick={handleDownload}
                    disabled={isDownloading}
                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                    size="lg"
                >
                    {isDownloading ? (
                        <>
                            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                            {downloadProgress?.message || 'Procesando...'}
                        </>
                    ) : (
                        <>
                            <Download className="mr-2 h-5 w-5" />
                            Descargar Audio Completo ({formatDuration(totalDuration)})
                        </>
                    )}
                </Button>

                {downloadProgress && downloadProgress.stage === 'downloading' && (
                    <div className="mt-2 text-center text-sm text-gray-500">
                        Descargando {downloadProgress.current}/{downloadProgress.total} segmentos...
                    </div>
                )}
            </div>
        </div>
    )
}
