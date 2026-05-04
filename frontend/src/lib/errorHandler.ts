// lib/errorHandler.ts
//
// Converts raw HTTP errors, network failures, and backend exception responses
// into user-friendly messages. The context parameter (e.g. 'apic', 'query')
// lets the formatter tailor the message to the specific failure domain so
// "connection refused" reads differently for an APIC error vs a backend error.

export interface FormattedError {
  title: string
  description: string
  suggestedAction?: string
}

type ErrorContext = 'apic' | 'awx' | 'neo4j' | 'query' | 'validation' | 'upload' | 'ai' | 'pipeline'

/**
 * HTTP Status Code Error Messages
 */
const HTTP_STATUS_ERRORS: Record<number, FormattedError> = {
  // 4xx Client Errors
  400: {
    title: 'Invalid Request',
    description: 'The request contains invalid data. Please check your input.',
  },
  401: {
    title: 'Session Expired',
    description: 'Your session has expired for security reasons.',
    suggestedAction: 'Please sign in again',
  },
  403: {
    title: 'Access Denied',
    description: 'You do not have permission to perform this action.',
    suggestedAction: 'Contact your administrator to request access',
  },
  404: {
    title: 'Not Found',
    description: 'The requested resource could not be found or has been deleted.',
  },
  409: {
    title: 'Conflict',
    description: 'This operation conflicts with an existing resource.',
  },
  422: {
    title: 'Validation Failed',
    description: 'The submitted data failed validation rules.',
  },
  429: {
    title: 'Limit Reached',
    description: 'You have reached your usage limit. Please try again later.',
    suggestedAction: 'Contact your administrator to increase your quota',
  },

  // 5xx Server Errors
  500: {
    title: 'Server Error',
    description: 'An unexpected error occurred. Please try again.',
    suggestedAction: 'If the problem persists, contact support',
  },
  502: {
    title: 'Gateway Error',
    description: 'Unable to reach the server. Please check your network connection.',
  },
  503: {
    title: 'Service Unavailable',
    description: 'The service is temporarily unavailable. Please try again later.',
  },
  504: {
    title: 'Request Timeout',
    description: 'The request took too long and timed out.',
    suggestedAction: 'Please try again',
  },
}

/**
 * Context-Specific Error Handlers
 *
 * Provides specialized error messages based on the operation context
 */
const CONTEXT_HANDLERS: Record<
  ErrorContext,
  (error: any) => FormattedError | null
> = {
  apic: (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        title: 'APIC Connection Failed',
        description: 'Unable to connect to APIC. The server may be down or unreachable.',
        suggestedAction: 'Verify the APIC URL and network connection',
      }
    }
    if (error.response?.status === 401) {
      return {
        title: 'APIC Authentication Failed',
        description: 'Invalid username or password.',
        suggestedAction: 'Check your APIC credentials in connection settings',
      }
    }
    if (error.response?.status === 503) {
      return {
        title: 'APIC Service Unavailable',
        description: 'APIC is not responding or may be under maintenance.',
        suggestedAction: 'Check APIC server status',
      }
    }
    return null
  },

  awx: (error) => {
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return {
        title: 'AWX Connection Failed',
        description: 'Unable to connect to AWX/Ansible Tower.',
        suggestedAction: 'Verify the AWX URL and network connection',
      }
    }
    if (error.response?.status === 401) {
      return {
        title: 'AWX Authentication Failed',
        description: 'AWX token is invalid or expired.',
        suggestedAction: 'Update your AWX connection token',
      }
    }
    if (error.response?.data?.error?.includes('job_template')) {
      return {
        title: 'Job Template Not Found',
        description: 'The requested AWX job template does not exist or has been deleted.',
        suggestedAction: 'Verify the template exists in AWX',
      }
    }
    return null
  },

  neo4j: (error) => {
    if (error.code === 'ECONNREFUSED') {
      return {
        title: 'Database Connection Failed',
        description: 'Unable to connect to the Neo4j database.',
        suggestedAction: 'Ensure the database service is running',
      }
    }
    if (error.response?.data?.error?.includes('Cypher')) {
      return {
        title: 'Query Error',
        description: 'The database query could not be executed.',
      }
    }
    return null
  },

  query: (error) => {
    if (error.response?.data?.error?.includes('no results')) {
      return {
        title: 'No Results Found',
        description: 'The query executed successfully but returned no results.',
        suggestedAction: 'Try broadening your filters or search criteria',
      }
    }
    if (error.response?.data?.error?.includes('invalid class')) {
      return {
        title: 'Invalid ACI Class',
        description: 'The specified ACI class name is not valid or supported.',
        suggestedAction: 'Verify the class name spelling',
      }
    }
    if (error.response?.data?.error?.includes('timeout')) {
      return {
        title: 'Query Timeout',
        description: 'The query took too long to complete and was cancelled.',
        suggestedAction: 'Simplify the query or add more specific filters',
      }
    }
    return null
  },

  validation: (error) => {
    if (error.response?.data?.validation_errors) {
      const errors = error.response.data.validation_errors
      const errorCount = Array.isArray(errors)
        ? errors.length
        : Object.keys(errors).length
      return {
        title: 'Validation Failed',
        description: `${errorCount} field${errorCount !== 1 ? 's' : ''} failed validation.`,
        suggestedAction: 'Correct the highlighted fields and try again',
      }
    }
    return null
  },

  upload: (error) => {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return {
        title: 'File Too Large',
        description: 'The file exceeds the maximum allowed size.',
        suggestedAction: 'Choose a smaller file',
      }
    }
    if (error.response?.data?.error?.includes('format')) {
      return {
        title: 'Invalid File Format',
        description: 'The file format is not supported.',
        suggestedAction: 'Upload a CSV, Excel, or JSON file',
      }
    }
    return null
  },

  ai: (error) => {
    if (error.response?.status === 503) {
      return {
        title: 'AI Service Unavailable',
        description: 'The Ollama or LLM service is not responding.',
        suggestedAction: 'Check AI settings or use manual query builder',
      }
    }
    if (error.response?.data?.error?.includes('confidence')) {
      return {
        title: 'Low Confidence Score',
        description: 'The AI could not generate a reliable query from your input.',
        suggestedAction: 'Provide more specific details or use manual builder',
      }
    }
    return null
  },

  pipeline: (error) => {
    const message = error?.response?.data?.error || error?.message
    if (message) {
      return {
        title: 'Pipeline Execution Failed',
        description: message,
        suggestedAction: 'Check stage configuration and re-run the pipeline',
      }
    }
    return null
  },
}

