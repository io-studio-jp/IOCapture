import { useEffect, useRef } from 'react'
import { computeFrameRect, type Rect } from '../../../shared/frameRect'
import type { Aspect } from '../../../shared/aspect'

export function useFrameRect(aspect: Aspect) {
  const stageRef = useRef<HTMLDivElement>(null)
  const lastRect = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => {
      const r = el.getBoundingClientRect()
      const rect = computeFrameRect({ width: r.width, height: r.height }, aspect, 16)
      const windowRect: Rect = {
        x: Math.round(r.left + rect.x),
        y: Math.round(r.top + rect.y),
        width: rect.width,
        height: rect.height,
      }
      lastRect.current = windowRect
      window.capture.setFrameRect(windowRect)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [aspect])

  return { stageRef, getFrameRect: () => lastRect.current }
}
