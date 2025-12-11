
'use client'

import { toast } from 'react-toastify'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Navigation } from '@/components/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { MercadoPagoButton } from '@/components/mercadopago-button'
import { PaymentSuccessModal } from '@/components/payment-success-modal'
import { 
  CreditCard, 
  Building2, 
  Shield, 
  Check, 
  ArrowLeft, 
  Clock,
  DollarSign,
  Truck,
  Zap,
  Crown,
  AlertCircle,
  ExternalLink,
  Copy,
  CheckCircle,
  FileText
} from 'lucide-react'

interface Plan {
  id: string
  name: string
  price: number
  currency: string
  interval: 'month' | 'year'
  features: string[]
  limits: {
    noticieros: number
    integraciones: number
    usuarios: number
    almacenamiento: string
  }
  popular?: boolean
  discount?: number
}

interface PaymentMethod {
  id: 'mercadopago' | 'transfer'
  name: string
  description: string
  processingTime: string
  icon: any
  enabled: boolean
}

const plans: Plan[] = [
  {
    id: 'basic',
    name: 'Plan Básico',
    price: 29900,
    currency: 'CLP',
    interval: 'month',
    features: [
      '100 noticieros por mes',
      '5 integraciones',
      'Soporte prioritario',
      '10GB almacenamiento',
      'Síntesis de voz premium'
    ],
    limits: {
      noticieros: 100,
      integraciones: 5,
      usuarios: 3,
      almacenamiento: '10GB'
    }
  },
  {
    id: 'pro',
    name: 'Plan Profesional',
    price: 59900,
    currency: 'CLP',
    interval: 'month',
    popular: true,
    features: [
      'Noticieros ilimitados',
      'Todas las integraciones',
      'Soporte 24/7',
      '100GB almacenamiento',
      'API personalizada',
      'Múltiples usuarios'
    ],
    limits: {
      noticieros: -1,
      integraciones: -1,
      usuarios: 10,
      almacenamiento: '100GB'
    }
  },
  {
    id: 'enterprise',
    name: 'Plan Empresarial',
    price: 149900,
    currency: 'CLP',
    interval: 'month',
    features: [
      'Todo el Plan Pro',
      'Usuarios ilimitados',
      'Almacenamiento ilimitado',
      'Soporte dedicado',
      'Implementación personalizada',
      'SLA garantizado'
    ],
    limits: {
      noticieros: -1,
      integraciones: -1,
      usuarios: -1,
      almacenamiento: 'Ilimitado'
    }
  }
]

const paymentMethods: PaymentMethod[] = [
  {
    id: 'mercadopago',
    name: 'MercadoPago',
    description: 'Tarjetas de crédito, débito y medios de pago locales',
    processingTime: 'Inmediato',
    icon: CreditCard,
    enabled: true
  },
  {
    id: 'transfer',
    name: 'Transferencia Bancaria',
    description: 'Transferencia directa a cuenta bancaria',
    processingTime: '1-2 días hábiles',
    icon: Building2,
    enabled: true
  }
]

const bankAccounts = [
  {
    bank: 'Banco de Chile',
    accountType: 'Cuenta Corriente',
    accountNumber: '12345678-9',
    rut: '76.123.456-7',
    email: 'pagos@vira.cl'
  },
  {
    bank: 'Banco Santander',
    accountType: 'Cuenta Corriente',
    accountNumber: '98765432-1',
    rut: '76.123.456-7',
    email: 'pagos@vira.cl'
  }
]

function PagosContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const planId = searchParams.get('plan')
  
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null)
  const [paymentMethod, setPaymentMethod] = useState<'mercadopago' | 'transfer'>('mercadopago')
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentStep, setPaymentStep] = useState<'select' | 'process' | 'success' | 'pending'>('select')
  const [mpPreferenceId, setMpPreferenceId] = useState<string>('')
  const [transferReference, setTransferReference] = useState<string>('')
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [paymentData, setPaymentData] = useState<any>(null)

  // Datos del formulario de facturación
  const [billingData, setBillingData] = useState({
    name: 'Juan Pérez',
    email: 'juan@radioexample.cl',
    company: 'Radio Ejemplo FM',
    rut: '76.123.456-7',
    address: 'Av. Providencia 123',
    city: 'Santiago',
    region: 'Región Metropolitana',
    phone: '+56 9 1234 5678'
  })

  useEffect(() => {
    if (planId) {
      const plan = plans.find(p => p.id === planId)
      if (plan) {
        setSelectedPlan(plan)
      }
    }
  }, [planId])

  const formatCurrency = (amount: number, currency: string = 'CLP') => {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: currency
    }).format(amount)
  }

  const calculateTotal = () => {
    if (!selectedPlan) return 0
    const subtotal = selectedPlan.price
    const iva = subtotal * 0.19
    return subtotal + iva
  }

  const calculateIVA = () => {
    if (!selectedPlan) return 0
    return selectedPlan.price * 0.19
  }

  const generateMPPreference = async () => {
    if (!selectedPlan) return null

    const preference = {
      items: [
        {
          title: selectedPlan.name,
          description: `Suscripción mensual a VIRA - ${selectedPlan.name}`,
          unit_price: selectedPlan.price,
          quantity: 1,
        }
      ],
      payer: {
        name: billingData.name,
        email: billingData.email,
      },
      back_urls: {
        success: `${window.location.origin}/pagos/exito`,
        failure: `${window.location.origin}/pagos/error`,
        pending: `${window.location.origin}/pagos/pendiente`
      },
      auto_return: 'approved',
      external_reference: `vira-${selectedPlan.id}-${Date.now()}`
    }

    try {
      const response = await fetch('/api/payments/create-preference', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preference),
      })
      
      const data = await response.json()
      return data.id
    } catch (error) {
      console.error('Error creando preferencia MP:', error)
      return null
    }
  }

  const handlePaymentStart = () => {
    setIsProcessing(true)
  }

  const handlePaymentSuccess = (paymentData: any) => {
    setPaymentData(paymentData)
    setShowSuccessModal(true)
    setPaymentStep('success')
    setIsProcessing(false)
  }

  const handlePaymentError = (error: string) => {
    console.error('Error en pago:', error)
    setIsProcessing(false)
    // El error se maneja en el componente MercadoPagoButton con toast
  }

  const handleTransferPayment = async () => {
    setIsProcessing(true)
    try {
      // Simular generación de referencia de transferencia
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      const reference = `VIRA-${selectedPlan?.id?.toUpperCase()}-${Date.now().toString().slice(-6)}`
      setTransferReference(reference)
      setPaymentStep('pending')
      
    } catch (error) {
      toast.error('Error al generar la orden de transferencia')
    } finally {
      setIsProcessing(false)
    }
  }

  const handlePayment = async () => {
    if (!selectedPlan) return

    if (paymentMethod === 'transfer') {
      await handleTransferPayment()
    }
    // MercadoPago se maneja directamente por el componente MercadoPagoButton
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    // Mostrar feedback visual
    const originalText = text
    setTimeout(() => {
      toast.success('Copiado al portapapeles')
    }, 100)
  }

  // Vista de selección de plan si no hay plan seleccionado
  if (!selectedPlan) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        
        <main className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center mb-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              Selecciona tu Plan
            </h1>
            <p className="text-lg text-gray-600">
              Elige el plan que mejor se adapte a las necesidades de tu radio
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {plans.map((plan) => (
              <Card 
                key={plan.id} 
                className={`relative ${plan.popular ? 'ring-2 ring-blue-500 shadow-lg' : ''}`}
              >
                {plan.popular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                    <Badge className="bg-blue-600 text-white px-4 py-1">
                      MÁS POPULAR
                    </Badge>
                  </div>
                )}
                
                <CardHeader className="text-center pb-4">
                  <CardTitle className="text-xl font-bold">{plan.name}</CardTitle>
                  <div className="mt-4">
                    <span className="text-4xl font-bold text-gray-900">
                      {formatCurrency(plan.price)}
                    </span>
                    <span className="text-gray-600 text-lg">/{plan.interval === 'month' ? 'mes' : 'año'}</span>
                  </div>
                </CardHeader>
                
                <CardContent className="space-y-4">
                  <ul className="space-y-3">
                    {plan.features.map((feature, index) => (
                      <li key={index} className="flex items-center text-sm">
                        <Check className="h-4 w-4 text-green-500 mr-3 flex-shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  
                  <div className="pt-4">
                    <Button 
                      className="w-full"
                      onClick={() => {
                        setSelectedPlan(plan)
                        setPaymentStep('select')
                      }}
                    >
                      Seleccionar Plan
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-600">
              ¿Necesitas un plan personalizado?{' '}
              <a href="mailto:ventas@vira.cl" className="text-blue-600 hover:underline">
                Contáctanos
              </a>
            </p>
          </div>
        </main>
      </div>
    )
  }

  // Vista de éxito
  if (paymentStep === 'success') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        
        <main className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-16">
          <div className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-500 rounded-full flex items-center justify-center mb-6">
              <CheckCircle className="h-8 w-8 text-white" />
            </div>
            
            <h1 className="text-2xl font-bold text-gray-900 mb-4">
              ¡Pago Exitoso!
            </h1>
            
            <p className="text-gray-600 mb-8">
              Tu suscripción al <strong>{selectedPlan.name}</strong> ha sido activada exitosamente.
            </p>
            
            <div className="bg-green-50 border border-green-200 rounded-lg p-6 mb-8">
              <h3 className="font-semibold text-green-900 mb-2">Próximos pasos:</h3>
              <ul className="text-left text-green-800 space-y-1 text-sm">
                <li>✅ Tu plan ha sido activado inmediatamente</li>
                <li>✅ Recibirás un email de confirmación en breve</li>
                <li>✅ Ya puedes disfrutar de todas las funcionalidades</li>
                <li>✅ La factura será enviada a tu email</li>
              </ul>
            </div>
            
            <div className="space-x-4">
              <Button onClick={() => router.push('/perfil')}>
                Ver Mi Perfil
              </Button>
              <Button variant="outline" onClick={() => router.push('/crear-noticiero')}>
                Crear Noticiero
              </Button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Vista de transferencia pendiente
  if (paymentStep === 'pending') {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navigation />
        
        <main className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto w-16 h-16 bg-yellow-500 rounded-full flex items-center justify-center mb-4">
                <Clock className="h-8 w-8 text-white" />
              </div>
              <CardTitle className="text-xl">Transferencia Bancaria</CardTitle>
              <p className="text-gray-600">
                Realiza tu transferencia con los siguientes datos
              </p>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center mb-2">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
                  <span className="font-medium text-yellow-800">Importante</span>
                </div>
                <p className="text-yellow-700 text-sm">
                  Tu plan se activará una vez que confirmemos el pago de tu transferencia (1-2 días hábiles).
                </p>
              </div>
              
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <span className="font-medium">Referencia de Pago:</span>
                  <div className="flex items-center space-x-2">
                    <code className="bg-white px-3 py-1 rounded border text-sm font-mono">
                      {transferReference}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(transferReference)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <span className="font-medium">Monto Total:</span>
                  <span className="text-lg font-bold text-green-700">
                    {formatCurrency(calculateTotal())}
                  </span>
                </div>
              </div>
              
              <Separator />
              
              <div>
                <h4 className="font-medium mb-4">Datos Bancarios - Elige tu banco preferido:</h4>
                <div className="space-y-4">
                  {bankAccounts.map((account, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <h5 className="font-medium text-gray-900 mb-3">{account.bank}</h5>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-gray-600">Tipo de cuenta:</span>
                          <div className="font-medium">{account.accountType}</div>
                        </div>
                        <div>
                          <span className="text-gray-600">Número de cuenta:</span>
                          <div className="flex items-center space-x-2">
                            <code className="font-mono">{account.accountNumber}</code>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(account.accountNumber)}
                              className="h-6 w-6 p-0"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div>
                          <span className="text-gray-600">RUT:</span>
                          <div className="font-medium">{account.rut}</div>
                        </div>
                        <div>
                          <span className="text-gray-600">Email:</span>
                          <div className="font-medium">{account.email}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h5 className="font-medium text-gray-900 mb-2">Instrucciones:</h5>
                <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                  <li>Realiza la transferencia por el monto exacto: <strong>{formatCurrency(calculateTotal())}</strong></li>
                  <li>Usa la referencia: <strong>{transferReference}</strong></li>
                  <li>Envía el comprobante a: <strong>pagos@vira.cl</strong></li>
                  <li>Tu plan se activará en 1-2 días hábiles</li>
                </ol>
              </div>
              
              <div className="flex space-x-4">
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => setPaymentStep('select')}
                >
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Volver
                </Button>
                <Button 
                  className="flex-1"
                  onClick={() => window.open('mailto:pagos@vira.cl?subject=Comprobante de Transferencia - ' + transferReference)}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Enviar Comprobante
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      </div>
    )
  }

  // Vista principal de checkout
  return (
    <div className="min-h-screen bg-gray-50">
      <Navigation />
      
      <main className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Button 
            variant="ghost" 
            onClick={() => setSelectedPlan(null)}
            className="mb-4"
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Cambiar Plan
          </Button>
          
          <h1 className="text-2xl font-bold text-gray-900">Finalizar Pago</h1>
          <p className="text-gray-600 mt-1">
            Estás suscribiéndote al <strong>{selectedPlan.name}</strong>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Formulario de pago */}
          <div className="lg:col-span-2 space-y-6">
            {/* Información de facturación */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileText className="h-5 w-5 mr-2" />
                  Información de Facturación
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Nombre Completo</Label>
                    <Input
                      value={billingData.name}
                      onChange={(e) => setBillingData({...billingData, name: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Email</Label>
                    <Input
                      type="email"
                      value={billingData.email}
                      onChange={(e) => setBillingData({...billingData, email: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Empresa</Label>
                    <Input
                      value={billingData.company}
                      onChange={(e) => setBillingData({...billingData, company: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">RUT</Label>
                    <Input
                      value={billingData.rut}
                      onChange={(e) => setBillingData({...billingData, rut: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Label className="text-sm font-medium text-gray-700">Dirección</Label>
                    <Input
                      value={billingData.address}
                      onChange={(e) => setBillingData({...billingData, address: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Ciudad</Label>
                    <Input
                      value={billingData.city}
                      onChange={(e) => setBillingData({...billingData, city: e.target.value})}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-sm font-medium text-gray-700">Región</Label>
                    <Select value={billingData.region} onValueChange={(value) => setBillingData({...billingData, region: value})}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Región Metropolitana">Región Metropolitana</SelectItem>
                        <SelectItem value="Región de Valparaíso">Región de Valparaíso</SelectItem>
                        <SelectItem value="Región del Biobío">Región del Biobío</SelectItem>
                        <SelectItem value="Región de La Araucanía">Región de La Araucanía</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Método de pago */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <CreditCard className="h-5 w-5 mr-2" />
                  Método de Pago
                </CardTitle>
              </CardHeader>
              <CardContent>
                <RadioGroup value={paymentMethod} onValueChange={(value: any) => setPaymentMethod(value)}>
                  <div className="space-y-4">
                    {paymentMethods.map((method) => {
                      const IconComponent = method.icon
                      return (
                        <div
                          key={method.id}
                          className={`flex items-center space-x-3 p-4 border rounded-lg cursor-pointer hover:bg-gray-50 ${
                            paymentMethod === method.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                          }`}
                          onClick={() => setPaymentMethod(method.id)}
                        >
                          <RadioGroupItem value={method.id} id={method.id} />
                          <div className="flex items-center space-x-3 flex-1">
                            <IconComponent className="h-6 w-6 text-gray-600" />
                            <div className="flex-1">
                              <h4 className="font-medium">{method.name}</h4>
                              <p className="text-sm text-gray-600">{method.description}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                <Clock className="h-3 w-3 inline mr-1" />
                                Procesamiento: {method.processingTime}
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </RadioGroup>
              </CardContent>
            </Card>
          </div>

          {/* Resumen del pedido */}
          <div>
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle>Resumen del Pedido</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium">{selectedPlan.name}</h4>
                    <p className="text-sm text-gray-600">Suscripción mensual</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(selectedPlan.price)}</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedPlan.price)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>IVA (19%):</span>
                    <span>{formatCurrency(calculateIVA())}</span>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-between font-semibold text-lg">
                  <span>Total:</span>
                  <span>{formatCurrency(calculateTotal())}</span>
                </div>

                <div className="pt-4">
                  <h5 className="font-medium mb-2">Incluye:</h5>
                  <ul className="space-y-1">
                    {selectedPlan.features.slice(0, 3).map((feature, index) => (
                      <li key={index} className="flex items-center text-sm text-gray-600">
                        <Check className="h-3 w-3 text-green-500 mr-2" />
                        {feature}
                      </li>
                    ))}
                    {selectedPlan.features.length > 3 && (
                      <li className="text-xs text-gray-500 ml-5">
                        +{selectedPlan.features.length - 3} características más
                      </li>
                    )}
                  </ul>
                </div>

                <div className="pt-4">
                  {paymentMethod === 'mercadopago' ? (
                    <MercadoPagoButton
                      planId={selectedPlan.id}
                      planName={selectedPlan.name}
                      planPrice={selectedPlan.price}
                      planDescription={`Suscripción ${selectedPlan.name} - ${selectedPlan.interval === 'month' ? 'Mensual' : 'Anual'}`}
                      onPaymentStart={handlePaymentStart}
                      onPaymentSuccess={handlePaymentSuccess}
                      onPaymentError={handlePaymentError}
                      disabled={isProcessing}
                      className="w-full"
                    />
                  ) : (
                    <Button 
                      className="w-full" 
                      size="lg"
                      onClick={handlePayment}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                          Procesando...
                        </>
                      ) : (
                        <>
                          <Building2 className="h-4 w-4 mr-2" />
                          Generar Transferencia
                        </>
                      )}
                    </Button>
                  )}
                </div>

                <div className="text-center pt-4">
                  <div className="flex items-center justify-center text-sm text-gray-500">
                    <Shield className="h-4 w-4 mr-2" />
                    Pago 100% seguro y encriptado
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Modal de Éxito */}
      <PaymentSuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        paymentData={paymentData}
      />
    </div>
  )
}

export default function PagosPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando...</p>
        </div>
      </div>
    }>
      <PagosContent />
    </Suspense>
  )
}