/**
 * Format error object into user-friendly message
 *
 * @param error - Error object from API call or network request
 * @param context - Optional context for more specific error handling
 * @returns Formatted error with title and description
 */
export function formatError(
  error: any,
  context?: ErrorContext
): FormattedError {
  // Handle network errors
  if (error.code === 'ERR_NETWORK' || error.message === 'Network Error') {
    return {
      title: 'Network Connection Error',
      description: 'Please check your internet connection.',
      suggestedAction: 'If connected, check VPN or firewall settings',
    }
  }

  // Try context-specific handler first
  if (context && CONTEXT_HANDLERS[context]) {
    const contextError = CONTEXT_HANDLERS[context](error)
    if (contextError) return contextError
  }

  // Check for backend-provided user message
  if (error.response?.data?.user_message) {
    return {
      title: error.response.data.user_message,
      description: error.response.data.detail || '',
    }
  }

  // Check for backend detail message
  if (error.response?.data?.detail) {
    return {
      title: getStatusTitle(error.response.status),
      description: error.response.data.detail,
    }
  }

  // Check for backend error message
  if (error.response?.data?.error) {
    return {
      title: getStatusTitle(error.response.status),
      description: error.response.data.error,
    }
  }

  // Map by HTTP status code
  if (error.response?.status) {
    const statusError = HTTP_STATUS_ERRORS[error.response.status]
    if (statusError) return statusError
  }

  // Generic fallback
  return {
    title: 'An Error Occurred',
    description: error.message || 'An unexpected error has occurred.',
    suggestedAction: 'Please try again',
  }
}

/**
 * Get generic error title based on HTTP status code range
 */
function getStatusTitle(status: number): string {
  if (status >= 400 && status < 500) return 'Request Error'
  if (status >= 500) return 'Server Error'
  return 'Error'
}

/**
 * Format error for toast notification
 *
 * Combines description and suggested action into a single string
 */
export function formatErrorForToast(
  error: any,
  context?: ErrorContext
): { title: string; description: string } {
  const formatted = formatError(error, context)

  return {
    title: formatted.title,
    description: formatted.suggestedAction
      ? `${formatted.description}\n\n${formatted.suggestedAction}`
      : formatted.description,
  }
}

/**
 * Sanitize error messages by removing technical details
 *
 * Strips stack traces, file paths, and error codes
 */
export function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/at\s+.*?\s+\(.*?\)/g, '') // Remove stack trace lines
    .replace(/[A-Z]:\\.*?\.py/g, '') // Remove Windows file paths
    .replace(/\/.*?\.py/g, '') // Remove Unix file paths
    .replace(/\[Errno \d+\]/g, '') // Remove errno codes
    .replace(/^[a-z]/, (char) => char.toUpperCase()) // Capitalize first letter
    .trim()
}
