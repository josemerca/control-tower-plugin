import { describe, it, expect, afterAll } from 'vitest'
import { tokenizeSegments } from '../scripts/closing-keywords.js'

describe('F27 — tokenizeSegments', () => {
  it('separa tokens por espacios', () => {
    expect(tokenizeSegments('git commit -m hola')).toEqual([['git', 'commit', '-m', 'hola']])
  })

  it('respeta comillas dobles y simples como UN token', () => {
    expect(tokenizeSegments('git commit -m "dos palabras"')).toEqual([['git', 'commit', '-m', 'dos palabras']])
    expect(tokenizeSegments("git commit -m 'dos palabras'")).toEqual([['git', 'commit', '-m', 'dos palabras']])
  })

  it('un token vacio entrecomillado sigue siendo un token', () => {
    expect(tokenizeSegments('git commit -m ""')).toEqual([['git', 'commit', '-m', '']])
  })

  // LA propiedad que sostiene toda la ronda: el `gh pr create` del camino feliz
  // vive en su propio segmento y no se mezcla con el del commit.
  it('corta por &&, ||, ; y | en segmentos independientes', () => {
    expect(tokenizeSegments('git commit -m x && gh pr create --body y')).toEqual([
      ['git', 'commit', '-m', 'x'],
      ['gh', 'pr', 'create', '--body', 'y'],
    ])
    expect(tokenizeSegments('a ; b | c || d')).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('corta por salto de linea', () => {
    expect(tokenizeSegments('cd x\ngit commit -m y')).toEqual([['cd', 'x'], ['git', 'commit', '-m', 'y']])
  })

  it('un escape con barra invertida conserva el caracter literal', () => {
    expect(tokenizeSegments('git commit -m a\\ b')).toEqual([['git', 'commit', '-m', 'a b']])
  })

  it('una comilla sin cerrar no lanza: se consume hasta el final', () => {
    expect(() => tokenizeSegments('git commit -m "sin cerrar')).not.toThrow()
  })

  it('entrada no-string devuelve lista vacia', () => {
    expect(tokenizeSegments(undefined)).toEqual([])
    expect(tokenizeSegments(null)).toEqual([])
  })
})

import { extractCommitMessages } from '../scripts/closing-keywords.js'

describe('F27 — extractCommitMessages', () => {
  it('saca el mensaje de -m con espacio', () => {
    expect(extractCommitMessages('git commit -m "arregla algo"')).toEqual(['arregla algo'])
  })

  it('saca el mensaje de la forma pegada -mX', () => {
    expect(extractCommitMessages('git commit -marregla')).toEqual(['arregla'])
  })

  it('saca el mensaje de --message= y de --message con espacio', () => {
    expect(extractCommitMessages('git commit --message=uno')).toEqual(['uno'])
    expect(extractCommitMessages('git commit --message dos')).toEqual(['dos'])
  })

  it('varios -m se devuelven todos (git los concatena como parrafos)', () => {
    expect(extractCommitMessages('git commit -m titulo -m cuerpo')).toEqual(['titulo', 'cuerpo'])
  })

  it('acepta opciones globales antes del subcomando', () => {
    expect(extractCommitMessages('git -C /tmp/repo commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git -c user.name=x commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git --git-dir=/tmp/.git commit -m hola')).toEqual(['hola'])
  })

  it('acepta una ruta absoluta a git', () => {
    expect(extractCommitMessages('/usr/bin/git commit -m hola')).toEqual(['hola'])
  })

  it('un --amend con -m si trae mensaje en linea', () => {
    expect(extractCommitMessages('git commit --amend -m nuevo')).toEqual(['nuevo'])
  })

  // Los NEGATIVOS son los que importan: bloquear el camino feliz es el fallo caro.
  it('gh pr create no es un commit y no aporta nada', () => {
    expect(extractCommitMessages('gh pr create --body "Closes #42"')).toEqual([])
  })

  it('un commit encadenado con un gh pr create solo aporta lo suyo', () => {
    expect(extractCommitMessages('git commit -m limpio && gh pr create --body "Closes #1"')).toEqual(['limpio'])
  })

  it('git sin subcomando commit no aporta nada', () => {
    expect(extractCommitMessages('git log -m cosa')).toEqual([])
    expect(extractCommitMessages('git push origin main')).toEqual([])
  })

  it('un commit sin -m no aporta nada (el mensaje lo pone el editor)', () => {
    expect(extractCommitMessages('git commit --amend --no-edit')).toEqual([])
    expect(extractCommitMessages('git commit -F mensaje.txt')).toEqual([])
  })

  it('lo que va detras de -- es pathspec, no mensaje', () => {
    expect(extractCommitMessages('git commit -m real -- -m falso')).toEqual(['real'])
  })

  // Flags cortas combinadas en UN cumulo de un solo guion: semantica getopt,
  // la que usa git. Si aparece una 'm' en el cumulo, lo de detras es el valor
  // si no esta vacio; si esta vacio, el valor es el token siguiente.
  it('un cumulo -am con el mensaje en el token siguiente', () => {
    expect(extractCommitMessages('git commit -am "hola"')).toEqual(['hola'])
  })

  it('un cumulo -qm con el mensaje en el token siguiente', () => {
    expect(extractCommitMessages('git commit -qm "hola"')).toEqual(['hola'])
  })

  it('un cumulo -am con el mensaje pegado tras la m', () => {
    expect(extractCommitMessages('git commit -amhola')).toEqual(['hola'])
  })

  // Camino feliz ya cubierto arriba, se repite aqui como ancla explicita del
  // contraste con los cumulos: la 'm' sola sigue funcionando igual.
  it('la m sola, con espacio o pegada, sigue funcionando', () => {
    expect(extractCommitMessages('git commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -mhola')).toEqual(['hola'])
  })

  // Negativos: ningun cumulo sin 'm', ni un --amend de guion doble, aportan
  // texto. Bloquear esto por error convertiria la barandilla en un ladrillo.
  it('un cumulo sin m no aporta nada', () => {
    expect(extractCommitMessages('git commit -a')).toEqual([])
  })

  it('-C tras commit reutiliza el mensaje de otro commit: no hay texto aqui', () => {
    expect(extractCommitMessages('git commit -C HEAD')).toEqual([])
  })

  it('un --amend de guion doble solo no aporta nada', () => {
    expect(extractCommitMessages('git commit --amend')).toEqual([])
  })

  // Ronda 2: una flag que consume el resto del cumulo como SU valor
  // obligatorio (F, C, c, t) tapa cualquier 'm' que venga detras. Esa 'm' es
  // parte del valor de la otra flag, no el inicio de un mensaje.
  it('la F pegada se come el nombre de fichero entero, la m de en medio no es mensaje', () => {
    expect(extractCommitMessages('git commit -Fmensaje.txt')).toEqual([])
  })

  it('la C pegada se come el commit a reusar, la m de en medio no es mensaje', () => {
    expect(extractCommitMessages('git commit -Cmabcdef')).toEqual([])
  })

  it('la c pegada se come el commit a reusar y editar, la m de en medio no es mensaje', () => {
    expect(extractCommitMessages('git commit -cmabcdef')).toEqual([])
  })

  it('la t pegada se come la plantilla, la m de en medio no es mensaje', () => {
    expect(extractCommitMessages('git commit -tplantilla.txt')).toEqual([])
  })

  it('-F con espacio sigue sin aportar mensaje (ya funcionaba, no romper)', () => {
    expect(extractCommitMessages('git commit -F mensaje.txt')).toEqual([])
  })

  // Anti-regresion explicita de la ronda 1: estos ya funcionaban y tienen
  // que seguir funcionando igual tras el escaneo caracter a caracter.
  it('anti-regresion: los cumulos y formas de -m que ya funcionaban siguen igual', () => {
    expect(extractCommitMessages('git commit -am "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -qm "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -aqm "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -amhola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -mhola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -ma')).toEqual(['a'])
    expect(extractCommitMessages('git commit -a')).toEqual([])
    expect(extractCommitMessages('git commit -C HEAD')).toEqual([])
  })
})

import { findClosingKeywords, CLOSING_KEYWORDS } from '../scripts/closing-keywords.js'

describe('F27 — findClosingKeywords', () => {
  it('las NUEVE keywords de GitHub, ni una mas ni una menos', () => {
    expect(CLOSING_KEYWORDS).toEqual([
      'close', 'closes', 'closed',
      'fix', 'fixes', 'fixed',
      'resolve', 'resolves', 'resolved',
    ])
  })

  it('cada una de las nueve dispara', () => {
    for (const k of CLOSING_KEYWORDS) {
      expect(findClosingKeywords(`${k} #7`)).toHaveLength(1)
    }
  })

  it('es insensible a mayusculas y admite dos puntos', () => {
    expect(findClosingKeywords('CLOSES #10')).toHaveLength(1)
    expect(findClosingKeywords('Closes: #10')).toHaveLength(1)
    expect(findClosingKeywords('Fixes:#10')).toHaveLength(1)
  })

  it('acepta la forma owner/repo#N', () => {
    const f = findClosingKeywords('Fixes octo-org/octo-repo#100')
    expect(f).toHaveLength(1)
    expect(f[0].ref).toBe('octo-org/octo-repo#100')
  })

  it('devuelve la keyword y la referencia encontradas', () => {
    expect(findClosingKeywords('Closes #451')).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  it('caza la keyword dentro de una frase entrecomillada — las comillas NO protegen', () => {
    // Es, palabra por palabra, la forma del commit que cerro el #451 en campo.
    const f = findClosingKeywords('Dos observaciones sobre el kickoff: no dice "Closes #451", y el agente no recibe el spec.')
    expect(f).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  // NEGATIVOS
  it('una referencia sin keyword no dispara', () => {
    expect(findClosingKeywords('mira el #42 cuando puedas')).toEqual([])
  })

  it('una keyword sin referencia no dispara', () => {
    expect(findClosingKeywords('closes the door')).toEqual([])
    expect(findClosingKeywords('fixed the flaky test')).toEqual([])
  })

  it('la keyword tiene que ser palabra entera', () => {
    expect(findClosingKeywords('prefix #42')).toEqual([])
    expect(findClosingKeywords('foreclosed #42')).toEqual([])
  })

  it('entrada no-string devuelve lista vacia', () => {
    expect(findClosingKeywords(undefined)).toEqual([])
  })
})

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeGovernedRepo, CONTRACT_MARKER } from '../scripts/governed-repo.js'

describe('F27 — probeGovernedRepo', () => {
  const hechos = []
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'f27-')); hechos.push(d); return d }
  afterAll(() => { for (const d of hechos) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

  it('un repo con AGENTS.md que lleva el marcador esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), `# AGENTS\n${CONTRACT_MARKER}\ncosas\n`)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  // La mitad de la cobertura de la puerta son los agentes despachados, y todos
  // trabajan en un worktree, donde .git es un FICHERO.
  it('un worktree, cuyo .git es un FICHERO, se reconoce igual', () => {
    const d = tmp()
    writeFileSync(join(d, '.git'), 'gitdir: /otro/sitio/.git/worktrees/2\n')
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  it('sube desde un subdirectorio hasta la raiz', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    const sub = join(d, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    expect(probeGovernedRepo(sub)).toEqual({ governed: true })
  })

  it('un repo sin AGENTS.md NO esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('un AGENTS.md sin el marcador NO esta gobernado', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), '# AGENTS\nsin marcador\n')
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('lo que no es un repo git NO esta gobernado', () => {
    expect(probeGovernedRepo(tmp())).toEqual({ governed: false })
  })

  it('un AGENTS.md ilegible es ERROR, nunca "no gobernado"', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    const f = join(d, 'AGENTS.md')
    writeFileSync(f, CONTRACT_MARKER)
    chmodSync(f, 0o000)
    const r = probeGovernedRepo(d)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('un cwd que no existe es ERROR, nunca "no gobernado"', () => {
    const r = probeGovernedRepo(join(tmpdir(), 'f27-no-existe-jamas', 'x'))
    expect(r.error).toBeTruthy()
  })

  // Un cwd que no es una cadena no puede coercionarse en silencio al cwd del
  // PROCESO: eso contestaria sobre un directorio que quien llama nunca nombro.
  // La aserción no depende de en que directorio corra el proceso de test: un
  // `.error` presente y un `.governed` ausente ya distinguen "rehuse
  // contestar" de "conteste que no", sin importar si ese directorio esta o no
  // gobernado.
  it('cwd undefined es ERROR, nunca una respuesta sobre el cwd del proceso', () => {
    const r = probeGovernedRepo(undefined)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('cwd null es ERROR, nunca una respuesta sobre el cwd del proceso', () => {
    const r = probeGovernedRepo(null)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('cwd cadena vacia es ERROR, nunca una respuesta sobre el cwd del proceso', () => {
    const r = probeGovernedRepo('')
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('cwd numerico es ERROR por tipo, no por coincidencia de ruta inexistente', () => {
    const r = probeGovernedRepo(42)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('cwd objeto es ERROR', () => {
    const r = probeGovernedRepo({})
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })
})
