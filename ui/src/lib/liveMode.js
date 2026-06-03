import { createContext, useContext } from 'react'

// Global display mode for in-progress game info. true = Live (show running
// scores, innings, "already homered" tags, live drawer section); false =
// Pregame (a clean projection look with scores/innings hidden). One source of
// truth so every live element across the board agrees. Defaults to Live.
export const LiveModeContext = createContext(true)

export function useLiveMode() {
  return useContext(LiveModeContext)
}
