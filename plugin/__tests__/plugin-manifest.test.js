import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PluginManifest } from '../scripts/plugin-manifest.js'

describe('PluginManifest reads the version key of the plugin manifest with a single rule', () => {
  let directory

  class Manifests {
    static withVersion(value) {
      const path = join(directory, 'package.json')
      writeFileSync(path, JSON.stringify({ version: value }))
      return path
    }

    static unreadable() {
      return join(directory, 'package.json')
    }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'plugin-manifest-test-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('a_manifest_whose_version_is_the_empty_string_answers_null_and_never_the_empty_string', () => {
    const emptyVersion = new PluginManifest(Manifests.withVersion('')).version
    const neighbourVersion = new PluginManifest(Manifests.withVersion('0.0.1')).version

    expect(emptyVersion).toBeNull()
    expect(neighbourVersion).toBe('0.0.1')
  })

  it('the_installed_manifest_answers_the_version_the_plugin_declares', () => {
    const manifestPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
    const version = JSON.parse(readFileSync(manifestPath, 'utf8')).version

    expect(PluginManifest.installed().version).toBe(version)
  })

  it('a_manifest_that_cannot_be_read_answers_null_instead_of_raising', () => {
    const manifest = new PluginManifest(Manifests.unreadable())

    expect(manifest.version).toBeNull()
  })

  it('a_manifest_without_a_version_key_answers_null', () => {
    const manifest = new PluginManifest(Manifests.withVersion(undefined))

    expect(manifest.version).toBeNull()
  })
})
