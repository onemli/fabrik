# Error Handling Guide

Professional error handling system for converting technical errors into user-friendly messages.

## Quick Start

```typescript
import { toast } from '@/lib/toast'

// ✅ Simple success
toast.success('Connection saved successfully')

// ✅ Error with automatic formatting
try {
  await apicService.testConnection(connectionId)
} catch (error) {
  toast.error(error, 'apic')  // Context helps provide specific messages
}

// ✅ Promise with loading state
await toast.promise(
  api.post('/api/automation/execute'),
  {
    loading: 'Launching automation...',
    success: 'Automation started successfully',
    error: 'Failed to launch automation'
  },
  'awx'
)
```

## Error Contexts

Use context for specialized error messages:

| Context | Use For | Example |
|---------|---------|---------|
| `'apic'` | APIC connections, queries | Connection failures, auth errors |
| `'awx'` | AWX/Ansible operations | Job template errors, execution failures |
| `'neo4j'` | Database operations | Query errors, connection issues |
| `'query'` | ACI query execution | No results, invalid classes, timeouts |
| `'validation'` | Form/data validation | Field validation errors |
| `'upload'` | File uploads | File size, format errors |
| `'ai'` | AI/LLM operations | Service unavailable, low confidence |

## Error Message Transformation

### Before (Technical)
```
HTTP 503 Service Unavailable
ECONNREFUSED
Cypher query execution failed
```

### After (User-Friendly)
```
✅ "APIC Connection Failed"
   "Unable to connect to APIC. The server may be down or unreachable."
   "Verify the APIC URL and network connection"

✅ "AWX Service Unavailable"
   "AWX is not responding or may be under maintenance."
   "Check AWX server status"

✅ "Query Error"
   "The database query could not be executed."
```

## API Error Class

All API errors are automatically wrapped in `APIError`:

```typescript
try {
  await api.post('/api/query')
} catch (error) {
  // error is APIError instance with:
  error.title              // "Query Timeout"
  error.description        // "The query took too long..."
  error.suggestedAction    // "Simplify the query..."
  error.status             // 504
}
```

## HTTP Status Code Mapping

| Code | Title | Description |
|------|-------|-------------|
| 400 | Invalid Request | The request contains invalid data |
| 401 | Session Expired | Your session has expired |
| 403 | Unauthorized | No permission for this operation |
| 404 | Not Found | Resource not found or deleted |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unexpected error occurred |
| 503 | Service Unavailable | Service temporarily unavailable |
| 504 | Request Timeout | Request took too long |

## Best Practices

### ✅ DO

```typescript
// Use context for specific errors
toast.error(error, 'apic')

// Provide descriptive success messages
toast.success('APIC connection saved', {
  description: 'Connection to prod-apic-01 configured successfully'
})

// Use promise toast for async operations
await toast.promise(
  longRunningOperation(),
  {
    loading: 'Processing...',
    success: 'Completed',
    error: 'Failed'
  }
)
```

### ❌ DON'T

```typescript
// Don't show raw error objects
toast.error(error.toString())

// Don't use technical jargon
toast.error('HTTP 503', { description: 'ECONNREFUSED' })

// Don't forget context on domain-specific operations
toast.error(error)  // Missing context!
```

## Custom Error Messages (Backend)

Backend can provide user-friendly messages:

```python
# Django backend
return Response({
    'user_message': 'Connection Test Failed',
    'detail': 'Unable to authenticate with APIC. Check credentials.',
}, status=400)
```

Frontend automatically uses `user_message` if available.

## Sanitizing Error Messages

```typescript
import { sanitizeErrorMessage } from '@/lib/errorHandler'

const raw = 'File not found at /usr/local/app/queries.py [Errno 2]'
const clean = sanitizeErrorMessage(raw)
// Result: "File not found"
```

## Network Error Handling

Network failures are automatically detected:

```typescript
// User sees:
"Network Connection Error"
"Please check your internet connection."
"If connected, check VPN or firewall settings"
```

## Migration from Legacy Code

### Before
```typescript
toast.error('Failed to save')
toast.error(error.response?.data?.error || 'Error')
toast.error(`Error: ${error.message}`)
```

### After
```typescript
toast.error(error, 'apic')  // Automatic formatting!
```

## Testing

```typescript
import { formatError } from '@/lib/errorHandler'

describe('Error Handling', () => {
  it('formats APIC connection errors', () => {
    const error = { code: 'ECONNREFUSED' }
    const formatted = formatError(error, 'apic')

    expect(formatted.title).toBe('APIC Connection Failed')
    expect(formatted.suggestedAction).toBeDefined()
  })
})
```

## Type Safety

```typescript
import { FormattedError } from '@/lib/errorHandler'

function handleError(error: any): FormattedError {
  return formatError(error, 'query')
}
```

---

**Last Updated**: 2026-01-24
**Version**: 1.0.0
