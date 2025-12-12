"use client"

import { useEffect } from 'react'

/**
 * Adds or removes the `anim-paused` class on <html> whenever the document
 * visibility changes. This pauses expensive CSS animations/background blur
 * while the tab is hidden without affecting visible behavior.
 */
export function usePauseAnimationsOnHidden() {
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      if (document.hidden) {
        root.classList.add('anim-paused')
      } else {
        root.classList.remove('anim-paused')
      }
    }

    apply()
    document.addEventListener('visibilitychange', apply)
    return () => document.removeEventListener('visibilitychange', apply)
  }, [])
}
