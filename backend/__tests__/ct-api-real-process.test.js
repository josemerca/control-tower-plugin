import { describe, it, expect, afterEach } from 'vitest'
import { execFile, spawn } from 'node:child_process'
import { connect } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

class Entrypoint {
  static #PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'ct-api.mjs')
  static #TIMEOUT_MS = 30_000
  static #spawned = []

  static alive() {
    const last = Entrypoint.#spawned.at(-1)
    return last !== undefined && last.exitCode === null && last.signalCode === null
  }

  static cutMidBody(port) {
    return new Promise((resolve) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          'POST /start-plan HTTP/1.1\r\nHost: 127.0.0.1\r\n' +
            'Content-Type: application/json\r\nContent-Length: 5000\r\n\r\n{"id":"'
        )
        socket.destroy()
        setTimeout(resolve, 250)
      })
    })
  }

  static startPlan(port) {
    return fetch(`http://127.0.0.1:${port}/start-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"id":"ABC-123"}',
    })
  }

  static killAll() {
    for (const child of Entrypoint.#spawned.splice(0)) child.kill('SIGKILL')
  }

  static refused(environment, argv = []) {
    return new Promise((resolve) => {
      execFile(
        process.execPath,
        [Entrypoint.#PATH, ...argv],
        { env: { ...process.env, ...environment }, timeout: Entrypoint.#TIMEOUT_MS },
        (failure, stdout, stderr) => resolve({ code: failure === null ? 0 : failure.code, stdout, stderr })
      )
    })
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

  it('a_request_cut_halfway_through_its_body_leaves_the_process_alive_and_still_serving', async () => {
    const port = await Entrypoint.listening({ CT_API_PORT: '0' })

    await Entrypoint.cutMidBody(port)

    expect(Entrypoint.alive()).toBe(true)
    await expect(Entrypoint.startPlan(port)).resolves.toBeDefined()
  })

  it('a_refused_invocation_stops_the_process_with_the_usage_code_and_says_why', async () => {
    const refused = await Entrypoint.refused({ CT_API_PORT: 'abc' })

    expect(refused.code).toBe(2)
    expect(refused.stderr).toContain('CT_API_PORT must be an integer between 0 and 65535, got "abc"')
    expect(refused.stderr).toContain('usage: ct-api.mjs')
  })

  it('a_port_already_taken_is_reported_without_the_usage_line_because_the_invocation_was_fine', async () => {
    const taken = await Entrypoint.listening({ CT_API_PORT: '0' })

    const refused = await Entrypoint.refused({ CT_API_PORT: String(taken) })

    expect(refused.code).toBe(1)
    expect(refused.stderr).toContain('EADDRINUSE')
    expect(refused.stderr).not.toContain('usage:')
  })
})
