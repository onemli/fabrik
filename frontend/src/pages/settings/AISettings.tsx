// settings/AISettings.tsx
//
// AI query builder settings — configure the local Ollama instance or bring your
// own API key (OpenAI/Azure/Anthropic/Google/Groq). Per-user keys override the
// platform default. Test Connection sends a "hello" to verify the key works.

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Save, TestTube, CheckCircle, XCircle,
  Eye, EyeOff, Sparkles, Loader2, AlertTriangle, RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { aiService, AISettings as AISettingsType } from '@/services/ai'

// Provider brand icons (inline SVG)
const ProviderIcons: Record<string, React.ReactNode> = {
  openai: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  ),
  anthropic: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.343-3.461H5.017l-1.344 3.46H0L6.57 3.522zm1.04 10.04h4.779L9.949 6.857l-2.34 6.702z" />
    </svg>
  ),
  groq: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" />
    </svg>
  ),
  google: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  ),
  openrouter: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7v10c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5zm0 2.18l8 4.02v8.8c0 4.48-3.03 8.68-7.5 9.86V4.18h-.5z" />
      <path d="M12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4zm0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
    </svg>
  ),
  azure_openai: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.379 23.343a1.62 1.62 0 0 0 1.621-1.621V2.283A1.62 1.62 0 0 0 22.379.662H1.616A1.62 1.62 0 0 0 0 2.283v19.439A1.62 1.62 0 0 0 1.621 23.343zm-5.752-9.22L8.19 6.128l-4.108 8h7.94z" />
    </svg>
  ),
  ollama: (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  ),
}

