
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function checkData() {
    console.log('Checking regions...')
    const { data: regions, error: regionsError } = await supabase
        .from('configuraciones_regiones')
        .select('region')

    if (regionsError) console.error('Error fetching regions:', regionsError.message)
    else console.log('Regions found:', regions?.length, regions)

    console.log('\nChecking radios...')
    const { data: radios, error: radiosError } = await supabase
        .from('radios')
        .select('nombre, region')

    if (radiosError) console.error('Error fetching radios:', radiosError.message)
    else console.log('Radios found:', radios?.length, radios)
}

checkData()
