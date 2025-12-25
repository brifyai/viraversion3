'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, HardDrive, CheckCircle, XCircle, ExternalLink, Unlink, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface GoogleStatus {
    connected: boolean
    email: string | null
    connectedAt: string | null
    isOwnAccount: boolean
    canModify: boolean
}

interface GoogleDriveCardProps {
    onStatusChange?: (connected: boolean) => void
}

export function GoogleDriveCard({ onStatusChange }: GoogleDriveCardProps) {
    const [status, setStatus] = useState<GoogleStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [disconnecting, setDisconnecting] = useState(false)

    useEffect(() => {
        loadStatus()
    }, [])

    async function loadStatus() {
        try {
            setLoading(true)
            const res = await fetch('/api/integrations/google', { credentials: 'include' })
            if (res.ok) {
                const data = await res.json()
                setStatus(data)
                onStatusChange?.(data.connected)
            }
        } catch (err) {
            console.error('Error cargando estado Google:', err)
        } finally {
            setLoading(false)
        }
    }

    async function handleDisconnect() {
        if (!confirm('¿Estás seguro de desvincular Google Drive? Los archivos existentes no se eliminarán.')) {
            return
        }

        try {
            setDisconnecting(true)
            const res = await fetch('/api/integrations/google', {
                method: 'DELETE',
                credentials: 'include'
            })

            if (res.ok) {
                setStatus({
                    connected: false,
                    email: null,
                    connectedAt: null,
                    isOwnAccount: false,
                    canModify: status?.canModify || false
                })
                onStatusChange?.(false)
            }
        } catch (err) {
            console.error('Error desvinculando:', err)
        } finally {
            setDisconnecting(false)
        }
    }

    return (
        <Card className="border-2 hover:border-blue-200 transition-colors">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <HardDrive className="h-5 w-5 text-blue-600" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Google Drive</CardTitle>
                            <CardDescription className="text-xs">
                                Almacena archivos de audio en la nube
                            </CardDescription>
                        </div>
                    </div>
                    {loading ? (
                        <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    ) : status?.connected ? (
                        <Badge className="bg-green-100 text-green-700 hover:bg-green-100 text-xs">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Conectado
                        </Badge>
                    ) : (
                        <Badge variant="secondary" className="text-xs">
                            <XCircle className="h-3 w-3 mr-1" />
                            No conectado
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="pt-0">
                {loading ? (
                    <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                ) : status?.connected ? (
                    <div className="space-y-3">
                        <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Cuenta:</span>
                                <span className="font-medium truncate ml-2">{status.email}</span>
                            </div>
                            {!status.isOwnAccount && (
                                <div className="flex items-center gap-1 text-xs text-amber-600">
                                    <AlertCircle className="h-3 w-3" />
                                    Usando cuenta del administrador
                                </div>
                            )}
                        </div>

                        {status.canModify && status.isOwnAccount && (
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50 flex-1"
                                    onClick={handleDisconnect}
                                    disabled={disconnecting}
                                >
                                    {disconnecting ? (
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                        <>
                                            <Unlink className="h-3 w-3 mr-1" />
                                            Desvincular
                                        </>
                                    )}
                                </Button>
                                <a
                                    href="https://drive.google.com/drive/folders"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center text-xs text-blue-600 hover:underline"
                                >
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-xs text-gray-500">
                            Vincula para guardar cortinas y publicidad en tu Drive.
                        </p>

                        {status?.canModify ? (
                            <Button
                                asChild
                                size="sm"
                                className="w-full bg-blue-600 hover:bg-blue-700"
                            >
                                <Link href="/api/auth/google">
                                    <HardDrive className="h-3 w-3 mr-2" />
                                    Vincular Google Drive
                                </Link>
                            </Button>
                        ) : (
                            <p className="text-xs text-amber-600">
                                <AlertCircle className="h-3 w-3 inline mr-1" />
                                Solo tu administrador puede vincular
                            </p>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
