// services/templateBundle.ts
//
// Handles bundling a saved query together with its SmartTable column template
// into a single portable JSON file. Used by the Library import/export flow when
// the user wants to share a query along with its custom column layout.

export interface TemplateBundle {
  version: string
  exportedAt: string
  bundle: {
    query: {
      id?: string
      name: string
      flowData: any
      className?: string
    }
    template: {
      template_name: string
      description?: string
      class_name: string
      columns: any[]
      preferences: any
      default_filters?: any[]
      default_sorting?: any[]
    }
    metadata: {
      exportedBy?: string
      notes?: string
    }
  }
}

/**
 * Export query and template as downloadable bundle
 */
export function exportTemplateBundle(
  queryData: {
    id?: string
    name: string
    flowData: any
    className?: string
  },
  templateData: {
    template_name: string
    description?: string
    class_name: string
    columns: any[]
    preferences: any
    default_filters?: any[]
    default_sorting?: any[]
  },
  metadata?: {
    exportedBy?: string
    notes?: string
  }
): void {
  const bundle: TemplateBundle = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    bundle: {
      query: queryData,
      template: templateData,
      metadata: metadata || {}
    }
  }

  // Create blob and download
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json'
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeFilename(queryData.name)}_bundle_${Date.now()}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Import template bundle from file
 */
export async function importTemplateBundle(file: File): Promise<TemplateBundle> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const bundle = JSON.parse(content) as TemplateBundle

        // Validate bundle structure
        if (!bundle.version || !bundle.bundle) {
          throw new Error('Invalid bundle format')
        }

        if (!bundle.bundle.query || !bundle.bundle.template) {
          throw new Error('Bundle missing required data')
        }

        resolve(bundle)
      } catch (error) {
        reject(new Error(`Failed to parse bundle: ${(error as Error).message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsText(file)
  })
}

/**
 * Export template only (without query)
 */
export function exportTemplate(
  templateData: {
    template_name: string
    description?: string
    class_name: string
    columns: any[]
    preferences: any
    default_filters?: any[]
    default_sorting?: any[]
  }
): void {
  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    template: templateData
  }

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeFilename(templateData.template_name)}_template_${Date.now()}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Import template only (without query)
 */
export async function importTemplate(file: File): Promise<any> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const data = JSON.parse(content)

        if (!data.template) {
          throw new Error('Invalid template format')
        }

        resolve(data.template)
      } catch (error) {
        reject(new Error(`Failed to parse template: ${(error as Error).message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Failed to read file'))
    }

    reader.readAsText(file)
  })
}

/**
 * Sanitize filename for download
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/_+/g, '_')
    .toLowerCase()
}

/**
 * Validate template compatibility with current class
 */
export function validateTemplateCompatibility(
  template: any,
  currentClassName: string
): {
  compatible: boolean
  warnings: string[]
} {
  const warnings: string[] = []

  if (template.class_name !== currentClassName) {
    warnings.push(
      `Template is for ${template.class_name} but current class is ${currentClassName}`
    )
  }

  if (!template.columns || !Array.isArray(template.columns)) {
    warnings.push('Template has invalid column configuration')
  }

  const compatible = warnings.length === 0
  return { compatible, warnings }
}
