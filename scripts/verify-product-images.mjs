import fs from 'node:fs'
import path from 'node:path'

const folder = path.resolve(new URL('../public/images/products', import.meta.url).pathname)
const present = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => /^M\d{3}\.webp$/i.test(name)) : []
console.log(`Imagens .webp presentes: ${present.length}`)
console.log('Imagens ausentes não bloqueiam o build; o site mostra placeholder.')
