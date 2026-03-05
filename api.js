/**
 * Unified API client for both Electron app and Web.
 * Provides methods to fetch wallet session, balance, assets, and user profile.
 *
 * Electron → VITE_API_URL_ELECTRON (empty = same-origin via Vite proxy in dev)
 * Web      → VITE_API_URL_WEB      (empty = same-origin via Vite proxy in dev)
 *
 * Both environments use the same API endpoints and cookie auth.
 */

const IS_ELECTRON =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

// Detect API base URL based on environment.
// Returns the base origin (no trailing /api) — all paths already start with /api/.
function getApiBase() {
  try {
    if (IS_ELECTRON) {
      return import.meta?.env?.VITE_API_URL_ELECTRON || '';
    }
    // Web: check VITE_API_URL_WEB first, then generic VITE_API_URL
    return import.meta?.env?.VITE_API_URL_WEB || import.meta?.env?.VITE_API_URL || '';
  } catch (e) {
    // import.meta not available, fall through to default
  }
  // Empty string = same-origin (works with Vite /api proxy in dev)
  return '';
}

const API_BASE = getApiBase();

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const response = await fetch(url, {
    credentials: 'include',
    ...options,
  });

  if (!response.ok) {
    const error = response.status === 401 ? 'Not logged in' : `API ${response.status}`;
    throw new Error(error);
  }

  return response.json();
}

/**
 * Get current wallet address from session (requires authentication)
 */
export async function getWalletSession() {
  return fetchApi('/api/walletAddress');
}

/**
 * Get native ETH balance for the authenticated wallet
 */
export async function getBalanceFromBackend(chainId = 1) {
  return fetchApi(`/api/balance?chainId=${chainId}`);
}

/**
 * Get ERC-20 token assets for the authenticated wallet
 */
export async function getAssetsFromBackend(address, chainId = 1) {
  return fetchApi(`/api/assets?address=${encodeURIComponent(address)}&chainId=${chainId}`);
}

/**
 * Get transaction history for the authenticated user
 */
export async function getTransactionsFromBackend(limit = 50, type = null) {
  let path = `/api/transactions?limit=${limit}`;
  if (type) path += `&type=${encodeURIComponent(type)}`;
  return fetchApi(path);
}

/**
 * Get user profile (avatar, display name, email, bio)
 */
export async function getProfileFromBackend() {
  return fetchApi('/api/user/profile');
}

/**
 * Save user profile (avatar, display name, email, bio)
 */
export async function saveProfileToBackend(profile) {
  return fetchApi('/api/user/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

/**
 * Logout and clear session
 */
export async function logoutFromBackend() {
  return fetchApi('/api/logout', { method: 'POST' });
}

export default {
  getWalletSession,
  getBalanceFromBackend,
  getAssetsFromBackend,
  getTransactionsFromBackend,
  getProfileFromBackend,
  saveProfileToBackend,
  logoutFromBackend,
};
