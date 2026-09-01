export class ShellWord {
  static quote(text) {
    return `'${String(text).split("'").join("'\\''")}'`
  }
}
