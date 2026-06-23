const KEY = 'tuneup_client_id'

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback para browsers sem crypto.randomUUID
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function getClientId(): string {
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = generateUUID()
    localStorage.setItem(KEY, id)
  }
  return id
}
