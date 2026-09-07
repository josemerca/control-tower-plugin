import { readFileSync } from 'node:fs'

export class ReportFile {
  static read(path) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      return { why: `report file not readable: ${path}` }
    }
    try {
      return { report: JSON.parse(text) }
    } catch {
      return { why: `report file is not JSON: ${path}` }
    }
  }
}
