'use client'

import { useState, useEffect, createContext, useContext, useMemo, useRef } from 'react'
import { createSupabaseBrowser } from '@/lib/supabase'
import type { User } from '@supabase/supabase-js'

interface UserData {
    id: string
    email: string
    role: 'super_admin' | 'admin' | 'operator' | 'user'
    nombre_completo?: string
}

interface SupabaseUserContextType {
    user: User | null
    userData: UserData | null
    isLoading: boolean
    signOut: () => Promise<void>
}

const SupabaseUserContext = createContext<SupabaseUserContextType>({
    user: null,
    userData: null,
    isLoading: true,
    signOut: async () => { }
})

export function SupabaseUserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [userData, setUserData] = useState<UserData | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const initializedRef = useRef(false)

    // Memoize Supabase client to prevent recreation on each render
    const supabase = useMemo(() => createSupabaseBrowser(), [])

    useEffect(() => {
        // Guard against duplicate initialization (React StrictMode double-mount)
        if (initializedRef.current) return
        initializedRef.current = true

        // Obtener sesión inicial
        const getUser = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                setUser(user)

                if (user) {
                    // Intentar obtener datos de la tabla users
                    // Nota: Buscamos por email porque la tabla users tiene su propio UUID
                    // Solo seleccionamos columnas que existen en la DB
                    const { data: userData, error } = await supabase
                        .from('users')
                        .select('id, email, role, nombre_completo')
                        .eq('email', user.email)
                        .single()

                    if (userData && !error) {
                        setUserData(userData as UserData)
                    } else {
                        // Fallback: usar metadata del usuario de Supabase Auth
                        console.warn('[useSupabaseUser] Error fetching user data from users table:', error?.message)
                        console.log('[useSupabaseUser] Using user_metadata fallback')
                        const metadata = user.user_metadata
                        setUserData({
                            id: user.id,
                            email: user.email || '',
                            role: (metadata?.role as 'super_admin' | 'admin' | 'operator' | 'user') || 'user',
                            nombre_completo: metadata?.full_name || user.email
                        })
                    }
                }
            } catch (error) {
                console.error('[useSupabaseUser] Error in getUser:', error)
            } finally {
                setIsLoading(false)
            }
        }

        getUser()

        // Escuchar cambios de autenticación
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, session) => {
                setUser(session?.user ?? null)

                if (session?.user) {
                    // Nota: Buscamos por email porque la tabla users tiene su propio UUID
                    // Solo seleccionamos columnas que existen en la DB
                    const { data: userData, error } = await supabase
                        .from('users')
                        .select('id, email, role, nombre_completo')
                        .eq('email', session.user.email)
                        .single()

                    if (userData && !error) {
                        setUserData(userData as UserData)
                    } else {
                        // Fallback: usar metadata del usuario
                        const metadata = session.user.user_metadata
                        setUserData({
                            id: session.user.id,
                            email: session.user.email || '',
                            role: (metadata?.role as 'super_admin' | 'admin' | 'operator' | 'user') || 'user',
                            nombre_completo: metadata?.full_name || session.user.email
                        })
                    }
                } else {
                    setUserData(null)
                }

                setIsLoading(false)
            }
        )

        return () => {
            subscription.unsubscribe()
        }
    }, [])

    const handleSignOut = async () => {
        await supabase.auth.signOut()
        setUser(null)
        setUserData(null)
        window.location.href = '/auth/signin'
    }

    return (
        <SupabaseUserContext.Provider value={{ user, userData, isLoading, signOut: handleSignOut }}>
            {children}
        </SupabaseUserContext.Provider>
    )
}

/**
 * Hook para obtener el usuario de Supabase Auth
 * Reemplaza a useSession de NextAuth
 */
export function useSupabaseUser() {
    const context = useContext(SupabaseUserContext)

    return {
        user: context.user,
        userData: context.userData,
        isLoading: context.isLoading,
        signOut: context.signOut,
        // Compatibilidad con el formato de NextAuth
        session: context.user ? {
            user: {
                id: context.userData?.id || context.user.id,
                email: context.user.email,
                name: context.userData?.nombre_completo || context.user.email,
                role: context.userData?.role || 'user'
            }
        } : null
    }
}
