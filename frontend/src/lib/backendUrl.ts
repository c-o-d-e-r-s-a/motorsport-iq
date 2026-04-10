const PRODUCTION_BACKEND_URL = 'https://motorsport-iq-backend-production.up.railway.app';

export function resolveBackendUrl(): string {
  const configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (configuredUrl) return configuredUrl;

  if (typeof window === 'undefined') {
    return 'http://localhost:4000';
  }

  if (window.location.hostname === 'localhost') {
    return 'http://localhost:4000';
  }

  // Fallback only when the deployment env var is missing.
  if (window.location.hostname.includes('vercel.app')) {
    return PRODUCTION_BACKEND_URL;
  }

  return window.location.origin;
}
