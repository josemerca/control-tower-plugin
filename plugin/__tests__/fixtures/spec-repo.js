// Directorio temporal con la forma que tiene un spec EN PRODUCCIÓN (F10).
//
// Antes de F10, un spec de test era un fichero suelto en un mkdtemp: daba
// igual, porque el enlace al spec se componía con `--section` y con la ruta
// tal cual llegaba en argv. Ahora el enlace se deriva del repositorio (ruta
// relativa a la raíz + remoto `origin` + rama por defecto) y se VERIFICA
// contra GitHub antes de escribirlo, así que un fichero suelto ejercita la
// rama de degradación, no la normal.
//
// Este helper devuelve un directorio que es un repo git de verdad con un
// remoto `origin` de GitHub — la configuración en la que corre /ct-groom
// cuando se usa para lo que se hizo. Los tests que quieran ejercer las
// degradaciones (spec fuera de repo, sin remoto, sin publicar) lo hacen a
// propósito y por separado, no de rebote.
//
// El `gh` de verdad nunca entra: el stub de fixtures/fake-gh-bin responde
// tanto al `repo view --json defaultBranchRef` como al
// `api repos/o/r/contents/<ruta>` con el que se comprueba que el ancla
// existe.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SPEC_REPO_REMOTE = 'https://github.com/o/r.git'
export const SPEC_REPO_SLUG = 'o/r'

// makeSpecDir: mkdtemp + `git init` + remoto origin. `git` de verdad (no hay
// stub): es barato y es exactamente lo que ct-groom.mjs va a interrogar.
export function makeSpecDir(prefix = 'ctg-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('remote', 'add', 'origin', SPEC_REPO_REMOTE)
  return dir
}

// specUrl: la URL que ct-groom.mjs debe producir para un spec de nombre
// `file` con el ancla `anchor` dentro de un directorio de makeSpecDir. Se
// calcula aquí, en el fixture, para que los tests no repitan la plantilla —
// pero NO se construye con las funciones de scripts/spec-link.js a propósito:
// un test que compone la URL con el mismo código que la produce no comprueba
// nada.
export function specUrl(file, anchor = '9-slices') {
  const base = `https://github.com/o/r/blob/main/${file}`
  return anchor ? `${base}#${anchor}` : base
}
