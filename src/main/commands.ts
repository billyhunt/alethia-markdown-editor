import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc.ts'
import type { HostCommand } from '../shared/ipc.ts'

/**
 * Main never asks the renderer a question and waits for an answer. It sends a
 * one-way command; the renderer does the work and calls back in with ordinary
 * invokes. That avoids inventing a main->renderer request/response layer.
 */
export function sendCommand(win: BrowserWindow | null, command: HostCommand): void {
  win?.webContents.send(IPC.hostCommand, command)
}

export function sendToRenderer(win: BrowserWindow | null, channel: string, payload?: unknown): void {
  win?.webContents.send(channel, payload)
}

export const focusedWindow = (): BrowserWindow | null =>
  BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null
