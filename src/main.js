import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// iOS Safari/Brave ignore user-scalable=no: block pinch-zoom gestures manually
// so the page can never end up zoomed in with no way back.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault())
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1) e.preventDefault()
  },
  { passive: false }
)

// Double-tap zoom: iOS ignores touch-action for it in some browsers, so swallow the second
// quick touchend ourselves (pointer events already fired, so the controls are unaffected).
let lastTouchEnd = 0
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now()
    if (now - lastTouchEnd < 350) e.preventDefault()
    lastTouchEnd = now
  },
  { passive: false }
)
document.addEventListener('dblclick', (e) => e.preventDefault())

// Safety net: if the page still ends up zoomed in, toggling the viewport meta makes iOS reset it.
const viewportMeta = document.querySelector('meta[name="viewport"]')
const viewportContent = viewportMeta?.getAttribute('content')
window.visualViewport?.addEventListener('resize', () => {
  if (!viewportMeta || window.visualViewport.scale <= 1.01) return
  viewportMeta.setAttribute('content', viewportContent.replace('maximum-scale=1.0', 'maximum-scale=1.0001'))
  requestAnimationFrame(() => viewportMeta.setAttribute('content', viewportContent))
})

createApp(App).mount('#app')
