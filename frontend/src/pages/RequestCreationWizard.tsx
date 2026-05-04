// RequestCreationWizard.tsx
//
// Multi-step wizard for creating an automation request against an AWX template.
// Walks the user through: select connection → fill out the schema form → review → submit.
// Dynamic dropdown fields fetch their options from validation queries live at render time.

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { awxService, AutomationTemplate } from '../services/awx'
import { apicService } from '../services/apic'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'


import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  ChevronRight,
  ChevronLeft,
  Save,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  AlertTriangle,
  XCircle,
  KeyRound,
  Info,
  RotateCcw,
} from 'lucide-react'
import { ApicConnectionPicker } from '../components/awx/ApicConnectionPicker'
import { AwxCredentialPicker } from '../components/awx/AwxCredentialPicker'
import { toast } from 'sonner'
import { DataGrid } from '../components/SchemaDesigner/DataGrid'

type WizardStep = 'info' | 'connection' | 'data' | 'validation' | 'review'

const STEPS: WizardStep[] = ['info', 'connection', 'data', 'validation', 'review']

export default function RequestCreationWizard() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState<WizardStep>('info')
  const [saving, setSaving] = useState(false)

  // Template
  const [template, setTemplate] = useState<AutomationTemplate | null>(null)
  const [loading, setLoading] = useState(true)

  // Step 1: Info
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Dry-run / Ansible check mode — hidden from UI, kept in code for future re-enable
  // const [checkMode, setCheckMode] = useState(false)

  // Step 2: APIC Connection
  const [showApicInfo, setShowApicInfo] = useState(false)
  const [apicConnectionId, setApicConnectionId] = useState<string>('')
  const [apicConnections, setApicConnections] = useState<any[]>([])
  const [loadingConnections, setLoadingConnections] = useState(false)

  // Step 2b: Device credential (per-site, selected at execution time)
  const [awxCredentialId, setAwxCredentialId] = useState<number | null>(null)
  const [awxCredentialName, setAwxCredentialName] = useState('')
  const [awxCredentials, setAwxCredentials] = useState<Array<{ id: number; name: string; description: string; credential_type: number }>>([])
  const [loadingCredentials, setLoadingCredentials] = useState(false)

  // Step 3: Data — key: schema index, value: rows
  const [tableDataBySchema, setTableDataBySchema] = useState<Record<number, any[]>>({})
  const [activeSchemaTab, setActiveSchemaTab] = useState(0)

  // Step 4: Validation
  const [validationErrors, setValidationErrors] = useState<any[]>([])
  const [validating, setValidating] = useState(false)
  const [validationRun, setValidationRun] = useState(false)
  const [validationCancelled, setValidationCancelled] = useState(false)
  const [_validationTaskId, setValidationTaskId] = useState<string | null>(null)
  const [validationProgress, setValidationProgress] = useState(0)
  const [validationStatus, setValidationStatus] = useState('')
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const hasShownToast = useRef(false)
  const isPollingActive = useRef(false)

  // Error details dialog
  const [errorDialogOpen, setErrorDialogOpen] = useState(false)
  const [selectedError, setSelectedError] = useState<any | null>(null)

  // Warn when some schemas (tables) are left empty on a multi-sheet template —
  // user might have intentionally skipped an optional one, but we want a
  // confirmation so it's never silent.
  const [emptySheetsDialogOpen, setEmptySheetsDialogOpen] = useState(false)

  // Step validation
  const [stepValidation, setStepValidation] = useState<Record<WizardStep, boolean>>({
    info: false,
    connection: false,
    data: false,
    validation: false,
    review: false,
  })

  useEffect(() => {
    if (templateId) {
      loadTemplate()
      loadApicConnections()
    }
  }, [templateId])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
    }
  }, [])

  // Step validations
  useEffect(() => {
    setStepValidation(prev => ({ ...prev, info: title.trim() !== '' }))
  }, [title])

  // Connection step is valid when both AWX Credential and APIC Connection are selected
  useEffect(() => {
    setStepValidation(prev => ({
      ...prev,
      connection: awxCredentialId !== null && apicConnectionId !== ''
    }))
  }, [awxCredentialId, apicConnectionId])

  useEffect(() => {
    const hasData = Object.values(tableDataBySchema).some(rows =>
      rows.some(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== ''))
    )
    setStepValidation(prev => ({ ...prev, data: hasData }))
  }, [tableDataBySchema])

  useEffect(() => {
    // Valid only if validation was actually run and passed
    const isValid = !validating && validationRun && validationErrors.length === 0
    setStepValidation(prev => ({ ...prev, validation: isValid }))
  }, [validating, validationRun, validationErrors])

  useEffect(() => {
    if (currentStep === 'review') setStepValidation(prev => ({ ...prev, review: true }))
  }, [currentStep])

  const loadTemplate = async () => {
    try {
      setLoading(true)
      const data = await awxService.getTemplate(templateId!)
      setTemplate(data)
      const initial: Record<number, any[]> = {}
      ;(data.table_schemas || []).forEach((_: any, i: number) => { initial[i] = [] })
      setTableDataBySchema(initial)
    } catch (error: any) {
      toast.error('Failed to load template')
      navigate('/awx/templates')
    } finally {
      setLoading(false)
    }
  }

  const loadApicConnections = async () => {
    try {
      setLoadingConnections(true)
      const connections = await apicService.getConnections()
      setApicConnections(connections)
    } catch (error: any) {
      toast.error('Failed to load APIC connections')
    } finally {
      setLoadingConnections(false)
    }
  }

  // Load AWX credentials when template is loaded (needs awx_connection from template)
  const loadAwxCredentials = async (search?: string) => {
    if (!template?.awx_connection) return
    try {
      setLoadingCredentials(true)
      const data = await awxService.listCredentials(template.awx_connection, {
        search: search || undefined,
        page_size: 50,
      })
      setAwxCredentials(data.results || [])
    } catch (error: any) {
      toast.error('Failed to load AWX credentials')
    } finally {
      setLoadingCredentials(false)
    }
  }

  // Load credentials when template becomes available
  useEffect(() => {
    if (template?.awx_connection) {
      loadAwxCredentials()
    }
  }, [template?.awx_connection])

  // Shared input data builder (used by both validateData and handleSubmit)
  // Always returns dict format regardless of schema count
  const buildInputData = (): Record<string, any[]> => {
    const schemas = template?.table_schemas || []
    const schemaData: Record<string, any[]> = {}
    schemas.forEach((schema: any, index: number) => {
      const varName = schema.awx_variable_name || 'data'
      const filtered = (tableDataBySchema[index] || []).filter(row =>
        Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '')
      )
      schemaData[varName] = filtered
    })
    return schemaData
  }

  const totalNonEmptyRows = () => {
    const input = buildInputData()
    return Object.values(input).reduce((sum: number, arr: any[]) => sum + arr.length, 0)
  }

  const emptySheetNames = (): string[] => {
    const schemas = template?.table_schemas || []
    if (schemas.length < 2) return []
    const empty: string[] = []
    schemas.forEach((schema: any, index: number) => {
      const filled = (tableDataBySchema[index] || []).some(row =>
        Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '')
      )
      if (!filled) empty.push(schema.sheet_name || schema.awx_variable_name || `Sheet ${index + 1}`)
    })
    return empty
  }

  const stopPolling = () => {
    isPollingActive.current = false
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current)
      pollingIntervalRef.current = null
    }
  }

  const pollValidationStatus = async (taskId: string) => {
    if (!isPollingActive.current) return
    try {
      const status = await awxService.getValidationStatus(taskId)
      setValidationProgress(status.progress || 0)
      setValidationStatus(status.status || '')

      if (status.completed || status.state === 'SUCCESS' || status.state === 'FAILURE') {
        stopPolling()
        setValidating(false)
        setValidationRun(true)

        if (!hasShownToast.current) {
          hasShownToast.current = true
          if (status.result) {
            if (status.result.valid) {
              setValidationErrors([])
              toast.success('Validation passed!')
            } else {
              const errors = status.result.errors || []
              setValidationErrors(errors)
              toast.error(`Validation failed with ${errors.length} error(s). Check table for details.`)
            }
          } else if (status.error) {
            setValidationErrors([{ message: status.error }])
            toast.error('Validation failed')
          }
        }
      }
    } catch (error: any) {
      isPollingActive.current = false
      stopPolling()
      setValidating(false)
      setValidationRun(true)
      if (!hasShownToast.current) {
        hasShownToast.current = true
        const msg = error.response?.data?.detail || error.message || 'Failed to check validation status'
        setValidationErrors([{ message: msg }])
        toast.error(msg)
      }
    }
  }

  const validateData = async () => {
    if (!templateId || !template) return
    setValidationCancelled(false)

    if (!apicConnectionId) {
      setValidationErrors([{ message: 'APIC connection is required for data validation. Go back and select one.' }])
      setValidationRun(true)
      return
    }

    try {
      setValidating(true)
      setValidationErrors([])
      setValidationRun(false)
      setValidationProgress(0)
      setValidationStatus('Starting validation...')
      hasShownToast.current = false
      isPollingActive.current = true

      const allInputData = buildInputData()
      const rowCount = totalNonEmptyRows()

      if (rowCount === 0) {
        toast.error('Please enter at least one row of data')
        setValidating(false)
        return
      }

      const response = await awxService.validateTemplateInput(templateId, allInputData, apicConnectionId)
      setValidationTaskId(response.task_id)

      const intervalMs = (response.polling_interval || 2) * 1000
      pollingIntervalRef.current = setInterval(() => {
        pollValidationStatus(response.task_id)
      }, intervalMs)

      // Initial poll immediately
      pollValidationStatus(response.task_id)

    } catch (error: any) {
      isPollingActive.current = false
      stopPolling()
      setValidating(false)
      setValidationRun(true)

      if (error.response?.data?.errors) {
        const errors = Array.isArray(error.response.data.errors)
          ? error.response.data.errors
          : [error.response.data.errors]
        setValidationErrors(errors)
        toast.error(`Validation failed with ${errors.length} error(s)`)
      } else {
        const msg = error.response?.data?.detail || error.message || 'Failed to start validation'
        setValidationErrors([{ message: msg }])
        toast.error(msg)
      }
    }
  }

  const handleNext = async () => {
    if (currentStep === 'info' && !title.trim()) {
      toast.error('Request title is required')
      return
    }
    if (currentStep === 'connection' && !awxCredentialId) {
      toast.error('Please select a device credential')
      return
    }
    if (currentStep === 'connection' && !apicConnectionId) {
      toast.error('Please select an APIC connection for data validation')
      return
    }
    if (currentStep === 'data' && totalNonEmptyRows() === 0) {
      toast.error('Please enter at least one row of data')
      return
    }

    const currentIndex = STEPS.indexOf(currentStep)
    const nextStep = STEPS[currentIndex + 1]
    if (!nextStep) return

    if (nextStep === 'validation') {
      setCurrentStep(nextStep)
      await validateData()
    } else {
      setCurrentStep(nextStep)
    }
  }

  const handleBack = () => {
    const currentIndex = STEPS.indexOf(currentStep)
    if (currentIndex > 0) setCurrentStep(STEPS[currentIndex - 1])
  }

  const handleSubmit = async (skipEmptyCheck = false) => {
    if (!skipEmptyCheck && emptySheetNames().length > 0) {
      setEmptySheetsDialogOpen(true)
      return
    }
    try {
      setSaving(true)

      const createdRequest = await awxService.createRequest({
        title: title.trim(),
        description: description.trim(),
        template: templateId!,
        awx_connection: template?.awx_connection ?? '',
        input_data: buildInputData(),
        // check_mode: checkMode,    // dry-run UI hidden — backend defaults to false
        check_mode: false,
        awx_credential_id: awxCredentialId!,
        awx_credential_name: awxCredentialName,
        target_apic: parseInt(apicConnectionId),
      })

      try {
        await awxService.executeRequest(createdRequest.id)
        toast.success('Request created and execution started!')
      } catch {
        toast.warning('Request created but execution failed to start. You can execute it manually from the requests page.')
      }

      navigate('/awx/requests')
    } catch (error: any) {
      toast.error(error.response?.data?.error || error.message || 'Failed to create request')
    } finally {
      setSaving(false)
    }
  }

  const handleCancelValidation = () => {
    stopPolling()
    setValidating(false)
    setValidationProgress(0)
    setValidationStatus('')
    setValidationErrors([])
    setValidationTaskId(null)
    setValidationRun(false)
    setValidationCancelled(true)
    hasShownToast.current = false
    toast.info('Validation cancelled')
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-muted-foreground">Loading template...</p>
        </div>
      </div>
    )
  }

  if (!template) return null

  const schemas = template.table_schemas || []
  const hasMultipleSchemas = schemas.length > 1
  const stepIndex = STEPS.indexOf(currentStep)

  return (
    <div className="h-full w-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card w-full">
        <div className="p-6">
          <h1 className="text-2xl font-semibold tracking-tight">Create Automation Request</h1>
          <p className="text-muted-foreground mt-1">Template: {template.name}</p>
        </div>

        {/* Progress Steps */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between max-w-2xl">
            {STEPS.map((step, index) => {
              const isPast = stepIndex > index
              const isCurrent = stepIndex === index
              const isValid = stepValidation[step]

              return (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                        isPast && isValid
                          ? 'bg-green-500 border-green-500 text-white'
                          : isPast && !isValid
                          ? 'bg-destructive border-destructive text-destructive-foreground'
                          : isCurrent
                          ? 'border-primary text-primary'
                          : 'border-muted text-muted-foreground'
                      }`}
                    >
                      {isPast && isValid ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : isPast && !isValid ? (
                        <XCircle className="h-5 w-5" />
                      ) : (
                        <span className="text-sm font-semibold">{index + 1}</span>
                      )}
                    </div>
                    <span
                      className={`text-xs mt-2 capitalize ${
                        isCurrent
                          ? 'text-foreground font-medium'
                          : isPast && !isValid
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 transition-colors ${
                        isPast && isValid ? 'bg-green-500' : isPast && !isValid ? 'bg-destructive' : 'bg-muted'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto w-full">

        {/* Step 1: Info */}
        <div className="max-w-6xl mx-auto p-6" style={{ display: currentStep === 'info' ? 'block' : 'none' }}>
          <Card>
            <CardHeader>
              <CardTitle>Request Information</CardTitle>
              <CardDescription>Provide details about this automation request</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">
                  Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="title"
                  placeholder="e.g., Deploy L3Out for Production Tenant"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  placeholder="Additional context or notes about this request..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
              </div>

              {/* Dry-run / Check Mode UI — hidden. Re-enable by uncommenting. */}
              {/*
              <div className="pt-4 border-t">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    id="check-mode"
                    type="checkbox"
                    checked={checkMode}
                    onChange={(e) => setCheckMode(e.target.checked)}
                    className="w-4 h-4 mt-1 accent-primary"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Run in Check Mode (Dry-Run)</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        Test
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Simulate execution without applying any changes to the network.
                    </p>
                  </div>
                </label>
              </div>
              */}
            </CardContent>
          </Card>
        </div>

        {/* Step 2: Device Credential + Optional APIC Connection */}
        <div className="max-w-6xl mx-auto p-6" style={{ display: currentStep === 'connection' ? 'block' : 'none' }}>
          {/* Device Credential — required */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Device Credential <span className="text-destructive">*</span>
              </CardTitle>
              <CardDescription>
                Select the AWX credential that contains APIC host, username, and password.
                This credential is stored securely in AWX vault and injected into the playbook at runtime.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AwxCredentialPicker
                credentials={awxCredentials}
                selectedId={awxCredentialId}
                selectedName={awxCredentialName}
                onSelect={(id, name) => {
                  setAwxCredentialId(id)
                  setAwxCredentialName(name)
                }}
                onSearch={(query) => loadAwxCredentials(query)}
                isLoading={loadingCredentials}
              />
            </CardContent>
          </Card>

          {/* APIC Connection — required for pre-execution validation */}
          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                APIC Connection <span className="text-destructive">*</span>
              </CardTitle>
              <CardDescription>
                Fabrik connects to APIC to validate your input data before execution — e.g. checking
                if a tenant, VRF, or BD actually exists. Also powers query-based column validators.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apic-connection">APIC Connection</Label>
                <ApicConnectionPicker
                  connections={apicConnections}
                  selectedId={apicConnectionId}
                  onSelect={setApicConnectionId}
                  isLoading={loadingConnections}
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowApicInfo(!showApicInfo)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Info className="w-3.5 h-3.5" />
                  <span>What is this for?</span>
                </button>
              </div>
              {showApicInfo && (
                <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md text-blue-800 dark:text-blue-300 animate-in fade-in-0 slide-in-from-top-1 duration-200">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" />
                  <p className="text-xs">
                    This is Fabrik's direct connection to the APIC — used to <strong>validate your data</strong> before
                    execution. If a column has a query validator, Fabrik runs that query against the APIC and
                    checks your input against live results. The playbook itself uses the AWX credential above
                    to authenticate at runtime.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Step 3: Data Input */}
        <div className="w-full px-4 py-6" style={{ display: currentStep === 'data' ? 'block' : 'none' }}>
          <div className="space-y-4 w-full">
            <div>
              <h2 className="text-2xl font-bold">Data Entry</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {template.name}{hasMultipleSchemas && ` — ${schemas.length} tables`}
              </p>
            </div>

            {schemas.length > 0 ? (
              <div className="w-full space-y-4">
                {hasMultipleSchemas && (
                  <div className="flex gap-2 border-b">
                    {schemas.map((schema: any, index: number) => (
                      <button
                        key={index}
                        onClick={() => setActiveSchemaTab(index)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          activeSchemaTab === index
                            ? 'border-primary text-primary'
                            : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted'
                        }`}
                      >
                        <FileSpreadsheet className="inline h-4 w-4 mr-2" />
                        {schema.name || `Table ${index + 1}`}
                      </button>
                    ))}
                  </div>
                )}

                {/* Render all schemas, hide inactive — prevents unmount/data loss */}
                {schemas.map((schema: any, index: number) => (
                  <div
                    key={index}
                    style={{ display: activeSchemaTab === index ? 'block' : 'none' }}
                    className="w-full"
                  >
                    {schema.columns ? (
                      <DataGrid
                        columns={schema.columns}
                        data={tableDataBySchema[index] || []}
                        onDataChange={(data) => setTableDataBySchema(prev => ({ ...prev, [index]: data }))}
                        minRows={schema.min_rows || 1}
                        maxRows={schema.max_rows || 1000}
                      />
                    ) : (
                      <Card className="p-12 text-center border-dashed">
                        <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <p className="text-muted-foreground">No columns defined for this table</p>
                      </Card>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Card className="p-12 text-center border-dashed">
                <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">No data schema defined</p>
                <p className="text-sm text-muted-foreground">This template needs a schema definition</p>
              </Card>
            )}
          </div>
        </div>

        {/* Step 4: Validation */}
        <div className="w-full px-4 py-6" style={{ display: currentStep === 'validation' ? 'block' : 'none' }}>
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Validation Results</CardTitle>
                <CardDescription>
                  {validating ? 'Validating your data...' : 'Review validation results'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {validating ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                      <div className="animate-spin h-6 w-6 border-2 border-blue-600 border-t-transparent rounded-full" />
                      <p className="font-medium text-blue-900 dark:text-blue-100">
                        {validationStatus || 'Validating...'}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{validationProgress}%</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 transition-all duration-300"
                          style={{ width: `${validationProgress}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelValidation}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <XCircle className="mr-2 h-4 w-4" />
                        Cancel Validation
                      </Button>
                    </div>
                  </div>
                ) : validationCancelled ? (
                  <div className="flex items-center justify-between p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-6 w-6 text-amber-600" />
                      <div>
                        <p className="font-medium text-amber-900 dark:text-amber-100">Validation Cancelled</p>
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                          Validation was cancelled before completing. Run it again to proceed.
                        </p>
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => validateData()}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Retry
                    </Button>
                  </div>
                ) : !validationRun ? (
                  <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
                    <Info className="h-6 w-6 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-foreground">Waiting for validation</p>
                      <p className="text-sm text-muted-foreground">
                        Validation will start automatically.
                      </p>
                    </div>
                  </div>
                ) : validationErrors.length === 0 ? (
                  <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                    <div>
                      <p className="font-medium text-green-900 dark:text-green-100">Validation Passed</p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        All data looks good. Ready to submit!
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-destructive/10 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle className="h-5 w-5 text-destructive" />
                      <p className="font-medium text-destructive">
                        {validationErrors.length} Validation Error(s) Found
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Fix the highlighted errors in the table below and click "Back" to edit your data.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Data tables with error highlights */}
            {!validating && schemas.length > 0 && (
              <div className="space-y-6">
                {schemas.map((schema: any, schemaIdx: number) => {
                  const filteredData = (tableDataBySchema[schemaIdx] || []).filter(row =>
                    Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== '')
                  )
                  if (filteredData.length === 0) return null

                  return (
                    <Card key={schemaIdx}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {schema.name || `Table ${schemaIdx + 1}`}
                          <span className="text-sm font-normal text-muted-foreground">
                            ({filteredData.length} {filteredData.length === 1 ? 'row' : 'rows'})
                          </span>
                        </CardTitle>
                        <CardDescription>
                          {validationErrors.length > 0 ? 'Errors are highlighted in red' : 'Review your data before submitting'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="bg-muted">
                                <th className="border border-border p-2 text-left font-medium">#</th>
                                {schema.columns?.map((col: any, colIdx: number) => (
                                  <th key={colIdx} className="border border-border p-2 text-left font-medium">
                                    {col.display_name || col.name}
                                    {col.required && <span className="text-destructive ml-1">*</span>}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {filteredData.map((row: any, rowIdx: number) => (
                                <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                                  <td className="border border-border p-2 text-muted-foreground">{rowIdx + 1}</td>
                                  {schema.columns?.map((col: any, colIdx: number) => {
                                    const hasError = validationErrors.some(
                                      (err: any) => err.row === rowIdx && err.column === col.name && (err.schema_index ?? 0) === schemaIdx
                                    )
                                    const error = validationErrors.find(
                                      (err: any) => err.row === rowIdx && err.column === col.name && (err.schema_index ?? 0) === schemaIdx
                                    )
                                    return (
                                      <td
                                        key={colIdx}
                                        className={`border border-border p-2 ${hasError ? 'bg-destructive/15 border-destructive border-2 font-medium text-destructive cursor-pointer hover:bg-destructive/25 transition-colors' : ''}`}
                                        title={hasError ? 'Click to view error details' : undefined}
                                        onClick={hasError ? () => { setSelectedError(error); setErrorDialogOpen(true) } : undefined}
                                      >
                                        {row[col.name] !== null && row[col.name] !== undefined && row[col.name] !== ''
                                          ? String(row[col.name])
                                          : <span className="text-muted-foreground italic">empty</span>
                                        }
                                        {hasError && <span className="ml-2">⚠️</span>}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Error summary */}
            {!validating && validationErrors.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-destructive">
                    Validation Errors ({validationErrors.length})
                  </CardTitle>
                  <CardDescription>Please fix the errors below before submitting</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {validationErrors.map((error: any, idx: number) => {
                      const schemaIdx = error.schema_index ?? 0
                      const schemaName = schemas[schemaIdx]?.name || `Table ${schemaIdx + 1}`
                      const rowNum = error.row !== undefined ? error.row + 1 : 'N/A'
                      return (
                        <div key={idx} className="text-sm p-3 bg-destructive/5 border border-destructive/20 rounded">
                          <p className="font-medium">
                            {schemas.length > 1 && <span className="text-primary">[{schemaName}] </span>}
                            Row {rowNum}, Column "{error.column || 'N/A'}": {error.message}
                          </p>
                          {error.value && (
                            <p className="text-muted-foreground mt-1">
                              Value: <code className="px-1 py-0.5 bg-muted rounded">{error.value}</code>
                            </p>
                          )}
                          {error.allowed_values?.length > 0 &&
                           !error.message?.toLowerCase().includes('conflict') &&
                           !error.message?.toLowerCase().includes('already exists') && (
                            <p className="text-muted-foreground mt-1">
                              Allowed: {error.allowed_values.slice(0, 5).join(', ')}
                              {error.allowed_values.length > 5 && '...'}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        {/* Step 5: Review */}
        <div className="max-w-6xl mx-auto p-6" style={{ display: currentStep === 'review' ? 'block' : 'none' }}>
          <Card>
            <CardHeader>
              <CardTitle>Review & Submit</CardTitle>
              <CardDescription>Review your request before submitting</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 pb-4 border-b">
                <div>
                  <span className="text-sm text-muted-foreground">Request Title</span>
                  <p className="font-medium">{title}</p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Template</span>
                  <p className="font-medium">{template.name}</p>
                </div>
              </div>

              {description && (
                <div>
                  <span className="text-sm text-muted-foreground">Description</span>
                  <p className="text-sm mt-1">{description}</p>
                </div>
              )}

              {awxCredentialId && (
                <div>
                  <span className="text-sm text-muted-foreground">Device Credential</span>
                  <div className="flex items-center gap-2 mt-1">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium">{awxCredentialName}</p>
                  </div>
                </div>
              )}

              <div className="pb-4 border-b">
                <span className="text-sm text-muted-foreground">Data Rows</span>
                <p className="font-medium">{totalNonEmptyRows()} rows</p>
              </div>

              {/* Dry-run review indicator — hidden together with the checkbox above. */}
              {/*
              {checkMode && (
                <div>
                  <span className="text-sm text-muted-foreground">Run Mode</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 font-medium">
                      Check Mode (Dry-Run)
                    </span>
                    <span className="text-xs text-muted-foreground">No changes will be applied</span>
                  </div>
                </div>
              )}
              */}

              <div className="pt-4 border-t">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                  <p className="text-sm text-blue-900 dark:text-blue-100">
                    Clicking <strong>Create Request</strong> will submit and immediately start execution.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t bg-card p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 'info' || saving}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/awx/templates')} disabled={saving}>
              Cancel
            </Button>

            {currentStep === 'review' ? (
              <Button onClick={() => handleSubmit()} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Creating...' : 'Create Request'}
              </Button>
            ) : (
              <Button
                onClick={handleNext}
                disabled={
                  !stepValidation[currentStep] ||
                  (currentStep === 'validation' && validationErrors.length > 0) ||
                  validating
                }
              >
                Next
                <ChevronRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Error Details Dialog */}
      <Dialog open={errorDialogOpen} onOpenChange={setErrorDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Validation Error
            </DialogTitle>
            <DialogDescription>Details about the validation error for this cell</DialogDescription>
          </DialogHeader>

          {selectedError && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                <div>
                  <span className="text-xs text-muted-foreground">Row</span>
                  <p className="font-medium">{selectedError.row + 1}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Column</span>
                  <p className="font-medium">{selectedError.column}</p>
                </div>
              </div>

              {selectedError.value && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">Current Value</span>
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg max-h-40 overflow-y-auto">
                    <code className="text-sm font-mono break-all whitespace-pre-wrap">{selectedError.value}</code>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <span className="text-sm font-medium">Error Message</span>
                <div className="p-4 bg-destructive/5 border border-destructive/20 rounded-lg">
                  <p className="text-sm text-destructive leading-relaxed">{selectedError.message}</p>
                </div>
              </div>

              {selectedError.allowed_values?.length > 0 && (
                <div className="space-y-2">
                  <span className="text-sm font-medium">
                    {selectedError.message?.includes('conflict') || selectedError.message?.includes('already exists')
                      ? 'Conflicting Values (already exist)'
                      : 'Allowed Values'}
                  </span>
                  <div className="p-4 bg-muted rounded-lg max-h-60 overflow-y-auto">
                    <div className="flex flex-wrap gap-2">
                      {selectedError.allowed_values.map((value: string, idx: number) => (
                        <code key={idx} className="px-2 py-1 bg-background border rounded text-xs font-mono">
                          {value}
                        </code>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedError.message?.includes('conflict') || selectedError.message?.includes('already exists')
                      ? 'These values already exist. Please choose a different value.'
                      : 'Only these values are allowed for this field.'}
                  </p>
                </div>
              )}

              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  Click "Back" to edit your data and fix this error, then proceed to validation again.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={emptySheetsDialogOpen} onOpenChange={setEmptySheetsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Some tables are empty
            </DialogTitle>
            <DialogDescription>
              The following tables have no data. They will be sent as empty arrays — the related workflow steps may do nothing or fail.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-6 text-sm space-y-1">
            {emptySheetNames().map(name => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEmptySheetsDialogOpen(false)}>
              Go back
            </Button>
            <Button
              onClick={() => {
                setEmptySheetsDialogOpen(false)
                handleSubmit(true)
              }}
              disabled={saving}
            >
              Submit anyway
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
