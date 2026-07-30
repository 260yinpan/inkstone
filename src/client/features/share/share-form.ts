export const KEEP_CURRENT_EXPIRY = 'current'

export function expiresInForSelection(selection: string): number | null | undefined {
  if (selection === KEEP_CURRENT_EXPIRY) return undefined
  const milliseconds = Number(selection)
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null
}

export function needsNewSharePasscode(
  enabled: boolean,
  alreadyProtected: boolean,
  passcode: string,
): boolean {
  return enabled && !alreadyProtected && passcode.length === 0
}
