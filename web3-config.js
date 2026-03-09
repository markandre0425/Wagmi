/**
 * web3-config.js — Singleton Wagmi configuration
 *
 * Web     → Standard @wagmi/core createConfig with the injected connector.
 * Electron → @reown/appkit + WagmiAdapter for WalletConnect QR modal.
 *
 * This module is the SINGLE place where the Wagmi config is created.
 * It is imported by main.js (and potentially other entry points).
 * Because ES modules are evaluated exactly once, the init code below
 * only runs once — no matter how many files import this module.
 */

import { createConfig } from '@wagmi/core'
import { injected } from '@wagmi/connectors'
import { http } from 'viem'
import { mainnet, sepolia } from 'viem/chains'

// Environment detection
const IS_ELECTRON =
  typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron')

// Exported state
/** @type {import('@wagmi/core').Config | null} */
export let config = null

export let walletEnabled = false

/** @type {{ open(): Promise<void>, close(): Promise<void> } | null} */
export let appKitModal = null

export { IS_ELECTRON }

// Singleton guard — Vite HMR can re-execute top-level code.
// globalThis._WAGMI_INIT prevents double init.
if (globalThis._WAGMI_INIT) {
  config = globalThis._wagmiConfig ?? null
  appKitModal = globalThis._appKitModal ?? null
  walletEnabled = !!config
  console.info('[web3-config] Skipping duplicate init — reusing existing config.')
} else {
  globalThis._WAGMI_INIT = true

  try {
    if (IS_ELECTRON) {
      console.info('[web3-config] Electron detected → Initializing Reown AppKit (WalletConnect QR modal)')

      // ── Electron: AppKit modal (WalletConnect QR / external wallet) ──

      const { createAppKit } = await import('@reown/appkit')
      const { WagmiAdapter } = await import('@reown/appkit-adapter-wagmi')

      const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
      if (!projectId) {
        const errorMsg = 'FATAL: VITE_REOWN_PROJECT_ID env var missing. Electron AppKit requires this. Check .env and vite.config.js'
        console.error('[web3-config]', errorMsg)
        throw new Error(errorMsg)
      }

      console.info('[web3-config] VITE_REOWN_PROJECT_ID found:', projectId.slice(0, 8) + '...')

      const wagmiAdapter = new WagmiAdapter({
        projectId,
        networks: [mainnet, sepolia],
        transports: {
          [mainnet.id]: http(),
          [sepolia.id]: http(),
        },
      })

      config = wagmiAdapter.wagmiConfig
      console.info('[web3-config] Reown WagmiAdapter initialized')

      appKitModal = createAppKit({
        adapters: [wagmiAdapter],
        projectId,
        networks: [mainnet, sepolia],
        features: { analytics: false },
      })

      globalThis._appKitModal = appKitModal
      console.info('[web3-config] AppKit modal created successfully')
    } else {
      console.info('[web3-config] Browser environment detected → Using injected connector (MetaMask only)')

      // ── Web: injected connector only (MetaMask / browser extension) ──
      // Electron must NEVER reach this branch.
      config = createConfig({
        chains: [mainnet, sepolia],
        connectors: [injected()],
        transports: {
          [mainnet.id]: http(),
          [sepolia.id]: http(),
        },
      })

      console.info('[web3-config] Injected connector (MetaMask) initialized')
    }

    walletEnabled = true
    globalThis._wagmiConfig = config
    console.info('[web3-config]  Web3 config initialized successfully')
  } catch (err) {
    console.error('[web3-config]  FATAL: Failed to initialise Web3 config:', err)
    walletEnabled = false
    globalThis._wagmiConfig = null
    globalThis._appKitModal = null
  }
}
