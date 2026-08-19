import { authClient } from '#auth/authClient'

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return authClient.request(input, init)
}
