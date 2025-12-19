import { NextPage } from 'next'
import Link from 'next/link'

interface ErrorProps {
    statusCode?: number
}

const Error: NextPage<ErrorProps> = ({ statusCode }) => {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            backgroundColor: '#f8fafc',
            color: '#1e293b'
        }}>
            <h1 style={{ fontSize: '6rem', fontWeight: 700, margin: 0, color: '#3b82f6' }}>
                {statusCode || 'Error'}
            </h1>
            <p style={{ fontSize: '1.25rem', color: '#64748b', marginTop: '1rem' }}>
                {statusCode === 404
                    ? 'Página no encontrada'
                    : statusCode === 500
                        ? 'Error interno del servidor'
                        : 'Ha ocurrido un error'}
            </p>
            <Link href="/" style={{
                marginTop: '2rem',
                padding: '0.75rem 1.5rem',
                backgroundColor: '#3b82f6',
                color: 'white',
                borderRadius: '0.5rem',
                textDecoration: 'none',
                fontWeight: 500
            }}>
                Volver al inicio
            </Link>
        </div>
    )
}

Error.getInitialProps = ({ res, err }) => {
    const statusCode = res ? res.statusCode : err ? err.statusCode : 404
    return { statusCode }
}

export default Error
