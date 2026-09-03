export class Projection {
  constructor(what, declared) {
    this.what = what
    this.declared = new Map(declared)
  }

  of(member) {
    const projected = this.declared.get(member)
    if (projected === undefined) {
      throw new Error(`no ${this.what} declared for ${member?.name ?? member}`)
    }

    return projected
  }

  members() {
    return [...this.declared.keys()]
  }
}
