// TemplateCreationWizard.tsx
//
// Multi-step wizard for creating a Fabrik automation template that wraps an
// AWX job/workflow. Steps: pick AWX connection → pick template → configure
// input schema → save. Execution is always bulk (single AWX job).

import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { awxService, AWXConnection, AWXJobTemplate, AWXWorkflowTemplate } from '../services/awx'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  ChevronRight,
  ChevronLeft,
  Server,
  FileCode,
  Workflow,
  CheckCircle2,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'

type WizardStep = 'connection' | 'browse'

export default function TemplateCreationWizard() {
  const navigate = useNavigate()
  const { templateId } = useParams<{ templateId: string }>()
  const isEditMode = !!templateId
  const [currentStep, setCurrentStep] = useState<WizardStep>('connection')

  // Step 1: Connection
  const [connections, setConnections] = useState<AWXConnection[]>([])
  const [selectedConnection, setSelectedConnection] = useState<string>('')
  const [loadingConnections, setLoadingConnections] = useState(true)

  // Step 2: Browse
  const [templateType, setTemplateType] = useState<'job' | 'workflow'>('job')
  const [awxTemplates, setAwxTemplates] = useState<(AWXJobTemplate | AWXWorkflowTemplate)[]>([])
  const [selectedAwxTemplate, setSelectedAwxTemplate] = useState<any>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const loadIdRef = useRef(0)

  const PAGE_SIZE = 50

  const withTimeout = <T,>(promise: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ERR_TIMEOUT' })), ms)
      ),
    ])

  const getTemplateErrorMessage = (error: any): string => {
    if (error?.code === 'ERR_TIMEOUT') return 'Request timed out. AWX may be slow or unreachable.'
    const status = error?.response?.status ?? error?.status
    if (status === 401 || status === 403) return 'AWX authentication failed. Check your connection credentials.'
    if (status === 404) return 'AWX endpoint not found. Verify the connection URL.'
    if (status != null && status >= 500) return 'AWX server error. Please try again later.'
    if (error?.code === 'ERR_NETWORK') return 'Network error. Check connectivity to AWX.'
    return 'Failed to load templates from AWX.'
  }

  useEffect(() => {
    loadConnections()
    // In edit mode, redirect straight to TemplateConfigurePage
    if (isEditMode && templateId) {
      navigate(`/awx/templates/${templateId}/edit`, { replace: true })
    }
  }, [templateId])

  const loadConnections = async () => {
    try {
      setLoadingConnections(true)
      const data = await awxService.listConnections()
      setConnections(data)
    } catch (error: any) {
      toast.error('Failed to load AWX connections')
    } finally {
      setLoadingConnections(false)
    }
  }

  const performLoad = async (pageNum: number, query: string) => {
    if (!selectedConnection) return
    const currentLoadId = ++loadIdRef.current
    setLoadingTemplates(true)
    try {
      const params = { page: pageNum, page_size: PAGE_SIZE, name: query || undefined }
      const fetchTemplates = templateType === 'job'
        ? awxService.getJobTemplates(selectedConnection, params)
        : (awxService.getWorkflowTemplates(selectedConnection, params) as unknown as ReturnType<typeof awxService.getJobTemplates>)
      const data = await withTimeout(fetchTemplates, 30000)
      if (currentLoadId !== loadIdRef.current) return
      setAwxTemplates(data.results || [])
      setTotalCount(data.count || 0)
    } catch (error: any) {
      if (currentLoadId !== loadIdRef.current) return
      setAwxTemplates([])
      setTotalCount(0)
      toast.error(getTemplateErrorMessage(error))
    } finally {
      if (currentLoadId === loadIdRef.current) setLoadingTemplates(false)
    }
  }

  // Enter browse step / change connection or type → reset to page 1, load immediately
  useEffect(() => {
    if (currentStep !== 'browse' || !selectedConnection) return
    setPage(1)
    setSelectedAwxTemplate(null)
    performLoad(1, searchQuery)
  }, [currentStep, selectedConnection, templateType])

  // Search input changes → debounce 400ms, reset to page 1
  useEffect(() => {
    if (currentStep !== 'browse' || !selectedConnection) return
    const timer = setTimeout(() => {
      setPage(1)
      performLoad(1, searchQuery)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery])

  // Page changes → load immediately (no debounce)
  useEffect(() => {
    if (currentStep !== 'browse' || !selectedConnection) return
    performLoad(page, searchQuery)
  }, [page])

  const handleNext = () => {
    if (currentStep === 'connection') {
      if (!selectedConnection) {
        toast.error('Please select an AWX connection')
        return
      }
      setCurrentStep('browse')
      return
    }

    if (currentStep === 'browse') {
      if (!selectedAwxTemplate) {
        toast.error('Please select a template from AWX')
        return
      }
      const selectedConn = connections.find((c) => c.id === selectedConnection)
      navigate('/awx/templates/configure', {
        state: {
          connectionId: selectedConnection,
          connectionName: selectedConn?.name || '',
          connectionUrl: selectedConn?.url || '',
          awxTemplateId: selectedAwxTemplate.id,
          awxTemplateName: selectedAwxTemplate.name,
          awxType: templateType === 'job' ? 'job_template' : 'workflow_template',
          workflowJobNodes:
            templateType === 'workflow' ? selectedAwxTemplate.workflow_nodes || [] : [],
        },
      })
    }
  }

  const handleBack = () => {
    if (currentStep === 'browse') {
      setCurrentStep('connection')
    }
  }

  const getStepNumber = (step: WizardStep): number => {
    const steps: WizardStep[] = ['connection', 'browse']
    return steps.indexOf(step) + 1
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-semibold tracking-tight">Create Automation Template</h1>
          <p className="text-muted-foreground mt-1">
            Import a template from AWX and configure it for your team
          </p>
        </div>

        {/* Progress Steps (2 steps) */}
        <div className="px-8 pb-6">
          <div className="flex items-center justify-center max-w-2xl mx-auto">
            {(['connection', 'browse'] as WizardStep[]).map((step, index) => (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                      getStepNumber(currentStep) > index + 1
                        ? 'bg-primary border-primary text-primary-foreground'
                        : getStepNumber(currentStep) === index + 1
                        ? 'border-primary text-primary'
                        : 'border-muted text-muted-foreground'
                    }`}
                  >
                    {getStepNumber(currentStep) > index + 1 ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <span className="text-sm font-semibold">{index + 1}</span>
                    )}
                  </div>
                  <span
                    className={`text-xs mt-2 capitalize ${
                      currentStep === step ? 'text-foreground font-medium' : 'text-muted-foreground'
                    }`}
                  >
                    {step}
                  </span>
                </div>
                {index < 1 && (
                  <div
                    className={`flex-1 h-0.5 mx-2 transition-colors ${
                      getStepNumber(currentStep) > index + 1 ? 'bg-primary' : 'bg-muted'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-7xl px-8 py-8">
          {/* Step 1: Connection */}
          {currentStep === 'connection' && (
            <Card>
              <CardHeader>
                <CardTitle>Select AWX Connection</CardTitle>
                <CardDescription>
                  Choose the AWX/Ansible Tower connection to import templates from
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingConnections ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : connections.length === 0 ? (
                  <div className="text-center py-12">
                    <Server className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground mb-4">No AWX connections found</p>
                    <Button onClick={() => navigate('/awx-connections')}>
                      Add AWX Connection
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {connections.map((connection) => (
                      <Card
                        key={connection.id}
                        className={`cursor-pointer transition-all ${
                          selectedConnection === connection.id
                            ? 'border-primary shadow-md'
                            : 'hover:border-muted-foreground'
                        }`}
                        onClick={() => setSelectedConnection(connection.id)}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <Server className="h-5 w-5 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="font-semibold truncate">{connection.name}</h4>
                              <p className="text-sm text-muted-foreground truncate">
                                {connection.url}
                              </p>
                              {connection.awx_version && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Version: {connection.awx_version}
                                </p>
                              )}
                            </div>
                            {selectedConnection === connection.id && (
                              <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Step 2: Browse */}
          {currentStep === 'browse' && (
            <Card>
              <CardHeader>
                <CardTitle>Browse AWX Templates</CardTitle>
                <CardDescription>
                  Select a Job Template or Workflow Template to import
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Tabs value={templateType} onValueChange={(v: any) => setTemplateType(v)}>
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="job">
                        <FileCode className="mr-2 h-4 w-4" />
                        Job Templates
                      </TabsTrigger>
                      <TabsTrigger value="workflow">
                        <Workflow className="mr-2 h-4 w-4" />
                        Workflows
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search templates..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {loadingTemplates ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : awxTemplates.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">
                        {searchQuery ? `No templates matching "${searchQuery}"` : 'No templates found'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {awxTemplates.map((template) => (
                          <Card
                            key={template.id}
                            className={`cursor-pointer transition-all ${
                              selectedAwxTemplate?.id === template.id
                                ? 'border-primary shadow-md'
                                : 'hover:border-muted-foreground'
                            }`}
                            onClick={() => setSelectedAwxTemplate(template)}
                          >
                            <CardContent className="p-4">
                              <div className="flex items-start gap-3">
                                <div
                                  className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                    templateType === 'workflow'
                                      ? 'bg-purple-500/10'
                                      : 'bg-blue-500/10'
                                  }`}
                                >
                                  {templateType === 'workflow' ? (
                                    <Workflow className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                                  ) : (
                                    <FileCode className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-semibold">{template.name}</h4>
                                  {template.description && (
                                    <p className="text-sm text-muted-foreground line-clamp-1">
                                      {template.description}
                                    </p>
                                  )}
                                </div>
                                {selectedAwxTemplate?.id === template.id && (
                                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>

                      {/* Pagination */}
                      {totalCount > PAGE_SIZE && (
                        <div className="flex items-center justify-between pt-3 border-t">
                          <span className="text-sm text-muted-foreground">
                            {totalCount} templates · Page {page} of {Math.ceil(totalCount / PAGE_SIZE)}
                          </span>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                              disabled={page === 1 || loadingTemplates}
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setPage((p) => Math.min(Math.ceil(totalCount / PAGE_SIZE), p + 1))}
                              disabled={page >= Math.ceil(totalCount / PAGE_SIZE) || loadingTemplates}
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="border-t bg-card px-8 py-4">
        <div className="container mx-auto max-w-7xl flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={currentStep === 'connection'}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/awx/templates')}>
              Cancel
            </Button>
            <Button onClick={handleNext}>
              Next
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