export default function AISettings() {
  const queryClient = useQueryClient()
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [apiKey, setApiKey] = useState('')
  const [modelName, setModelName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [azureDeployment, setAzureDeployment] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [testingProvider, setTestingProvider] = useState(false)
  const [providerTestResult, setProviderTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)
  const [dynamicModels, setDynamicModels] = useState<string[]>([])
  const [modelsSource, setModelsSource] = useState<'live' | 'fallback' | null>(null)
  const [isFetchingModels, setIsFetchingModels] = useState(false)
  const { data: providersData } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: () => aiService.getAvailableProviders(),
  })

  const { data: userProviderData, isLoading: isLoadingProvider } = useQuery({
    queryKey: ['user-ai-provider'],
    queryFn: () => aiService.getUserProvider(),
  })

  const { data: aiSettings, isLoading: isLoadingAI } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => aiService.getSettings(),
  })

  const saveProviderMutation = useMutation({
    mutationFn: (config: Record<string, unknown>) => aiService.saveUserProvider(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-ai-provider'] })
      queryClient.invalidateQueries({ queryKey: ['ai-status'] })
      toast.success('AI provider saved')
    },
    onError: (err: Error) => toast.error('Failed to save provider', { description: err.message }),
  })

  const updateAIMutation = useMutation({
    mutationFn: (data: Partial<AISettingsType>) => aiService.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-settings'] })
      toast.success('AI settings saved')
    },
    onError: (err: Error) => toast.error('Failed to save settings', { description: err.message }),
  })

  useEffect(() => {
    if (userProviderData?.provider) {
      setSelectedProvider(userProviderData.provider.provider)
      setModelName(userProviderData.provider.model_name || '')
      setBaseUrl(userProviderData.provider.api_base_url || '')
      setAzureDeployment(userProviderData.provider.azure_deployment_name || '')
    }
  }, [userProviderData])

  const providers = providersData?.providers || []
  const currentProvider = providers.find(p => p.id === selectedProvider)
  const userProvider = userProviderData?.provider

  // Reset the dynamic model list whenever the provider changes — the previous
  // provider's models must not leak into the new provider's dropdown.
  useEffect(() => {
    setDynamicModels([])
    setModelsSource(null)
  }, [selectedProvider])

  // Debounced live model fetch. Fires on apiKey / baseUrl / azureDeployment /
  // provider change, but only when it's plausible that a fetch will succeed
  // (either the user typed enough of a key, or a key is already saved for the
  // selected provider, or the provider doesn't need a key — e.g. ollama).
  useEffect(() => {
    if (!selectedProvider || !currentProvider) return

    const hasTypedKey = apiKey.trim().length >= 8
    const hasSavedKey = userProvider?.has_api_key && userProvider.provider === selectedProvider
    const needsKey = currentProvider.requires_api_key
    if (needsKey && !hasTypedKey && !hasSavedKey) return

    let cancelled = false
    const timer = setTimeout(async () => {
      setIsFetchingModels(true)
      try {
        const result = await aiService.listProviderModels({
          provider: selectedProvider,
          api_key: apiKey.trim() || undefined,
          api_base_url: baseUrl.trim() || undefined,
          azure_deployment_name: azureDeployment.trim() || undefined,
        })
        if (cancelled) return
        setDynamicModels(result.models || [])
        setModelsSource(result.source)
        // If the currently selected model isn't offered by the new list,
        // fall back to the provider's default so the UI stays consistent.
        if (result.models?.length && modelName && !result.models.includes(modelName)) {
          setModelName(currentProvider.default_model)
        }
      } catch {
        if (!cancelled) {
          setDynamicModels([])
          setModelsSource(null)
        }
      } finally {
        if (!cancelled) setIsFetchingModels(false)
      }
    }, 600)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider, apiKey, baseUrl, azureDeployment, userProvider?.has_api_key])

  const refreshModels = async () => {
    if (!selectedProvider) return
    setIsFetchingModels(true)
    try {
      const result = await aiService.listProviderModels({
        provider: selectedProvider,
        api_key: apiKey.trim() || undefined,
        api_base_url: baseUrl.trim() || undefined,
        azure_deployment_name: azureDeployment.trim() || undefined,
      })
      setDynamicModels(result.models || [])
      setModelsSource(result.source)
      if (result.models?.length && modelName && !result.models.includes(modelName)) {
        setModelName(currentProvider?.default_model || result.models[0])
      }
    } catch {
      setDynamicModels([])
      setModelsSource(null)
    } finally {
      setIsFetchingModels(false)
    }
  }

  const modelsToShow = dynamicModels.length > 0 ? dynamicModels : (currentProvider?.models || [])

  const handleTestProvider = async () => {
    if (!selectedProvider) return
    setTestingProvider(true)
    setProviderTestResult(null)
    try {
      const result = await aiService.testProvider({
        provider: selectedProvider,
        api_key: apiKey || undefined,
        api_base_url: baseUrl || undefined,
        model_name: modelName || undefined,
        azure_deployment_name: azureDeployment || undefined,
      })
      setProviderTestResult(result)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string }
      setProviderTestResult({
        success: false,
        message: e.response?.data?.error || e.message || 'Test failed',
      })
    } finally {
      setTestingProvider(false)
    }
  }

  const updateSetting = (key: keyof AISettingsType, value: unknown) =>
    updateAIMutation.mutate({ [key]: value })

  if (isLoadingAI || isLoadingProvider) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold">AI</h2>
        <p className="text-sm text-muted-foreground">
          Configure AI provider and query assistant settings.
        </p>
      </div>

      {/* Provider Selection */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Sparkles className="w-6 h-6 text-primary" />
                  AI Provider
                </CardTitle>
                <CardDescription className="mt-1">
                  Choose your AI provider — use your own API key or local Ollama
                </CardDescription>
              </div>
              {userProvider?.has_api_key && (
                <Badge variant="default" className="bg-green-500 hover:bg-green-600">
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Configured
                </Badge>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {providers.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => {
                    setSelectedProvider(provider.id)
                    setApiKey('')
                    setProviderTestResult(null)
                    setModelName(provider.default_model)
                    setBaseUrl(provider.id === 'ollama' ? 'http://localhost:11434' : '')
                  }}
                  className={`relative p-4 rounded-xl border-2 transition-all duration-200 hover:border-primary/50 hover:bg-accent/50 ${
                    selectedProvider === provider.id
                      ? 'border-primary bg-primary/5 shadow-sm'
                      : 'border-border bg-card'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div
                      className={`p-2 rounded-lg ${
                        selectedProvider === provider.id
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {ProviderIcons[provider.id] || <Sparkles className="w-5 h-5" />}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{provider.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {provider.default_model}
                      </p>
                    </div>
                  </div>
                  {provider.note && provider.id === selectedProvider && (
                    <p className="text-xs text-primary mt-2">{provider.note}</p>
                  )}
                  {userProvider?.provider === provider.id && (
                    <div className="absolute top-2 right-2">
                      <div className="w-2 h-2 bg-green-500 rounded-full" />
                    </div>
                  )}
                </button>
              ))}
            </div>

            {selectedProvider && currentProvider && (
              <div className="pt-4 border-t space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  {ProviderIcons[selectedProvider]}
                  {currentProvider.name} Configuration
                </h4>
                <div className="grid gap-4">
                  {currentProvider.requires_api_key && (
                    <div className="space-y-2">
                      <Label htmlFor="api_key">API Key</Label>
                      <div className="relative">
                        <Input
                          id="api_key"
                          type={showApiKey ? 'text' : 'password'}
                          value={apiKey}
                          onChange={e => setApiKey(e.target.value)}
                          placeholder={
                            userProvider?.has_api_key
                              ? '••••••••••••••••'
                              : `Enter your ${currentProvider.name} API key`
                          }
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {userProvider?.has_api_key && userProvider.provider === selectedProvider && (
                        <p className="text-xs text-muted-foreground">
                          API key is already saved. Leave empty to keep current key.
                        </p>
                      )}
                    </div>
                  )}

                  {currentProvider.requires_base_url && (
                    <div className="space-y-2">
                      <Label htmlFor="base_url">
                        {selectedProvider === 'azure_openai' ? 'Azure Endpoint URL' : 'Server URL'}
                      </Label>
                      <Input
                        id="base_url"
                        value={baseUrl}
                        onChange={e => setBaseUrl(e.target.value)}
                        placeholder={
                          selectedProvider === 'azure_openai'
                            ? 'https://your-resource.openai.azure.com'
                            : 'http://localhost:11434'
                        }
                      />
                    </div>
                  )}

                  {currentProvider.requires_deployment_name && (
                    <div className="space-y-2">
                      <Label htmlFor="azure_deployment">Deployment Name</Label>
                      <Input
                        id="azure_deployment"
                        value={azureDeployment}
                        onChange={e => setAzureDeployment(e.target.value)}
                        placeholder="your-deployment-name"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="model" className="flex items-center gap-2">
                        Model
                        {isFetchingModels && (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                        )}
                        {!isFetchingModels && modelsSource === 'live' && (
                          <span className="text-[10px] uppercase tracking-wide text-green-600 dark:text-green-400 font-medium">
                            Live
                          </span>
                        )}
                        {!isFetchingModels && modelsSource === 'fallback' && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                            Defaults
                          </span>
                        )}
                      </Label>
                      <button
                        type="button"
                        onClick={refreshModels}
                        disabled={isFetchingModels}
                        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3 h-3 ${isFetchingModels ? 'animate-spin' : ''}`} />
                        Refresh
                      </button>
                    </div>
                    <Select value={modelName} onValueChange={setModelName}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {modelsToShow.map(m => (
                          <SelectItem key={m} value={m}>
                            {m}
                            {m === currentProvider.default_model && (
                              <span className="ml-2 text-muted-foreground">(recommended)</span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {providerTestResult && (
                  <div
                    className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
                      providerTestResult.success
                        ? 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                        : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                    }`}
                  >
                    {providerTestResult.success ? (
                      <CheckCircle className="w-4 h-4 flex-shrink-0" />
                    ) : (
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                    )}
                    <span>{providerTestResult.message}</span>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={handleTestProvider}
                    disabled={
                      testingProvider ||
                      (!apiKey && currentProvider.requires_api_key && !userProvider?.has_api_key)
                    }
                    className="flex-1"
                  >
                    {testingProvider ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Testing…</>
                    ) : (
                      <><TestTube className="w-4 h-4 mr-2" />Test Connection</>
                    )}
                  </Button>
                  <Button
                    onClick={() =>
                      saveProviderMutation.mutate({
                        provider: selectedProvider,
                        api_key: apiKey || undefined,
                        model_name: modelName || undefined,
                        api_base_url: baseUrl || undefined,
                        azure_deployment_name: azureDeployment || undefined,
                      })
                    }
                    disabled={
                      saveProviderMutation.isPending ||
                      (!apiKey && currentProvider.requires_api_key && !userProvider?.has_api_key)
                    }
                    className="flex-1"
                  >
                    {saveProviderMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                    ) : (
                      <><Save className="w-4 h-4 mr-2" />Save Provider</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Status + Enable + Comparison */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Current Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">AI Feature</span>
                <Badge variant={aiSettings?.enabled ? 'default' : 'secondary'}>
                  {aiSettings?.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Provider</span>
                <span className="text-sm font-medium">
                  {userProvider?.provider_display || 'Not configured'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Model</span>
                <span className="text-sm font-medium font-mono">
                  {userProvider?.model_name || userProvider?.default_model || '-'}
                </span>
              </div>
              {userProvider?.last_error && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-red-500">{userProvider.last_error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-base">Enable AI Assistant</Label>
                  <p className="text-xs text-muted-foreground">AI features in Query Builder</p>
                </div>
                <Switch
                  checked={aiSettings?.enabled || false}
                  onCheckedChange={checked => updateSetting('enabled', checked)}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-amber-200/60 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <CardTitle className="text-base">Token Usage & Quotas</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs space-y-2 text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
              <p>
                Every AI request consumes tokens from your configured provider's quota.
                Complex or repeated queries can exhaust free-tier limits quickly.
              </p>
              <p>
                Free tiers (Groq, Google, some Ollama hosts) typically enforce
                per-minute and per-day rate limits — expect throttling under heavy use.
                Paid providers (OpenAI, Anthropic) bill per token and have higher ceilings.
              </p>
              <p>
                Monitor your provider dashboard for usage, and prefer concise prompts
                over long iterative refinements to keep costs predictable.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  )
}
