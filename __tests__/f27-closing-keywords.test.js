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
