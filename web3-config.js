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
      // ── Electron: AppKit modal (WalletConnect QR / external wallet) ──
      const { createAppKit } = await import('@reown/appkit')
      const { WagmiAdapter } = await import('@reown/appkit-adapter-wagmi')

      const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
      if (!projectId) throw new Error('VITE_REOWN_PROJECT_ID is required for Electron AppKit')

      const wagmiAdapter = new WagmiAdapter({
        projectId,
        networks: [mainnet, sepolia],
        transports: {
          [mainnet.id]: http(),
          [sepolia.id]: http(),
        },
      })

      config = wagmiAdapter.wagmiConfig

      appKitModal = createAppKit({
        adapters: [wagmiAdapter],
        projectId,
        networks: [mainnet, sepolia],
        features: { analytics: false },
      })

      globalThis._appKitModal = appKitModal
    } else {
      // ── Web: injected connector only (MetaMask / browser extension) ──
      config = createConfig({
        chains: [mainnet, sepolia],
        connectors: [injected()],
        transports: {
          [mainnet.id]: http(),
          [sepolia.id]: http(),
        },
      })
    }

    walletEnabled = true
    globalThis._wagmiConfig = config
  } catch (err) {
    console.error('[web3-config] Failed to initialise Wagmi config:', err)
    walletEnabled = false
  }
}
