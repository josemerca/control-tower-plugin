import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Home } from 'pages/home/Home'
import { Theme } from 'system-ui/theme/Theme'
import 'system-ui/theme/styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('index.html has no #root element to mount on')

Theme.followSystemPreference()

createRoot(root).render(
  <StrictMode>
    <Home />
  </StrictMode>,
)
