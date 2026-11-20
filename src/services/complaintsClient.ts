/**
 * RUSH Car Wash (رش واش) - Complaints API Client Bridge
 * Dynamically resolves the API host:
 * - When deployed on Cloudflare Workers (*.workers.dev) or external hosts, targets the VPS backend: https://whatsapp.rush.com.sa
 * - Supports explicit override via VITE_COMPLAINTS_API_URL
 */

export const COMPLAINTS_API_BASE: string = (() => {
  if (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_COMPLAINTS_API_URL) {
    return (import.meta as any).env.VITE_COMPLAINTS_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    // When running on Cloudflare Workers / remote domains, route API calls to the VPS bridge
    if (host.includes('workers.dev') || host.includes('pages.dev') || (host !== 'localhost' && host !== '127.0.0.1')) {
      return 'https://whatsapp.rush.com.sa';
    }
  }
  return '';
})();

export function getComplaintsApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${COMPLAINTS_API_BASE}${cleanPath}`;
}
