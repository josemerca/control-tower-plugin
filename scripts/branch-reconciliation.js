import { DiscardReason, ReconcileOutcome, ReconcileRound } from './reconcile-outcome.js'

export class BranchReconciliation {
  // `isMachineryPath` es una POLÍTICA (qué rutas escribe el propio loop, no el
  // agente que resuelve), y una política no vive en un adaptador
  // (`conventions/architecture.md`): se recibe, igual que `git`. Por defecto
  // NO exenta nada — `() => false` reproduce el comportamiento de antes de
  // este fix al pie de la letra, así que un consumidor que no pasa el
  // predicado no gana un fail-open silencioso (seguiría descartando por
  // CUALQUIER ruta ajena, que es más estricto, nunca más permisivo) y los
  // tests ya escritos contra este constructor sin `isMachineryPath` no se
  // rompen. Quien SÍ conoce la política (`ct-step.mjs`, a partir de
  // `LOOP_ARTIFACT_PATTERNS`/`matchesPattern` de `scripts/scope.js`) es quien
  // tiene que pasarla.
  constructor({ git, isMachineryPath = () => false }) {
    this.git = git
    this.isMachineryPath = isMachineryPath
  }

  merge({ baseBranch }) {
    this.git(['fetch', 'origin', baseBranch])
    const behind = this.git(['rev-list', '--count', `HEAD..origin/${baseBranch}`])
    if (Number(behind.stdout.trim()) === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UP_TO_DATE, files: [] })
    }
    const merged = this.git(['merge', '--no-edit', `origin/${baseBranch}`])
    if (merged.code === 0) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.MERGED, files: [] })
    }
    if (!this.isMergeInProgress()) {
      return ReconcileRound.of({ outcome: ReconcileOutcome.UNMERGEABLE_TREE, files: [] })
    }
    return ReconcileRound.of({ outcome: ReconcileOutcome.CONFLICTING, files: this.unmergedFiles() })
  }

  isMergeInProgress() {
    return this.git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).code === 0
  }

  unmergedFiles() {
    return this.git(['diff', '--name-only', '--diff-filter=U'])
      .stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  }

  conclude() {
    const files = this.unmergedFiles()
    if (this.filesTouchedOutside(files).length) {
      return this.discard(files, DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT)
    }
    if (this.filesStillCarryingMarkers(files).length) {
      return this.discard(files, DiscardReason.MARKERS_LEFT)
    }
    this.git(['add', ...files])
    if (this.unmergedFiles().length) {
      return this.discard(files, DiscardReason.UNRESOLVED_FILES_REMAIN)
    }
    this.git(['commit', '--no-edit'])
    return ReconcileRound.of({ outcome: ReconcileOutcome.RESOLVED, files })
  }

  discard(files, reason) {
    this.git(['checkout', '--merge', '--', ...files])
    return ReconcileRound.discarded({ files, reason })
  }

  // La basura DEL PROPIO LOOP —telemetría, veredictos, el plan— no es una
  // resolución tocando de más: es la huella de la maquinaria, presente ANTES
  // de que nadie resuelva nada (`ct-step reconcile` mide con `medir()` en
  // cada invocación, así que su propia fila de telemetría ya está sin
  // comitear en el árbol para cuando esto se pregunta la segunda vez). Sin
  // filtrarla, ninguna resolución llega nunca a `RESOLVED`: la segunda
  // llamada siempre ve ese fichero y descarta por
  // `TOUCHED_OUTSIDE_THE_CONFLICT`, pase lo que pase con el conflicto real.
  filesTouchedOutside(files) {
    return this.git(['status', '--porcelain'])
      .stdout.split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => line.slice(3).trim())
      .filter((path) => !files.includes(path))
      .filter((path) => !this.isMachineryPath(path))
  }

  filesStillCarryingMarkers(files) {
    const result = this.git(['grep', '-l', '-e', '<<<<<<<', '-e', '=======', '-e', '>>>>>>>', '--', ...files])
    if (result.code !== 0 && result.code !== 1) {
      throw new Error(`git grep failed while checking for conflict markers (exit code ${result.code})`)
    }
    return result.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  }
}
