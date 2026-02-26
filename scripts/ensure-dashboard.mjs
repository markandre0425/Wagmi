import fs from 'fs'
import { execSync } from 'child_process'

if (!fs.existsSync('dist/dashboard/index.html')) {
  console.log('Building dashboard (first run or after clean)...')
  execSync('npm run build:dashboard', { stdio: 'inherit' })
}
