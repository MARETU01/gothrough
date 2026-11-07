import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css'
import { i18nReady } from './i18n'
import App from './App.tsx'

void i18nReady.then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}).catch(() => {
  const root = document.getElementById('root')!
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = '语言资源加载失败 / Could not load translations.'
  const retry = document.createElement('button')
  retry.type = 'button'
  retry.textContent = '重新加载 / Reload'
  retry.onclick = () => window.location.reload()
  root.replaceChildren(message, retry)
})
