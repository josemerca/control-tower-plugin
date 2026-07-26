// Escapado POSIX de un valor para usarlo como UN solo argumento dentro de una
// línea de comando que un shell (`sh`, `bash`, …) va a parsear — el caso de
// `--command` de cmux, que ejecuta la cadena vía shell en vez de recibirla
// como argv ya separado. `JSON.stringify` es escapado JSON, no de shell: un
// `$`, un backtick o un `\` sobreviven dentro de comillas dobles y el shell
// los interpreta igual. Comillas simples POSIX son la única forma que no
// interpreta NADA dentro (ni `$`, ni backticks, ni `\`, ni saltos de línea) —
// la única excepción es la propia comilla simple, que hay que cerrar,
// escapar, y reabrir: `'\''`.
export function shQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}
