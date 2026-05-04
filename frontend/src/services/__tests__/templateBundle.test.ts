/**
 * Template Bundle Service Tests
 *
 * CRITICAL: These tests verify the import/export functionality ($10,000 requirement)
 * - Template export to JSON
 * - Template import from JSON
 * - Query + Template bundling
 * - Version compatibility
 * - Validation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  exportTemplateBundle,
  importTemplateBundle,
  exportTemplate,
  importTemplate,
  validateTemplateCompatibility,
  type TemplateBundle,
} from '../templateBundle'

// Mock DOM APIs
global.URL.createObjectURL = vi.fn(() => 'blob:mock-url')
global.URL.revokeObjectURL = vi.fn()

describe('templateBundle Service', () => {
  let mockLink: HTMLAnchorElement

  beforeEach(() => {
    // Mock document.createElement for download links
    mockLink = {
      href: '',
      download: '',
      click: vi.fn(),
    } as any

    vi.spyOn(document, 'createElement').mockReturnValue(mockLink)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockLink)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockLink)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('exportTemplate', () => {
    it('CRITICAL: should export template as JSON file', () => {
      const templateData = {
        template_name: 'Test Template',
        description: 'Test description',
        class_name: 'fvTenant',
        columns: [{ field: 'name', label: 'Name', visible: true, order: 0, dataType: 'string' as const }],
        preferences: { columnOrder: ['name'] },
        default_filters: [],
        default_sorting: [],
      }

      exportTemplate(templateData)

      // Verify link was created and clicked
      expect(document.createElement).toHaveBeenCalledWith('a')
      expect(mockLink.click).toHaveBeenCalled()
      expect(mockLink.download).toContain('test_template')
      expect(mockLink.download).toContain('.json')
    })

    it('should sanitize filename', () => {
      const templateData = {
        template_name: 'My Template! @#$',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      exportTemplate(templateData)

      // Special characters should be replaced with underscores
      expect(mockLink.download).toMatch(/my_template/)
      expect(mockLink.download).not.toContain('!')
      expect(mockLink.download).not.toContain('@')
    })

    it('should include version and timestamp', () => {
      const templateData = {
        template_name: 'Test',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      // Mock Blob to capture exported data
      let capturedData: string = ''
      const OriginalBlob = global.Blob
      global.Blob = class MockBlob extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          capturedData = parts[0] as string
          super(parts, options)
        }
      } as any

      exportTemplate(templateData)

      const exportedJson = JSON.parse(capturedData)

      expect(exportedJson.version).toBe('1.0')
      expect(exportedJson.exportedAt).toBeDefined()
      expect(exportedJson.template).toEqual(templateData)

      // Restore original Blob
      global.Blob = OriginalBlob
    })
  })

  describe('importTemplate', () => {
    it('CRITICAL: should import valid template JSON', async () => {
      const templateData = {
        template_name: 'Imported Template',
        class_name: 'fvBD',
        columns: [],
        preferences: {},
      }

      const fileContent = JSON.stringify({
        version: '1.0',
        exportedAt: new Date().toISOString(),
        template: templateData,
      })

      const file = new File([fileContent], 'template.json', { type: 'application/json' })

      const result = await importTemplate(file)

      expect(result).toEqual(templateData)
    })

    it('should reject invalid JSON', async () => {
      const file = new File(['invalid json {'], 'template.json', { type: 'application/json' })

      await expect(importTemplate(file)).rejects.toThrow('Failed to parse template')
    })

    it('should reject template without required structure', async () => {
      const fileContent = JSON.stringify({
        version: '1.0',
        // Missing 'template' field
      })

      const file = new File([fileContent], 'template.json', { type: 'application/json' })

      await expect(importTemplate(file)).rejects.toThrow('Invalid template format')
    })
  })

  describe('exportTemplateBundle', () => {
    it('CRITICAL: should export query + template bundle', () => {
      const queryData = {
        id: 'query-1',
        name: 'Test Query',
        flowData: { nodes: [], edges: [] },
        className: 'fvTenant',
      }

      const templateData = {
        template_name: 'Test Template',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      const metadata = {
        exportedBy: 'user@example.com',
        notes: 'Test bundle',
      }

      exportTemplateBundle(queryData, templateData, metadata)

      expect(mockLink.click).toHaveBeenCalled()
      expect(mockLink.download).toContain('test_query_bundle')
    })

    it('should create valid bundle structure', () => {
      const queryData = {
        name: 'Query',
        flowData: {},
      }

      const templateData = {
        template_name: 'Template',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      // Mock Blob to capture exported data
      let capturedData: string = ''
      const OriginalBlob = global.Blob
      global.Blob = class MockBlob extends OriginalBlob {
        constructor(parts: BlobPart[], options?: BlobPropertyBag) {
          capturedData = parts[0] as string
          super(parts, options)
        }
      } as any

      exportTemplateBundle(queryData, templateData)

      const bundle: TemplateBundle = JSON.parse(capturedData)

      expect(bundle.version).toBe('1.0')
      expect(bundle.exportedAt).toBeDefined()
      expect(bundle.bundle.query).toEqual(queryData)
      expect(bundle.bundle.template).toEqual(templateData)
      expect(bundle.bundle.metadata).toBeDefined()

      // Restore original Blob
      global.Blob = OriginalBlob
    })
  })

  describe('importTemplateBundle', () => {
    it('CRITICAL: should import valid bundle', async () => {
      const bundleData: TemplateBundle = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        bundle: {
          query: {
            name: 'Test Query',
            flowData: {},
          },
          template: {
            template_name: 'Test Template',
            class_name: 'fvTenant',
            columns: [],
            preferences: {},
          },
          metadata: {},
        },
      }

      const fileContent = JSON.stringify(bundleData)
      const file = new File([fileContent], 'bundle.json', { type: 'application/json' })

      const result = await importTemplateBundle(file)

      expect(result).toEqual(bundleData)
    })

    it('should reject invalid bundle format', async () => {
      const fileContent = JSON.stringify({
        version: '1.0',
        // Missing bundle field
      })

      const file = new File([fileContent], 'bundle.json', { type: 'application/json' })

      await expect(importTemplateBundle(file)).rejects.toThrow('Invalid bundle format')
    })

    it('should reject bundle missing query or template', async () => {
      const fileContent = JSON.stringify({
        version: '1.0',
        bundle: {
          query: {},
          // Missing template
        },
      })

      const file = new File([fileContent], 'bundle.json', { type: 'application/json' })

      await expect(importTemplateBundle(file)).rejects.toThrow('Bundle missing required data')
    })

    it('accepts bundles with different version without warning', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const bundleData: TemplateBundle = {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        bundle: {
          query: { name: 'Query', flowData: {} },
          template: {
            template_name: 'Template',
            class_name: 'fvTenant',
            columns: [],
            preferences: {},
          },
          metadata: {},
        },
      }

      const fileContent = JSON.stringify(bundleData)
      const file = new File([fileContent], 'bundle.json', { type: 'application/json' })

      const result = await importTemplateBundle(file)

      expect(result.version).toBe('2.0')
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })
  })

  describe('validateTemplateCompatibility', () => {
    it('CRITICAL: should validate compatible template', () => {
      const template = {
        class_name: 'fvTenant',
        columns: [
          { field: 'name', label: 'Name', visible: true, order: 0, dataType: 'string' },
        ],
      }

      const result = validateTemplateCompatibility(template, 'fvTenant')

      expect(result.compatible).toBe(true)
      expect(result.warnings).toEqual([])
    })

    it('should warn about class name mismatch', () => {
      const template = {
        class_name: 'fvBD',
        columns: [],
      }

      const result = validateTemplateCompatibility(template, 'fvTenant')

      expect(result.compatible).toBe(false)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('fvBD')
      expect(result.warnings[0]).toContain('fvTenant')
    })

    it('should warn about invalid column configuration', () => {
      const template = {
        class_name: 'fvTenant',
        columns: 'invalid', // Should be array
      }

      const result = validateTemplateCompatibility(template, 'fvTenant')

      expect(result.compatible).toBe(false)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some(w => w.includes('invalid column configuration'))).toBe(true)
    })

    it('should handle multiple warnings', () => {
      const template = {
        class_name: 'fvBD', // Wrong class
        columns: null, // Invalid columns
      }

      const result = validateTemplateCompatibility(template, 'fvTenant')

      expect(result.compatible).toBe(false)
      expect(result.warnings.length).toBe(2)
    })
  })

  describe('Filename Sanitization', () => {
    it('should handle special characters', () => {
      const templateData = {
        template_name: 'Test/Template\\With:Special*Chars?',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      exportTemplate(templateData)

      expect(mockLink.download).toMatch(/test_template_with_special_chars/)
    })

    it('should handle multiple underscores', () => {
      const templateData = {
        template_name: 'Test___Multiple___Underscores',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      exportTemplate(templateData)

      // Multiple underscores should be collapsed to single
      expect(mockLink.download).not.toMatch(/___/)
    })

    it('should lowercase filename', () => {
      const templateData = {
        template_name: 'UPPERCASE_TEMPLATE',
        class_name: 'fvTenant',
        columns: [],
        preferences: {},
      }

      exportTemplate(templateData)

      expect(mockLink.download).toMatch(/^[a-z0-9_]+\.json$/)
    })
  })

  describe('FileReader Integration', () => {
    it('should handle file read errors', async () => {
      // Create a file that will trigger an error
      const file = new File([''], 'template.json', { type: 'application/json' })

      // Mock FileReader to simulate error
      const originalFileReader = global.FileReader
      global.FileReader = class {
        readAsText() {
          setTimeout(() => {
            if (this.onerror) {
              this.onerror(new Error('Read failed') as any)
            }
          }, 0)
        }
        addEventListener() {}
        onerror: ((event: any) => void) | null = null
        onload: ((event: any) => void) | null = null
      } as any

      await expect(importTemplate(file)).rejects.toThrow('Failed to read file')

      global.FileReader = originalFileReader
    })
  })
})
