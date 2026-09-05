import { readFileSync } from 'node:fs'

export class VerdictFile {
  static read(path) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return { why: `verdict file not readable: ${path}` }
    }
    try {
      return { verdict: JSON.parse(text) }
    } catch {
      return { why: `verdict file is not JSON: ${path}` }
    }
  }
}
