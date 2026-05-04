// lib/__tests__/postProcessorEngine.test.ts
//
// Tests for the PostProcessorEngine: DN extraction, regex transform,
// array sort, pattern filter, field extract, and pipeline chaining.

import { describe, it, expect } from 'vitest'
import { PostProcessorEngine } from '../postProcessorEngine'
import type { PostProcessorConfig } from '@/types'

// ── Test data ──

const apicResponse = {
  totalCount: '3',
  imdata: [
    { fvTenant: { attributes: { dn: 'uni/tn-Prod', name: 'Prod', status: 'created' } } },
    { fvTenant: { attributes: { dn: 'uni/tn-Test', name: 'Test', status: 'created' } } },
    { fvTenant: { attributes: { dn: 'uni/tn-Dev', name: 'Dev', status: 'modified' } } },
  ],
}

describe('PostProcessorEngine', () => {
  describe('execute (pipeline)', () => {
    it('runs an empty pipeline and returns data unchanged', () => {
      const data = [{ a: 1 }, { b: 2 }]
      const result = PostProcessorEngine.execute(data, [])
      expect(result).toBe(data)
    })

    it('throws on unknown processor type', () => {
      const processor = { type: 'unknown-type', config: {} } as any

      expect(() => PostProcessorEngine.execute('data', [processor])).toThrow(
        'Unknown processor type'
      )
    })

    it('wraps errors with processor type info', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: { field: 'name' },
      }

      // array-sort on non-array throws
      expect(() => PostProcessorEngine.execute('not-array', [processor])).toThrow(
        'Post-processor "array-sort" failed'
      )
    })

    it('chains multiple processors', () => {
      const processors: PostProcessorConfig[] = [
        { type: 'dn-extract', config: { extractField: 'dn' } },
        { type: 'array-sort', config: {} },
      ]

      const result = PostProcessorEngine.execute(apicResponse, processors) as string[]

      expect(result).toEqual(['uni/tn-Dev', 'uni/tn-Prod', 'uni/tn-Test'])
    })
  })

  describe('dn-extract', () => {
    it('extracts DN values from APIC imdata', () => {
      const processor: PostProcessorConfig = {
        type: 'dn-extract',
        config: { extractField: 'dn' },
      }

      const result = PostProcessorEngine.execute(apicResponse, [processor]) as string[]

      expect(result).toEqual(['uni/tn-Prod', 'uni/tn-Test', 'uni/tn-Dev'])
    })

    it('extracts other fields when configured', () => {
      const processor: PostProcessorConfig = {
        type: 'dn-extract',
        config: { extractField: 'name' },
      }

      const result = PostProcessorEngine.execute(apicResponse, [processor]) as string[]

      expect(result).toEqual(['Prod', 'Test', 'Dev'])
    })

    it('applies removePrefix', () => {
      const processor: PostProcessorConfig = {
        type: 'dn-extract',
        config: { extractField: 'dn', removePrefix: 'uni/' },
      }

      const result = PostProcessorEngine.execute(apicResponse, [processor]) as string[]

      expect(result).toEqual(['tn-Prod', 'tn-Test', 'tn-Dev'])
    })

    it('applies extractPattern with capture group', () => {
      const processor: PostProcessorConfig = {
        type: 'dn-extract',
        config: { extractField: 'dn', extractPattern: 'tn-(.+)' },
      }

      const result = PostProcessorEngine.execute(apicResponse, [processor]) as string[]

      expect(result).toEqual(['Prod', 'Test', 'Dev'])
    })

    it('returns empty array for non-APIC data', () => {
      const processor: PostProcessorConfig = {
        type: 'dn-extract',
        config: { extractField: 'dn' },
      }

      const result = PostProcessorEngine.execute({ foo: 'bar' }, [processor])

      expect(result).toEqual([])
    })
  })

  describe('regex-transform', () => {
    it('applies regex replacement on array of strings', () => {
      const processor: PostProcessorConfig = {
        type: 'regex-transform',
        config: { pattern: 'uni/tn-', replacement: '', flags: 'g' },
      }

      const input = ['uni/tn-Prod', 'uni/tn-Test']
      const result = PostProcessorEngine.execute(input, [processor])

      expect(result).toEqual(['Prod', 'Test'])
    })

    it('applies regex replacement on single string', () => {
      const processor: PostProcessorConfig = {
        type: 'regex-transform',
        config: { pattern: '\\s+', replacement: '-', flags: 'g' },
      }

      const result = PostProcessorEngine.execute('hello world foo', [processor])

      expect(result).toBe('hello-world-foo')
    })

    it('returns non-string data unchanged', () => {
      const processor: PostProcessorConfig = {
        type: 'regex-transform',
        config: { pattern: 'x', replacement: 'y' },
      }

      const result = PostProcessorEngine.execute(42, [processor])

      expect(result).toBe(42)
    })
  })

  describe('array-sort', () => {
    it('sorts strings alphabetically', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: {},
      }

      const result = PostProcessorEngine.execute(['cherry', 'apple', 'banana'], [processor])

      expect(result).toEqual(['apple', 'banana', 'cherry'])
    })

    it('sorts numerically when configured', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: { numeric: true },
      }

      const result = PostProcessorEngine.execute(['10', '2', '1', '20'], [processor])

      expect(result).toEqual(['1', '2', '10', '20'])
    })

    it('reverses when configured', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: { reverse: true },
      }

      const result = PostProcessorEngine.execute(['a', 'c', 'b'], [processor])

      expect(result).toEqual(['c', 'b', 'a'])
    })

    it('removes duplicates when unique is set', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: { unique: true },
      }

      const result = PostProcessorEngine.execute(['a', 'b', 'a', 'c', 'b'], [processor])

      expect(result).toEqual(['a', 'b', 'c'])
    })

    it('sorts objects by field', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: { field: 'name' },
      }

      const input = [{ name: 'Charlie' }, { name: 'Alice' }, { name: 'Bob' }]
      const result = PostProcessorEngine.execute(input, [processor]) as any[]

      expect(result[0].name).toBe('Alice')
      expect(result[1].name).toBe('Bob')
      expect(result[2].name).toBe('Charlie')
    })

    it('throws on non-array input', () => {
      const processor: PostProcessorConfig = {
        type: 'array-sort',
        config: {},
      }

      expect(() => PostProcessorEngine.execute('not-array', [processor])).toThrow()
    })
  })

  describe('pattern-filter', () => {
    it('includes items matching pattern', () => {
      const processor: PostProcessorConfig = {
        type: 'pattern-filter',
        config: { includePatterns: ['Prod'] },
      }

      const result = PostProcessorEngine.execute(
        ['uni/tn-Prod', 'uni/tn-Test', 'uni/tn-Dev'],
        [processor]
      )

      expect(result).toEqual(['uni/tn-Prod'])
    })

    it('excludes items matching pattern', () => {
      const processor: PostProcessorConfig = {
        type: 'pattern-filter',
        config: { excludePatterns: ['Test'] },
      }

      const result = PostProcessorEngine.execute(
        ['uni/tn-Prod', 'uni/tn-Test', 'uni/tn-Dev'],
        [processor]
      )

      expect(result).toEqual(['uni/tn-Prod', 'uni/tn-Dev'])
    })

    it('supports case-insensitive matching', () => {
      const processor: PostProcessorConfig = {
        type: 'pattern-filter',
        config: { includePatterns: ['prod'], caseSensitive: false },
      }

      const result = PostProcessorEngine.execute(['Prod', 'Test'], [processor])

      expect(result).toEqual(['Prod'])
    })

    it('filters objects by field', () => {
      const processor: PostProcessorConfig = {
        type: 'pattern-filter',
        config: { field: 'status', includePatterns: ['created'] },
      }

      const input = [
        { name: 'A', status: 'created' },
        { name: 'B', status: 'modified' },
        { name: 'C', status: 'created' },
      ]

      const result = PostProcessorEngine.execute(input, [processor]) as any[]

      expect(result).toHaveLength(2)
      expect(result.every((r: any) => r.status === 'created')).toBe(true)
    })
  })

  describe('field-extract', () => {
    it('extracts specified fields from objects', () => {
      const processor: PostProcessorConfig = {
        type: 'field-extract',
        config: { fields: ['name', 'status'] },
      }

      const input = [
        { name: 'Prod', status: 'active', dn: 'uni/tn-Prod', extra: 'data' },
        { name: 'Test', status: 'inactive', dn: 'uni/tn-Test', extra: 'more' },
      ]

      const result = PostProcessorEngine.execute(input, [processor]) as any[]

      expect(result).toEqual([
        { name: 'Prod', status: 'active' },
        { name: 'Test', status: 'inactive' },
      ])
    })

    it('throws when no fields specified', () => {
      const processor: PostProcessorConfig = {
        type: 'field-extract',
        config: { fields: [] },
      }

      expect(() => PostProcessorEngine.execute([{}], [processor])).toThrow(
        'at least one field'
      )
    })
  })

})
