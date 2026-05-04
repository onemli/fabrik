// lib/wsTicket.ts
//
// Fetches a short-lived (30-second) single-use ticket from the backend to
// authenticate WebSocket connections. The ticket is passed as a URL parameter
// so the JWT never appears in server access logs or browser history.
//
// Uses authService for token refresh so there is a single refresh flow
// shared with the Axios interceptor — avoids double-refresh race conditions
// when both a REST call and the WS ticket call hit 401 simultaneously.

import { authService } from '@/services/auth'

const API_BASE = import.meta.env.VITE_API_URL || ''

async function fetchTicket(accessToken: string): Promise<Response> {
  return fetch(`${API_BASE}/api/ws-ticket/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
  })
}

export async function getWsTicket(): Promise<string> {
  let token = authService.getAccessToken()
  if (!token) throw new Error('Not authenticated')

  let response = await fetchTicket(token)

  // 401 → delegate to authService (same refresh path as Axios interceptor)
  if (response.status === 401) {
    try {
      await authService.refreshAccessToken()
    } catch {
      throw new Error('Session expired')
    }
    token = authService.getAccessToken()
    if (!token) throw new Error('Session expired')
    response = await fetchTicket(token)
  }

  if (!response.ok) throw new Error(`WS ticket failed: ${response.status}`)

  const data = await response.json()
  return data.ticket as string
}
