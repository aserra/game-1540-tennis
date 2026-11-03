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

createApp(App).mount('#app')
