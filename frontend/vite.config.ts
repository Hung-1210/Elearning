// import react from '@vitejs/plugin-react'
// import { defineConfig } from 'vite'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [react()],
// })

import fs from 'node:fs'
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const sslDir = path.resolve(process.cwd(), '../backend/ssl')

export default defineConfig({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    https: {
      key: fs.readFileSync(path.join(sslDir, 'server.key')),
      cert: fs.readFileSync(path.join(sslDir, 'server.cert')),
    },
  },
})
