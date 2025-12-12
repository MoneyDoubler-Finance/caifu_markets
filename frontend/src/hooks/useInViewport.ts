"use client"

import { useEffect, useRef, useState } from 'react'

export type UseInViewportOptions = {
  root?: Element | null
  rootMargin?: string
  threshold?: number | number[]
  /** Pre-resolve as visible on first paint to avoid layout shift during SSR */
  defaultVisible?: boolean
}

export function useInViewport<T extends Element>(options: UseInViewportOptions = {}) {
  const { root = null, rootMargin = '200px 0px', threshold = 0.01, defaultVisible = false } = options
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState<boolean>(defaultVisible)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Fallback: if IntersectionObserver is missing, treat as visible
    if (typeof window === 'undefined' || typeof (window as any).IntersectionObserver !== 'function') {
      setInView(true)
      return
    }

    let stopped = false
    const observer = new IntersectionObserver((entries) => {
      if (stopped) return
      for (const entry of entries) {
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          setInView(true)
          // Once visible we can stop observing to avoid extra work
          observer.unobserve(entry.target)
        }
      }
    }, { root, rootMargin, threshold })

    observer.observe(el)

    return () => {
      stopped = true
      try { observer.disconnect() } catch {}
    }
  }, [root, rootMargin, threshold])

  return { ref, inView }
}

