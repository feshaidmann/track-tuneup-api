const BASE_URL = import.meta.env.VITE_API_URL ?? 'https://track-tuneup-api-production.up.railway.app'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface UploadUrlResponse {
  upload_url: string
  path: string
  bucket: string
}

export function getUploadUrl(clientId: string, filename: string, bucket = 'audio-uploads') {
  return request<UploadUrlResponse>('/api/storage/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, filename, bucket }),
  })
}

// Envia o arquivo direto pro signed URL do Supabase (PUT), sem passar pelo backend.
export async function uploadFileToSignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  })
  if (!res.ok) throw new Error(`Upload falhou: HTTP ${res.status}`)
}

export function recordEvent(
  clientId: string,
  eventType: string,
  payload: Record<string, unknown> = {},
  analysisId?: string,
) {
  return request<{ ok: boolean }>('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, event_type: eventType, analysis_id: analysisId, payload }),
  })
}

export function analyzeAudioRemote(file: File, preset: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('preset', preset)
  return fetch(`${BASE_URL}/analyze`, { method: 'POST', body: formData })
}
