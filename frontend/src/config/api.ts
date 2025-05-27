// api.ts
/**
 * @deprecated Use API_CONFIG from constants.ts and api service from lib/api.ts instead
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const apiConfig = {
    baseURL: API_BASE_URL
}