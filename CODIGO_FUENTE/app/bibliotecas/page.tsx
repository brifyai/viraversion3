
'use client'

import { useState, useEffect } from 'react'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Upload, Music, Edit, Trash2, Volume2, Play, Pause, Mic } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Swal from 'sweetalert2'
import { CreateCampaignModal } from './components/CreateCampaignModal'
import { UploadAudioModal } from './components/UploadAudioModal'

// Interfaces para los datos de Supabase
interface AudioLibraryItem {
  id: string
  nombre: string
  audio: string
  tipo: string
  duracion?: string
  genero?: string
  idioma?: string
  descripcion?: string
  // Nuevo campo opcional para reflejar la columna recientemente agregada
  usuario?: string
}

interface AdCampaign {
  id: string
  nombre: string
  url_audio?: string
  descripcion?: string
  duracion_segundos?: number
  fecha_inicio?: string
  fecha_fin?: string
  estado?: string
  created_at?: string
  user_id?: string
}

interface VoiceLibraryItem {
  id: string
  nombre: string
  audio: string
  tipo: string
  genero?: string
  idioma?: string
  duracion?: string
  descripcion?: string
}



export default function BibliotecasPage() {
  const [activeTab, setActiveTab] = useState('publicidad-campanas')
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([])
  const [audioLibrary, setAudioLibrary] = useState<AudioLibraryItem[]>([])
  const [voiceLibrary, setVoiceLibrary] = useState<VoiceLibraryItem[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Estados para el reproductor de audio
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null)
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  // Estado para permisos de usuario
  const [userRole, setUserRole] = useState<'admin' | 'operator' | 'user'>('user')
  const [canUploadGlobal, setCanUploadGlobal] = useState(false)
  const [isCreateCampaignOpen, setIsCreateCampaignOpen] = useState(false)
  const [isUploadAudioOpen, setIsUploadAudioOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string>('')



  // Limpiar audio al desmontar el componente
  useEffect(() => {
    return () => {
      if (currentAudio) {
        currentAudio.pause()
        currentAudio.currentTime = 0
      }
    }
  }, [currentAudio])

  // Obtener datos de Supabase al cargar el componente
  useEffect(() => {
    const obtenerDatos = async () => {
      try {
        setLoading(true)
        setError(null)

        // Leer email y rol del usuario desde localStorage
        let storedEmail: string | null = null
        let storedRole: string | null = null
        try {
          storedEmail = typeof window !== 'undefined' ? localStorage.getItem('vira_user_email') : null
          storedRole = typeof window !== 'undefined' ? localStorage.getItem('vira_user_role') : null
        } catch (e) {
          console.warn('[Bibliotecas] No se pudo leer datos de LocalStorage:', e)
        }

        // Establecer rol y permisos
        const role = (storedRole as 'admin' | 'operator' | 'user') || 'user'
        setUserRole(role)
        setCanUploadGlobal(role === 'admin') // Solo admins pueden subir archivos globales
        setUserEmail(storedEmail || '')

        // Construir consulta a la biblioteca de audio, filtrando por la columna "usuario"
        let audioQuery = supabase
          .from('biblioteca_audio')
          .select('*')

        if (storedEmail && storedEmail.trim() !== '') {
          // Incluir registros del usuario y los globales (usuario = "todos")
          audioQuery = audioQuery.or(`usuario.eq.${storedEmail},usuario.eq.todos`)
        }

        const { data: audioData, error: audioError } = await audioQuery
          .order('id', { ascending: false })

        if (audioError) {
          console.error('Error al obtener biblioteca de audio:', audioError)
          setError('Error al cargar la biblioteca de audio')
        } else {
          setAudioLibrary(audioData || [])
        }

        // Obtener campañas publicitarias reales
        try {
          const response = await fetch('/api/campaigns')
          if (response.ok) {
            const campaignData = await response.json()
            setCampaigns(campaignData || [])
          } else {
            console.error('Error al obtener campañas (API):', response.statusText)
          }
        } catch (apiError) {
          console.error('Error de red al obtener campañas:', apiError)
        }

      } catch (err) {
        console.error('Error general:', err)
        setError('Error al conectar con la base de datos')
      } finally {
        setLoading(false)
      }
    }

    obtenerDatos()
  }, [])

  // Función para subir archivo usando API local (guarda en public/audio/[usuario])
  const subirArchivo = async (nombre: string, archivo: File, tipo: string) => {
    try {
      // Obtener email del usuario desde localStorage
      let storedEmail: string | null = null
      try {
        storedEmail = typeof window !== 'undefined' ? localStorage.getItem('vira_user_email') : null
      } catch (e) {
        console.warn('[subirArchivo] No se pudo leer vira_user_email de LocalStorage:', e)
      }

      // Crear FormData para la API
      const formData = new FormData()
      formData.append('file', archivo)
      formData.append('nombre', nombre)
      formData.append('tipo', tipo)
      formData.append('global', 'false')

      // Subir usando API local
      const response = await fetch('/api/upload-audio', {
        method: 'POST',
        headers: {
          'x-user-email': storedEmail || 'anonymous'
        },
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al subir archivo')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Error al subir archivo')
      }

      return result.data
    } catch (error) {
      console.error('Error en subirArchivo:', error)
      throw error
    }
  }

  // Función para subir archivo global (solo super-admin)
  const subirArchivoGlobal = async (nombre: string, archivo: File, tipo: string) => {
    try {
      // Crear FormData para la API
      const formData = new FormData()
      formData.append('file', archivo)
      formData.append('nombre', nombre)
      formData.append('tipo', tipo)
      formData.append('global', 'true')

      // Subir usando API local
      const response = await fetch('/api/upload-audio', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Error al subir archivo')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Error al subir archivo')
      }

      return result.data
    } catch (error) {
      console.error('Error en subirArchivoGlobal:', error)
      throw error
    }
  }

  const handleUploadAudio = (tabType: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.multiple = true
    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files
      if (files && files.length > 0) {
        try {
          const fileList = Array.from(files)

          // Validar archivos
          const validFiles = fileList.filter(file => file.type.startsWith('audio/'))
          const invalidFiles = fileList.filter(file => !file.type.startsWith('audio/'))

          if (invalidFiles.length > 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Archivos no válidos',
              html: `❌ Los siguientes archivos no son válidos:<br>${invalidFiles.map(f => f.name).join('<br>')}`
            })
            return
          }

          if (validFiles.length === 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Sin archivos válidos',
              text: '❌ No se seleccionaron archivos de audio válidos'
            })
            return
          }

          await Swal.fire({
            icon: 'info',
            title: 'Subiendo archivos',
            text: `⏳ Subiendo ${validFiles.length} archivo(s)...`,
            timer: 1500,
            showConfirmButton: false
          })

          // Subir archivos a Supabase
          const uploadPromises = validFiles.map(async (file) => {
            const nombre = file.name.replace(/\.[^/.]+$/, '')
            let tipo = 'musica'

            if (tabType === 'publicidad-campanas') {
              tipo = 'campaña'
            } else if (tabType === 'voces') {
              tipo = 'voz'
            }

            try {
              const result = await subirArchivo(nombre, file, tipo)
              return {
                success: true,
                name: nombre,
                size: file.size,
                data: result
              }
            } catch (error) {
              return {
                success: false,
                name: nombre,
                error: error
              }
            }
          })

          const results = await Promise.all(uploadPromises)
          const successful = results.filter(r => r.success)
          const failed = results.filter(r => !r.success)

          if (successful.length > 0) {
            // Actualizar el estado local
            if (tabType === 'musica-efectos') {
              const newAudioItems = successful.map(r => r.data).filter(Boolean)
              setAudioLibrary(prev => [...newAudioItems, ...prev])
            } else if (tabType === 'voces') {
              const newAudioItems = successful.map(r => r.data).filter(Boolean)
              setAudioLibrary(prev => [...newAudioItems, ...prev])
            }

            await Swal.fire({
              icon: 'success',
              title: 'Subida exitosa',
              html: `✅ ${successful.length} archivo(s) subido(s) exitosamente!<br><br>📂 Archivos procesados:<br>${successful.map(r => `• ${r.name} (${Math.floor((r.size || 0) / 1024)}KB)`).join('<br>')}`
            })
          }

          if (failed.length > 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Fallos en subida',
              html: `❌ ${failed.length} archivo(s) fallaron:<br>${failed.map(r => `• ${r.name}`).join('<br>')}`
            })
          }

        } catch (error) {
          console.error('Error al procesar archivos:', error)
          await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: '❌ Error al procesar los archivos de audio'
          })
        }
      }
    }
    input.click()
  }

  // Función para subir archivos globales (solo super-admin)
  const handleUploadGlobalAudio = (tabType: string) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'audio/*'
    input.multiple = true
    input.onchange = async (event) => {
      const files = (event.target as HTMLInputElement).files
      if (files && files.length > 0) {
        try {
          const fileList = Array.from(files)

          // Validar archivos
          const validFiles = fileList.filter(file => file.type.startsWith('audio/'))
          const invalidFiles = fileList.filter(file => !file.type.startsWith('audio/'))

          if (invalidFiles.length > 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Archivos no válidos',
              html: `❌ Los siguientes archivos no son válidos:<br>${invalidFiles.map(f => f.name).join('<br>')}`
            })
            return
          }

          if (validFiles.length === 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Sin archivos válidos',
              text: '❌ No se seleccionaron archivos de audio válidos'
            })
            return
          }

          await Swal.fire({
            icon: 'info',
            title: 'Subiendo archivos globales',
            text: `⏳ Subiendo ${validFiles.length} archivo(s) para todos los usuarios...`,
            timer: 1500,
            showConfirmButton: false
          })

          // Subir archivos a Supabase con usuario = "todos"
          const uploadPromises = validFiles.map(async (file) => {
            const nombre = file.name.replace(/\.[^/.]+$/, '')
            let tipo = 'musica'

            if (tabType === 'publicidad-campanas') {
              tipo = 'campaña'
            } else if (tabType === 'voces') {
              tipo = 'voz'
            }

            try {
              const result = await subirArchivoGlobal(nombre, file, tipo)
              return {
                success: true,
                name: nombre,
                size: file.size,
                data: result
              }
            } catch (error) {
              return {
                success: false,
                name: nombre,
                error: error
              }
            }
          })

          const results = await Promise.all(uploadPromises)
          const successful = results.filter(r => r.success)
          const failed = results.filter(r => !r.success)

          if (successful.length > 0) {
            // Actualizar el estado local
            const newAudioItems = successful.map(r => r.data).filter(Boolean)
            setAudioLibrary(prev => [...newAudioItems, ...prev])

            await Swal.fire({
              icon: 'success',
              title: 'Subida global exitosa',
              html: `✅ ${successful.length} archivo(s) subido(s) exitosamente para todos los usuarios!<br><br>📂 Archivos procesados:<br>${successful.map(r => `• ${r.name} (${Math.floor((r.size || 0) / 1024)}KB)`).join('<br>')}`
            })
          }

          if (failed.length > 0) {
            await Swal.fire({
              icon: 'error',
              title: 'Fallos en subida global',
              html: `❌ ${failed.length} archivo(s) fallaron:<br>${failed.map(r => `• ${r.name}`).join('<br>')}`
            })
          }

        } catch (error) {
          console.error('Error al procesar archivos globales:', error)
          await Swal.fire({
            icon: 'error',
            title: 'Error',
            text: '❌ Error al procesar los archivos de audio globales'
          })
        }
      }
    }
    input.click()
  }

  const handleEditCampaign = async (campaignId: string) => {
    const campaign = campaigns.find(c => c.id === campaignId)
    if (!campaign) {
      await Swal.fire({ icon: 'error', title: 'No encontrada', text: '❌ Campaña no encontrada' })
      return
    }

    const { isConfirmed, value } = await Swal.fire({
      title: 'Editar campaña',
      input: 'text',
      inputLabel: 'Nuevo nombre de la campaña',
      inputValue: campaign.name,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputAttributes: { 'aria-label': 'Nuevo nombre de la campaña' },
      preConfirm: (val) => {
        const v = (val || '').trim()
        if (!v) {
          Swal.showValidationMessage('El nombre no puede estar vacío')
          return
        }
        return v
      }
    })
    if (isConfirmed) {
      const newName = (value || '').trim()
      setCampaigns(prev =>
        prev.map(c =>
          c.id === campaignId
            ? { ...c, name: newName }
            : c
        )
      )
      await Swal.fire({ icon: 'success', title: 'Campaña actualizada', text: `✅ Campaña "${campaign.name}" actualizada a "${newName}"` })
    }
  }

  const handleDeleteCampaign = async (campaignId: string) => {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'Eliminar campaña',
      text: '¿Estás seguro de que deseas eliminar esta campaña?',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (isConfirmed) {
      setCampaigns(prev => prev.filter(c => c.id !== campaignId))
    }
  }

  const handleEditAudio = async (audioId: string) => {
    const audio = audioLibrary.find(a => a.id === audioId)
    if (!audio) {
      await Swal.fire({ icon: 'error', title: 'No encontrado', text: '❌ Audio no encontrado' })
      return
    }

    const { isConfirmed, value } = await Swal.fire({
      title: 'Editar audio',
      input: 'text',
      inputLabel: 'Nuevo nombre del audio',
      inputValue: audio.nombre,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputAttributes: { 'aria-label': 'Nuevo nombre del audio' },
      preConfirm: (val) => {
        const v = (val || '').trim()
        if (!v) {
          Swal.showValidationMessage('El nombre no puede estar vacío')
          return
        }
        return v
      }
    })

    if (!isConfirmed) {
      return
    }

    const newName = (value || '').trim()
    if (!newName || newName === audio.nombre) {
      if (newName === audio.nombre) {
        await Swal.fire({ icon: 'info', title: 'Sin cambios', text: 'El nombre es el mismo.' })
      }
      return
    }

    // Actualizar en Supabase
    const { error: updateError } = await supabase
      .from('biblioteca_audio')
      .update({ nombre: newName })
      .eq('id', audioId)

    if (updateError) {
      console.error('Error al actualizar nombre en Supabase:', updateError)
      await Swal.fire({ icon: 'error', title: 'No se pudo actualizar', text: '❌ Error al guardar el nuevo nombre en la base de datos.' })
      return
    }

    // Actualizar estado local
    setAudioLibrary(prev =>
      prev.map(a =>
        a.id === audioId
          ? { ...a, nombre: newName }
          : a
      )
    )

    await Swal.fire({ icon: 'success', title: 'Audio actualizado', text: `✅ Audio "${audio.nombre}" actualizado a "${newName}"` })
  }

  const handlePlayAudio = (audioId: string) => {
    let audio: any = audioLibrary.find(a => a.id === audioId)
    let audioUrl = audio?.audio
    let audioName = audio?.nombre

    // Si no está en la biblioteca de audio, buscar en campañas
    if (!audio) {
      const campaign = campaigns.find(c => c.id === audioId)
      if (campaign) {
        audio = campaign
        audioUrl = campaign.url_audio
        audioName = campaign.nombre
      }
    }

    if (!audio || !audioUrl) {
      // Si es una campaña de texto, no se puede reproducir aquí (o quizás usar TTS en el futuro)
      if (audio && !audioUrl) {
        Swal.fire({ icon: 'info', title: 'Campaña de texto', text: 'ℹ️ Esta campaña es de texto y se convertirá a audio al generar el noticiero.' })
        return
      }
      Swal.fire({ icon: 'error', title: 'No encontrado', text: '❌ Audio no encontrado o sin URL' })
      return
    }

    // Si hay un audio reproduciéndose, detenerlo
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
    }

    // Si es el mismo audio que está reproduciéndose, pausarlo
    if (playingAudioId === audioId && isPlaying) {
      setIsPlaying(false)
      setPlayingAudioId(null)
      setCurrentAudio(null)
      return
    }

    try {
      // Crear nuevo elemento de audio
      const audioElement = new Audio(audioUrl)

      // Configurar eventos del audio
      audioElement.onloadstart = () => {
        console.log('Cargando audio:', audioName)
      }

      audioElement.oncanplay = () => {
        console.log('Audio listo para reproducir:', audioName)
      }

      audioElement.onplay = () => {
        setIsPlaying(true)
        setPlayingAudioId(audioId)
        console.log('Reproduciendo:', audioName)
      }

      audioElement.onpause = () => {
        setIsPlaying(false)
        console.log('Audio pausado:', audioName)
      }

      audioElement.onended = () => {
        setIsPlaying(false)
        setPlayingAudioId(null)
        setCurrentAudio(null)
        console.log('Audio terminado:', audioName)
      }

      audioElement.onerror = (e) => {
        console.error('Error al reproducir audio:', e)
        Swal.fire({ icon: 'error', title: 'Error al reproducir', text: `❌ Error al reproducir "${audioName}". Verifica que el archivo esté disponible.` })
        setIsPlaying(false)
        setPlayingAudioId(null)
        setCurrentAudio(null)
      }

      // Configurar y reproducir
      setCurrentAudio(audioElement)
      audioElement.play().catch(error => {
        console.error('Error al iniciar reproducción:', error)
        Swal.fire({ icon: 'error', title: 'No se pudo reproducir', text: `❌ No se pudo reproducir "${audioName}". ${error.message}` })
      })

    } catch (error) {
      console.error('Error al crear elemento de audio:', error)
      Swal.fire({ icon: 'error', title: 'Error al reproducir', text: `❌ Error al reproducir "${audioName}"` })
    }
  }

  const handleDeleteAudio = async (audioId: string) => {
    // Verificar si es una campaña
    const campaign = campaigns.find(c => c.id === audioId)
    const isCampaign = !!campaign

    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: isCampaign ? 'Eliminar campaña' : 'Eliminar audio',
      text: isCampaign ? '¿Estás seguro de que deseas eliminar esta campaña?' : '¿Estás seguro de que deseas eliminar este audio?',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    })

    if (!isConfirmed) return

    try {
      // Mostrar indicador de carga
      Swal.fire({
        title: 'Eliminando...',
        text: 'Por favor espera...',
        allowOutsideClick: false,
        didOpen: () => {
          Swal.showLoading()
        }
      })

      if (isCampaign) {
        // Eliminar campaña
        const { error: dbError } = await supabase
          .from('campanas_publicitarias')
          .delete()
          .eq('id', audioId)

        if (dbError) throw dbError

        // Si tiene audio asociado, intentar eliminarlo del storage (opcional, si queremos limpiar)
        if (campaign?.url_audio) {
          try {
            const urlParts = campaign.url_audio.split('/storage/v1/object/public/biblioteca_audio/')
            if (urlParts.length >= 2) {
              await supabase.storage.from('biblioteca_audio').remove([urlParts[1]])
            }
          } catch (e) {
            console.warn('No se pudo eliminar el archivo de audio de la campaña', e)
          }
        }

        setCampaigns(prev => prev.filter(c => c.id !== audioId))

      } else {
        // Lógica existente para eliminar audio de biblioteca_audio
        const audio = audioLibrary.find(a => a.id === audioId)
        if (!audio) throw new Error('Audio no encontrado')

        const audioUrl = audio.audio
        const urlParts = audioUrl.split('/storage/v1/object/public/biblioteca_audio/')
        if (urlParts.length < 2) throw new Error('URL del archivo no válida')
        const filePath = urlParts[1]

        const { error: storageError } = await supabase.storage
          .from('biblioteca_audio')
          .remove([filePath])

        if (storageError) throw new Error('Error al eliminar el archivo del almacenamiento')

        const { error: dbError } = await supabase
          .from('biblioteca_audio')
          .delete()
          .eq('audio', audioUrl)

        if (dbError) throw new Error('Error al eliminar el registro de la base de datos')

        setAudioLibrary(prev => prev.filter(a => a.id !== audioId))
      }

      await Swal.fire({
        icon: 'success',
        title: 'Eliminado',
        text: '✅ Elemento eliminado correctamente'
      })

    } catch (error: any) {
      console.error('Error al eliminar:', error)
      await Swal.fire({
        icon: 'error',
        title: 'Error',
        text: `❌ No se pudo eliminar: ${error.message || 'Error desconocido'}`
      })
    }
  }



  // Funciones para manejar voces
  const handleEditVoice = async (voiceId: string) => {
    const voice = voiceLibrary.find(v => v.id === voiceId)
    if (!voice) {
      await Swal.fire({ icon: 'error', title: 'No encontrada', text: '❌ Voz no encontrada' })
      return
    }

    const { isConfirmed, value } = await Swal.fire({
      title: 'Editar voz',
      input: 'text',
      inputLabel: 'Nuevo nombre de la voz',
      inputValue: voice.nombre,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      inputAttributes: { 'aria-label': 'Nuevo nombre de la voz' },
      preConfirm: (val: string) => {
        const v = (val || '').trim()
        if (!v) {
          Swal.showValidationMessage('El nombre no puede estar vacío')
          return
        }
        return v
      }
    })

    if (isConfirmed) {
      const newName = (value || '').trim()
      setVoiceLibrary(prev =>
        prev.map(v =>
          v.id === voiceId
            ? { ...v, nombre: newName }
            : v
        )
      )
      await Swal.fire({ icon: 'success', title: 'Voz actualizada', text: `✅ Voz "${voice.nombre}" actualizada a "${newName}"` })
    }
  }

  const handlePlayVoice = (voiceId: string) => {
    const voice = voiceLibrary.find(v => v.id === voiceId)
    if (!voice) {
      console.error('❌ Voz no encontrada')
      return
    }

    // Si hay un audio reproduciéndose, detenerlo
    if (currentAudio) {
      currentAudio.pause()
      currentAudio.currentTime = 0
    }

    // Si es la misma voz que está reproduciéndose, pausarla
    if (playingAudioId === voiceId && isPlaying) {
      setIsPlaying(false)
      setPlayingAudioId(null)
      setCurrentAudio(null)
      return
    }

    try {
      // Crear nuevo elemento de audio
      const audioElement = new Audio(voice.audio)

      // Configurar eventos del audio
      audioElement.onloadstart = () => {
        console.log('Cargando voz:', voice.nombre)
      }

      audioElement.oncanplay = () => {
        console.log('Voz lista para reproducir:', voice.nombre)
      }

      audioElement.onplay = () => {
        setIsPlaying(true)
        setPlayingAudioId(voiceId)
        console.log('Reproduciendo voz:', voice.nombre)
      }

      audioElement.onpause = () => {
        setIsPlaying(false)
        console.log('Voz pausada:', voice.nombre)
      }

      audioElement.onended = () => {
        setIsPlaying(false)
        setPlayingAudioId(null)
        setCurrentAudio(null)
        console.log('Voz terminada:', voice.nombre)
      }

      audioElement.onerror = (e) => {
        console.error('Error al reproducir voz:', e)
        console.error(`❌ Error al reproducir "${voice.nombre}". Verifica que el archivo esté disponible.`)
        setIsPlaying(false)
        setPlayingAudioId(null)
        setCurrentAudio(null)
      }

      // Configurar y reproducir
      setCurrentAudio(audioElement)
      audioElement.play().catch(error => {
        console.error('Error al iniciar reproducción:', error)
        console.error(`❌ No se pudo reproducir "${voice.nombre}". ${error.message}`)
      })

    } catch (error) {
      console.error('Error al crear elemento de audio:', error)
      console.error(`❌ Error al reproducir "${voice.nombre}"`)
    }
  }

  const handleDeleteVoice = async (voiceId: string) => {
    const { isConfirmed } = await Swal.fire({
      icon: 'warning',
      title: 'Eliminar voz',
      text: '¿Estás seguro de que deseas eliminar esta voz?',
      showCancelButton: true,
      confirmButtonText: 'Eliminar',
      cancelButtonText: 'Cancelar'
    })
    if (isConfirmed) {
      setVoiceLibrary(prev => prev.filter(v => v.id !== voiceId))
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'music': return 'music'
      case 'jingle': return 'jingle'
      case 'sfx': return 'sfx'
      default: return type
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Biblioteca de Audio
          </h1>
        </div>

        {/* Tabs */}
        <Card className="bg-white">
          <CardContent className="p-0">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid w-full grid-cols-3 bg-gray-50 p-1 rounded-none">
                <TabsTrigger
                  value="publicidad-campanas"
                  className="data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
                >
                  <Volume2 className="h-4 w-4 mr-2" />
                  Publicidad y Campañas
                </TabsTrigger>
                <TabsTrigger
                  value="musica-efectos"
                  className="data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
                >
                  <Music className="h-4 w-4 mr-2" />
                  Música y Efectos
                </TabsTrigger>
                <TabsTrigger
                  value="voces"
                  className="data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:border-b-2 data-[state=active]:border-blue-600"
                >
                  <Mic className="h-4 w-4 mr-2" />
                  Voces
                </TabsTrigger>
              </TabsList>

              {/* Tab Content: Publicidad y Campañas */}
              <TabsContent value="publicidad-campanas" className="p-6">
                <div className="space-y-6">
                  {/* Banner Informativo */}
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h3 className="font-semibold text-red-900 mb-2">
                      Campañas Publicitarias Activas
                    </h3>
                    <p className="text-sm text-red-700">
                      Gestiona tus campañas publicitarias, spots y anuncios comerciales para tu radio.
                    </p>
                  </div>

                  {/* Lista de Campañas */}
                  <div className="space-y-3">
                    {campaigns.map(audio => (
                      <div key={audio.id} className={`flex items-center justify-between p-4 border rounded-lg transition-all duration-200 ${playingAudioId === audio.id && isPlaying
                        ? 'border-green-300 bg-green-50 shadow-sm'
                        : 'border-gray-200 hover:bg-gray-50'
                        }`}>
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <div className="h-8 w-8 bg-red-100 rounded-lg flex items-center justify-center">
                              <Volume2 className="h-4 w-4 text-red-600" />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className={`font-medium ${playingAudioId === audio.id && isPlaying
                                ? 'text-green-900'
                                : 'text-gray-900'
                                }`}>{audio.nombre}</h4>
                              {playingAudioId === audio.id && isPlaying && (
                                <span className="px-2 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium animate-pulse">
                                  📢 Reproduciendo
                                </span>
                              )}
                              <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs font-medium">
                                {audio.url_audio ? '🔊 Audio' : '📝 Texto'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-1">
                              {audio.descripcion || 'Sin descripción'}
                            </p>
                            <p className="text-xs text-gray-500">
                              Duración: {audio.duracion_segundos || 30}s
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          {audio.url_audio && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handlePlayAudio(audio.id)}
                              className={`h-8 w-8 p-0 hover:bg-green-50 ${playingAudioId === audio.id && isPlaying
                                ? 'bg-green-100 text-green-600'
                                : 'text-gray-600'
                                }`}
                            >
                              {playingAudioId === audio.id && isPlaying ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAudio(audio.id)}
                            className="h-8 w-8 p-0 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {campaigns.length === 0 && (
                      <p className="text-sm text-gray-500">No hay campañas disponibles aún.</p>
                    )}
                  </div>

                  {/* Botones Subir Nuevo Audio */}
                  <div className="flex justify-center gap-4 pt-4">
                    <Button
                      onClick={() => setIsCreateCampaignOpen(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Nueva Campaña
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Tab Content: Música y Efectos */}
              <TabsContent value="musica-efectos" className="p-6">
                <div className="space-y-6">
                  {/* Banner Informativo */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-900 mb-2">
                      Música y Efectos de Sonido
                    </h3>
                    <p className="text-sm text-blue-700">
                      Sube tus cortinas musicales, jingles y efectos para dar una identidad única a tus noticieros.
                    </p>
                  </div>

                  {/* Lista de Audios */}
                  <div className="space-y-3">
                    {audioLibrary.filter(a => ['cortina', 'musica', 'efecto', 'jingle', 'intro', 'outro'].includes(a.tipo)).map(audio => (
                      <div key={audio.id} className={`flex items-center justify-between p-4 border rounded-lg transition-all duration-200 ${playingAudioId === audio.id && isPlaying
                        ? 'border-green-300 bg-green-50 shadow-sm'
                        : audio.usuario === 'todos'
                          ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                          : 'border-gray-200 hover:bg-gray-50'
                        }`}>
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <div className="h-8 w-8 bg-purple-100 rounded-lg flex items-center justify-center">
                              <Music className="h-4 w-4 text-purple-600" />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className={`font-medium ${playingAudioId === audio.id && isPlaying
                                ? 'text-green-900'
                                : 'text-gray-900'
                                }`}>{audio.nombre}</h4>
                              {playingAudioId === audio.id && isPlaying && (
                                <span className="px-2 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium animate-pulse">
                                  🎵 Reproduciendo
                                </span>
                              )}
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${audio.tipo === 'publicidad'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                                }`}>
                                {audio.tipo === 'publicidad' ? '📢 Publicidad' : '🎵 Música'}
                              </span>
                            </div>
                            <p className="text-sm text-gray-600">
                              Duración: {audio.duracion}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePlayAudio(audio.id)}
                            className={`h-8 w-8 p-0 hover:bg-green-50 ${playingAudioId === audio.id && isPlaying
                              ? 'bg-green-100 text-green-600'
                              : 'text-gray-600'
                              }`}
                          >
                            {playingAudioId === audio.id && isPlaying ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditAudio(audio.id)}
                            className="h-8 w-8 p-0 hover:bg-gray-100"
                          >
                            <Edit className="h-4 w-4 text-gray-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAudio(audio.id)}
                            className="h-8 w-8 p-0 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {audioLibrary.filter(a => ['cortina', 'musica', 'efecto', 'jingle', 'intro', 'outro'].includes(a.tipo)).length === 0 && (
                      <p className="text-sm text-gray-500">No hay música disponible aún.</p>
                    )}
                  </div>

                  {/* Botones Subir Nuevo Audio */}
                  <div className="flex justify-center gap-4 pt-4">
                    <Button
                      onClick={() => setIsUploadAudioOpen(true)}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Subir Nuevo Audio
                    </Button>
                    {canUploadGlobal && (
                      <Button
                        onClick={() => handleUploadGlobalAudio('musica-efectos')}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-6"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Subir Audio Global
                      </Button>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Tab Content: Voces */}
              <TabsContent value="voces" className="p-6">
                <div className="space-y-6">
                  {/* Banner Informativo */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h3 className="font-semibold text-green-900 mb-2">
                      Biblioteca de Voces
                    </h3>
                    <p className="text-sm text-green-700">
                      Gestiona tus voces personalizadas, locutores y narradores para dar vida a tus noticieros.
                    </p>
                  </div>

                  {/* Lista de Voces */}
                  <div className="space-y-3">
                    {audioLibrary.filter(a => a.tipo === 'voz').map(audio => (
                      <div key={audio.id} className={`flex items-center justify-between p-4 border rounded-lg transition-all duration-200 ${playingAudioId === audio.id && isPlaying
                        ? 'border-green-300 bg-green-50 shadow-sm'
                        : audio.usuario === 'todos'
                          ? 'border-blue-200 bg-blue-50 hover:bg-blue-100'
                          : 'border-gray-200 hover:bg-gray-50'
                        }`}>
                        <div className="flex items-center space-x-4">
                          <div className="flex-shrink-0">
                            <div className="h-8 w-8 bg-green-100 rounded-lg flex items-center justify-center">
                              <Mic className="h-4 w-4 text-green-600" />
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className={`font-medium ${playingAudioId === audio.id && isPlaying
                                ? 'text-green-900'
                                : 'text-gray-900'
                                }`}>{audio.nombre}</h4>
                              {playingAudioId === audio.id && isPlaying && (
                                <span className="px-2 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium animate-pulse">
                                  🎤 Reproduciendo
                                </span>
                              )}
                              <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">
                                🎤 Voz
                              </span>
                              {audio.genero && (
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                                  {audio.genero === 'masculino' ? '👨 Masculino' : '👩 Femenino'}
                                </span>
                              )}
                              {audio.idioma && (
                                <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                                  🌐 {audio.idioma}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-gray-600">
                              {audio.descripcion && `${audio.descripcion} • `}
                              Duración: {audio.duracion || 'N/A'}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handlePlayAudio(audio.id)}
                            className={`h-8 w-8 p-0 hover:bg-green-50 ${playingAudioId === audio.id && isPlaying
                              ? 'bg-green-100 text-green-600'
                              : 'text-gray-600'
                              }`}
                          >
                            {playingAudioId === audio.id && isPlaying ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleEditAudio(audio.id)}
                            className="h-8 w-8 p-0 hover:bg-gray-100"
                          >
                            <Edit className="h-4 w-4 text-gray-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteAudio(audio.id)}
                            className="h-8 w-8 p-0 hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      </div>
                    ))}

                    {/* Mensaje cuando no hay voces */}
                    {audioLibrary.filter(a => a.tipo === 'voz').length === 0 && (
                      <div className="text-center py-8">
                        <Mic className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-gray-900 mb-2">
                          No hay voces en tu biblioteca
                        </h3>
                        <p className="text-gray-600 mb-4">
                          Sube tus primeras voces para comenzar a crear contenido personalizado.
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Botones Subir Nuevo Audio */}
                  <div className="flex justify-center gap-4 pt-4">
                    <Button
                      onClick={() => handleUploadAudio('voces')}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Subir Nueva Voz
                    </Button>
                    {canUploadGlobal && (
                      <Button
                        onClick={() => handleUploadGlobalAudio('voces')}
                        className="bg-orange-600 hover:bg-orange-700 text-white px-6"
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Subir Voz Global
                      </Button>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>

      <CreateCampaignModal
        open={isCreateCampaignOpen}
        onOpenChange={setIsCreateCampaignOpen}
        onSuccess={() => {
          // Recargar datos
          window.location.reload() // Simple reload for now, or refetch
        }}
      />

      <UploadAudioModal
        open={isUploadAudioOpen}
        onOpenChange={setIsUploadAudioOpen}
        userEmail={userEmail}
        onUploadSuccess={(data) => {
          // Agregar el nuevo audio a la lista
          setAudioLibrary(prev => [data, ...prev])
          Swal.fire({
            icon: 'success',
            title: '¡Audio subido!',
            text: `"${data.nombre}" se agregó a tu biblioteca.`,
            timer: 2000,
            showConfirmButton: false
          })
        }}
      />
    </div>
  )
}
