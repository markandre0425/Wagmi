/**
 * Electron preload script.
 *
 * Runs in a sandboxed context before web content loads.
 * Exposes a minimal API surface to the renderer via contextBridge.
 *
 * Currently we only expose a `platform` string so the UI can detect
 * which OS it's running on (e.g. for conditional styling).
 * Extend this file to add secure IPC channels in the future.
 */
const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
})
