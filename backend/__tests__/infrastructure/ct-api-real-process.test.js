import { describe, it, expect, afterEach } from 'vitest'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class Entrypoint {
  static #PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'infrastructure', 'ct-api.mjs')
  static #TIMEOUT_MS = 30_000
  static #spawned = []

  static alive() {
    const last = Entrypoint.#spawned.at(-1)
    return last !== undefined && last.exitCode === null && last.signalCode === null
  }

  static startPlan(port, body = '{"id":"ABC-123"}') {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
  }

  static killAll() {
    for (const child of Entrypoint.#spawned.splice(0)) child.kill('SIGKILL')
  }

  static async listening(environment) {
    const child = spawn(process.execPath, [Entrypoint.#PATH], {
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    Entrypoint.#spawned.push(child)
    return new Promise((resolve, reject) => {
      let stdout = ''
      const timer = setTimeout(() => reject(new Error(`no port line in ${stdout}`)), Entrypoint.#TIMEOUT_MS)
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        const end = stdout.indexOf('\n')
        if (end === -1) return
        clearTimeout(timer)
        resolve(JSON.parse(stdout.slice(0, end)).port)
      })
      child.once('error', reject)
    })
  }
}

describe('ct-api entrypoint', () => {
  afterEach(() => {
    Entrypoint.killAll()
  })

  it('prints_the_port_it_bound_so_whoever_started_it_knows_where_to_knock', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    expect(port).toBeGreaterThan(0)
  })

  it('a_whole_request_reaches_git_first_so_no_story_is_read_for_a_clone_nobody_has', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })
    const nowhere = join(tmpdir(), 'ct-api-never-cloned')

    const response = await Entrypoint.startPlan(
      port,
      `{"id":"ZZZ-999999","repo":"josemerca/nope","path":${JSON.stringify(nowhere)}}`
    )

    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(
      /^path must be a git checkout of josemerca\/nope: .+ does not name a origin remote/
    )
  })
})
