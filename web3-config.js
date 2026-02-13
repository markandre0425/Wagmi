/**
 * web3-config.js — Singleton AppKit + Wagmi initialisation
 *
 * This module is the SINGLE place where createAppKit and WagmiAdapter are
 * instantiated.  It is imported by main.js (and potentially other entry
 * points).  Because ES modules are evaluated exactly once, the init code
 * below only runs once — no matter how many files import this module.
 *
 * ╔═══════════════════════════════════════════════════════════════════╗
 * ║  KEY FIX:  DO NOT pass a manual walletConnect() connector to    ║
 * ║  WagmiAdapter.  AppKit creates its own internal WC provider.    ║
 * ║  Passing one manually causes TWO WalletConnect Core instances   ║
 * ║  that fight over the relay WebSocket, resulting in:             ║
 * ║    • "Init() was called 2 times" error                         ║
 * ║    • Blank QR code (AppKit's provider never receives the URI)  ║
 * ║  See: https://github.com/reown-com/appkit/issues/2202          ║
 * ║       https://github.com/reown-com/appkit/issues/4680          ║
 * ╚═══════════════════════════════════════════════════════════════════╝
 */

import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia } from '@reown/appkit/networks'

// Environment detection
const IS_ELECTRON =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

const projectId = import.meta.env.VITE_REOWN_PROJECT_ID

// Exported state
/** @type {import('@wagmi/core').Config | null} */
export let config = null

/** @type {ReturnType<typeof createAppKit> | null} */
export let appKitModal = null


export let walletEnabled = false

export { IS_ELECTRON }

//  Singleton guard
// ES modules are singletons by design, but Vite HMR can re-execute
// the top-level code.  globalThis._WAGMI_INIT prevents double init.
if (globalThis._WAGMI_INIT) {
  // Re-use previously created instances
  config = globalThis._wagmiConfig ?? null
  appKitModal = globalThis._appKitModal ?? null
  walletEnabled = !!config
  console.info('[web3-config] Skipping duplicate init — reusing existing instances.')
} else if (!projectId) {
  console.warn(
    '[web3-config] VITE_REOWN_PROJECT_ID is missing. Wallet features are disabled.',
  )
} else {
  // Mark BEFORE doing any work so that a partial failure (Core inits
  // but createAppKit throws) still prevents a second attempt from
  // hitting the "already initialized" error.
  globalThis._WAGMI_INIT = true

  const metadata = {
    name: 'Wealth Wards',
    description: 'Wealth Wards – Desktop & Web3 App',
    url: IS_ELECTRON
      ? (import.meta.env.VITE_DAPP_URL ?? 'https://wealthwards.app')
      : window.location.origin,
    icons: ['https://wealthwards.app/favicon.ico'],
  }

  // ╔═════════════════════════════════════════════════════════════════╗
  // ║  DO NOT add walletConnect() here!                             ║
  // ║  AppKit provides WC + Injected + Coinbase out of the box.    ║
  // ║  See: https://docs.reown.com/appkit/javascript/core/          ║
  // ║       installation#implementation--wagmi                      ║
  // ╚═════════════════════════════════════════════════════════════════╝
  const wagmiAdapter = new WagmiAdapter({
    projectId,
    networks: [mainnet, sepolia],
    // NO connectors — AppKit handles WalletConnect, Injected, Coinbase
    // automatically.  Passing a manual walletConnect() connector causes
    // a duplicate WC Core init and a blank QR code.
  })

  appKitModal = createAppKit({
    adapters: [wagmiAdapter],
    networks: [mainnet, sepolia],
    metadata,
    projectId,
    features: { analytics: false },
  })

  config = wagmiAdapter.wagmiConfig
  walletEnabled = true

  // Persist on globalThis so HMR re-execution can reuse them
  globalThis._wagmiConfig = config
  globalThis._appKitModal = appKitModal

  console.info('[web3-config] AppKit + Wagmi initialised successfully.')

  // Manual URI debugger
  // Listen for AppKit events AND the WalletConnect display_uri event.
  // When AppKit receives a URI from the relay it fires this event.
  // We log it AND display the raw URI string on screen so you can
  // verify the relay connection is working even if the QR SVG fails to render.

  // 1. Subscribe to ALL AppKit events (modal open/close, connector changes, etc.)
  try {
    appKitModal.subscribeEvents((event) => {
      console.log('[web3-config] AppKit event:', JSON.stringify(event?.data ?? event))
    })
  } catch (e) {
    console.warn('[web3-config] Could not subscribe to AppKit events:', e)
  }

  // 2. Listen for display_uri on the WalletConnect provider.
  //    AppKit creates the WC connector lazily, so it might not be in
  //    config.connectors immediately.  We poll for it briefly, and
  //    also try attaching when the modal opens.
  function attachDisplayUriListener() {
    const wcConnector = config.connectors.find(
      (c) => c.id === 'walletConnect' || c.type === 'walletConnect',
    )
    if (!wcConnector) {
      console.info(
        '[web3-config] WC connector not yet available. Connectors:',
        config.connectors.map((c) => `${c.id}(${c.type})`).join(', '),
      )
      return false
    }

    ;(async () => {
      try {
        const provider = await wcConnector.getProvider()
        if (provider && typeof provider.on === 'function') {
          provider.on('display_uri', (uri) => {
            console.log('[web3-config] ✅ display_uri received:', uri)

            // Show on screen in the debug div (if it exists)
            const debugEl = document.getElementById('wcDebugUri')
            if (debugEl) {
              // debugEl.style.display = 'block'
              // debugEl.textContent = `WC URI received! (${uri.slice(0, 60)}...)`
            }
          })
          console.info(
            '[web3-config] ✅ Listening for display_uri on WC provider.',
          )
        }
      } catch (e) {
        console.warn('[web3-config] Could not attach display_uri listener:', e)
      }
    })()
    return true
  }

  // Try immediately, then retry a few times with increasing delay
  // (AppKit registers the WC connector asynchronously after createAppKit)
  if (!attachDisplayUriListener()) {
    const retryDelays = [500, 1500, 3000, 5000]
    retryDelays.forEach((delay) => {
      setTimeout(() => {
        if (!globalThis._wcUriListenerAttached) {
          if (attachDisplayUriListener()) {
            globalThis._wcUriListenerAttached = true
          }
        }
      }, delay)
    })
  } else {
    globalThis._wcUriListenerAttached = true
  }
}
