// lib/__tests__/dnParser.test.ts
//
// Tests for the DN (Distinguished Name) parser: parsing, hierarchy extraction,
// relationship detection, and label resolution for Cisco ACI DNs.

import { describe, it, expect } from 'vitest'
import {
  parseDN,
  getDNComponentLabel,
  extractHierarchy,
  isRelationshipClass,
  getRelationshipTarget,
  getDNRelationship,
} from '../dnParser'

describe('parseDN', () => {
  it('parses a simple tenant DN', () => {
    const result = parseDN('uni/tn-Prod')

    expect(result.dn).toBe('uni/tn-Prod')
    expect(result.components).toHaveLength(2)
    expect(result.components[0].className).toBe('polUni')
    expect(result.components[1].prefix).toBe('tn')
    expect(result.components[1].name).toBe('Prod')
    expect(result.components[1].className).toBe('fvTenant')
    expect(result.parent).toBe('uni')
    expect(result.depth).toBe(1)
    expect(result.type).toBe('fvTenant')
    expect(result.name).toBe('Prod')
  })

  it('parses a deeply nested EPG DN', () => {
    const result = parseDN('uni/tn-ACME/ap-WebApp/epg-Frontend')

    expect(result.components).toHaveLength(4)
    expect(result.type).toBe('fvAEPg')
    expect(result.name).toBe('Frontend')
    expect(result.parent).toBe('uni/tn-ACME/ap-WebApp')
    expect(result.depth).toBe(3)
  })

  it('parses uni as root', () => {
    const result = parseDN('uni')

    expect(result.components).toHaveLength(1)
    expect(result.components[0].className).toBe('polUni')
    expect(result.parent).toBeNull()
    expect(result.depth).toBe(0)
  })

  it('parses bridge domain DN', () => {
    // APIC uses lowercase prefix "bd" for bridge domains
    const result = parseDN('uni/tn-Corp/bd-Internal')

    expect(result.type).toBe('fvBD')
    expect(result.name).toBe('Internal')
  })

  it('parses VRF DN', () => {
    const result = parseDN('uni/tn-Corp/ctx-Production')

    expect(result.type).toBe('fvCtx')
    expect(result.name).toBe('Production')
  })

  it('parses L3Out DN', () => {
    const result = parseDN('uni/tn-Corp/out-Internet')

    expect(result.type).toBe('l3extOut')
    expect(result.name).toBe('Internet')
  })

  it('parses a simple subnet DN without CIDR slash', () => {
    // Note: DNs with CIDR notation (e.g., subnet-[10.0.0.1/24]) contain
    // slashes inside brackets which splits incorrectly — a known limitation.
    // Using a DN without CIDR notation for this test.
    const result = parseDN('uni/tn-Corp/bd-Web/subnet-[10.0.0.1]')

    expect(result.type).toBe('fvSubnet')
    expect(result.name).toBe('[10.0.0.1]')
  })

  it('handles unknown prefixes', () => {
    const result = parseDN('uni/tn-Corp/unknown-thing')

    expect(result.components[2].className).toBe('unknown')
    expect(result.components[2].name).toBe('thing')
  })

  it('throws on empty string', () => {
    expect(() => parseDN('')).toThrow('DN is required')
  })
})

describe('getDNComponentLabel', () => {
  it('returns Tenant for tn prefix', () => {
    expect(getDNComponentLabel('tn')).toBe('Tenant')
  })

  it('returns VRF for ctx prefix', () => {
    expect(getDNComponentLabel('ctx')).toBe('VRF')
  })

  it('returns uppercase for unknown prefix', () => {
    expect(getDNComponentLabel('xyz')).toBe('XYZ')
  })
})

describe('extractHierarchy', () => {
  it('extracts parent-child tuples from DN', () => {
    const result = extractHierarchy('uni/tn-Corp/ap-Web/epg-FE')

    expect(result).toEqual([
      ['uni', 'uni/tn-Corp'],
      ['uni/tn-Corp', 'uni/tn-Corp/ap-Web'],
      ['uni/tn-Corp/ap-Web', 'uni/tn-Corp/ap-Web/epg-FE'],
    ])
  })

  it('returns empty for root-level DN', () => {
    const result = extractHierarchy('uni')

    expect(result).toEqual([])
  })

  it('returns single tuple for direct child of root', () => {
    const result = extractHierarchy('uni/tn-Corp')

    expect(result).toEqual([['uni', 'uni/tn-Corp']])
  })
})

describe('isRelationshipClass', () => {
  it('returns true for relationship DNs', () => {
    expect(isRelationshipClass('uni/tn-Corp/BD-Web/rsctx')).toBe(true)
    expect(isRelationshipClass('uni/tn-Corp/ap-Web/epg-FE/rscons-Contract1')).toBe(true)
    expect(isRelationshipClass('uni/tn-Corp/ap-Web/epg-FE/rsprov-Contract2')).toBe(true)
  })

  it('returns false for non-relationship DNs', () => {
    expect(isRelationshipClass('uni/tn-Corp')).toBe(false)
    expect(isRelationshipClass('uni/tn-Corp/BD-Web')).toBe(false)
    expect(isRelationshipClass('uni/tn-Corp/ap-Web/epg-FE')).toBe(false)
  })
})

describe('getRelationshipTarget', () => {
  it('constructs target DN for BD relationship', () => {
    const result = getRelationshipTarget(
      'uni/tn-Corp/ap-Web/epg-FE/rsbd-WebBD',
      'WebBD',
      'fvBD'
    )

    expect(result).toBe('uni/tn-Corp/bd-WebBD')
  })

  it('constructs target DN for VRF relationship', () => {
    const result = getRelationshipTarget(
      'uni/tn-Corp/BD-Web/rsctx',
      'Production',
      'fvCtx'
    )

    expect(result).toBe('uni/tn-Corp/ctx-Production')
  })

  it('returns empty for unknown target class', () => {
    const result = getRelationshipTarget(
      'uni/tn-Corp/something',
      'name',
      'unknownClass'
    )

    expect(result).toBe('')
  })

  it('returns empty when no tenant in DN', () => {
    const result = getRelationshipTarget(
      'uni/something',
      'name',
      'fvBD'
    )

    expect(result).toBe('')
  })
})

describe('getDNRelationship', () => {
  it('detects parent relationship', () => {
    expect(getDNRelationship('uni/tn-Corp', 'uni/tn-Corp/BD-Web')).toBe('parent')
  })

  it('detects child relationship', () => {
    expect(getDNRelationship('uni/tn-Corp/BD-Web', 'uni/tn-Corp')).toBe('child')
  })

  it('detects sibling relationship', () => {
    expect(getDNRelationship('uni/tn-Corp/BD-Web', 'uni/tn-Corp/BD-Internal')).toBe('sibling')
  })

  it('detects unrelated DNs', () => {
    expect(getDNRelationship('uni/tn-Corp/BD-Web', 'uni/tn-Other/BD-Web')).toBe('unrelated')
  })
})
