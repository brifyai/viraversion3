import { createSupabaseServer } from '@/lib/supabase-server'
import { Navigation } from '@/components/navigation'
import { DashboardByRole } from '@/components/dashboard/dashboard-by-role'

export default async function DashboardPage() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()

  // Obtener rol del usuario desde la tabla users
  let userRole = 'user'
  if (user) {
    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()
    userRole = userData?.role || user.user_metadata?.role || 'user'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <DashboardByRole role={userRole} />
      </main>
    </div>
  )
}
