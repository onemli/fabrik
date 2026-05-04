// services/classCache.ts
//
// IndexedDB-based cache for ACI class metadata (17500+ classes). Synced once
// from the backend and then served locally for instant search. Fuse.js handles
// fuzzy matching client-side so the class browser feels snappy even on slow
// connections. Cache is invalidated when the sync timestamp changes.

import Fuse from 'fuse.js'
import type { MIMClass } from '@/types'

const DB_NAME = 'FabrikClassCache'
const DB_VERSION = 1
const STORE_NAME = 'classes'
const CACHE_DURATION_MS = 24 * 60 * 60 * 1000 // 24 hours

interface CacheMetadata {
  lastUpdated: number
  classCount: number
  version: string
}

class ClassCacheService {
  private db: IDBDatabase | null = null
  private fuse: Fuse<MIMClass> | null = null
  private classes: MIMClass[] = []
  private initPromise: Promise<void> | null = null

  /**
   * Initialize IndexedDB and Fuse.js search
   */
  async init(): Promise<void> {
    // Return existing initialization if in progress
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = this._init()
    return this.initPromise
  }

  private async _init(): Promise<void> {
    // Open IndexedDB
    await this.openDB()

    // Load classes from cache
    const cached = await this.loadFromCache()

    if (cached && cached.length > 0) {
      this.classes = cached
      this.initFuse()
    }
  }

  /**
   * Open IndexedDB connection
   */
  private async openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create object store for classes
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'className' })
          store.createIndex('classPkg', 'classPkg', { unique: false })
          store.createIndex('label', 'label', { unique: false })
        }

        // Create metadata store
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' })
        }
      }
    })
  }

  /**
   * Load all classes from IndexedDB cache
   */
  private async loadFromCache(): Promise<MIMClass[] | null> {
    if (!this.db) return null

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()

      request.onsuccess = () => {
        resolve(request.result)
      }

      request.onerror = () => {
        resolve(null)
      }
    })
  }

  /**
   * Save classes to IndexedDB cache
   */
  async saveToCache(classes: MIMClass[]): Promise<void> {
    if (!this.db) {
      await this.openDB()
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, 'metadata'], 'readwrite')
      const classStore = transaction.objectStore(STORE_NAME)
      const metadataStore = transaction.objectStore('metadata')

      // Clear existing data
      classStore.clear()

      // Add all classes
      classes.forEach((cls) => {
        classStore.add(cls)
      })

      // Save metadata
      const metadata: CacheMetadata = {
        lastUpdated: Date.now(),
        classCount: classes.length,
        version: DB_VERSION.toString(),
      }
      metadataStore.put({ key: 'metadata', ...metadata })

      transaction.oncomplete = () => {
        this.classes = classes
        this.initFuse()
        resolve()
      }

      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Initialize Fuse.js for fuzzy search
   */
  private initFuse(): void {
    this.fuse = new Fuse(this.classes, {
      keys: [
        { name: 'className', weight: 0.5 },
        { name: 'label', weight: 0.3 },
        { name: 'classPkg', weight: 0.2 },
      ],
      threshold: 0.3, // Typo tolerance (0 = exact, 1 = match anything)
      includeScore: true,
      minMatchCharLength: 2,
      shouldSort: true,
    })
  }

  /**
   * Search classes using Fuse.js (client-side fuzzy search)
   */
  async search(query: string, limit = 50, packageFilter?: string): Promise<MIMClass[]> {
    if (!this.fuse || this.classes.length === 0) {
      // Cache not ready, return empty
      return []
    }

    let results = this.fuse.search(query, { limit: limit * 2 }) // Get more results for filtering

    // Filter by package if specified
    if (packageFilter) {
      results = results.filter((r) => r.item.classPkg === packageFilter)
    }

    // Return top results
    return results.slice(0, limit).map((r) => r.item)
  }

  /**
   * Get all classes (useful for initial load)
   */
  async getAllClasses(): Promise<MIMClass[]> {
    return this.classes
  }

  /**
   * Get classes by package
   */
  async getClassesByPackage(packageName: string): Promise<MIMClass[]> {
    if (!this.db) return []

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const index = store.index('classPkg')
      const request = index.getAll(packageName)

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        resolve([])
      }
    })
  }

  /**
   * Check if cache is stale
   */
  async isCacheStale(): Promise<boolean> {
    if (!this.db) return true

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly')
      const store = transaction.objectStore('metadata')
      const request = store.get('metadata')

      request.onsuccess = () => {
        if (!request.result) {
          resolve(true)
          return
        }

        const metadata = request.result as CacheMetadata
        const age = Date.now() - metadata.lastUpdated
        resolve(age > CACHE_DURATION_MS)
      }

      request.onerror = () => resolve(true)
    })
  }

  /**
   * Get cache metadata
   */
  async getMetadata(): Promise<CacheMetadata | null> {
    if (!this.db) return null

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly')
      const store = transaction.objectStore('metadata')
      const request = store.get('metadata')

      request.onsuccess = () => {
        resolve(request.result || null)
      }

      request.onerror = () => resolve(null)
    })
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    if (!this.db) return

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, 'metadata'], 'readwrite')
      const classStore = transaction.objectStore(STORE_NAME)
      const metadataStore = transaction.objectStore('metadata')

      classStore.clear()
      metadataStore.clear()

      transaction.oncomplete = () => {
        this.classes = []
        this.fuse = null
        resolve()
      }

      transaction.onerror = () => reject(transaction.error)
    })
  }

  /**
   * Get cache size
   */
  getCacheSize(): number {
    return this.classes.length
  }

  /**
   * Check if cache is ready
   */
  isReady(): boolean {
    return this.fuse !== null && this.classes.length > 0
  }
}

// Singleton instance
export const classCache = new ClassCacheService()
