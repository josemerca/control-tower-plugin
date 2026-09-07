export class MalformedAgentDefinition extends Error {
  constructor(detail) {
    super(`the agent definition cannot be used: ${detail}`)
    this.detail = detail
  }
}

export class AgentDefinition {
  static #FRONTMATTER = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
  static #REQUIRED = Object.freeze(['name', 'tools', 'model'])

  constructor({ name, description, tools, model, prompt }) {
    this.name = name
    this.description = description
    this.tools = Object.freeze([...tools])
    this.model = model
    this.prompt = prompt
    Object.freeze(this)
  }

  static parse(text) {
    const match = AgentDefinition.#FRONTMATTER.exec(String(text ?? ''))
    if (!match) throw new MalformedAgentDefinition('it does not open with a --- frontmatter block')
    const fields = AgentDefinition.#fieldsOf(match[1])
    const missing = AgentDefinition.#REQUIRED.filter((key) => !fields.has(key) || fields.get(key) === '')
    if (missing.length) throw new MalformedAgentDefinition(`the frontmatter lacks ${missing.join(', ')}`)
    const prompt = match[2].trim()
    if (prompt === '') throw new MalformedAgentDefinition('the body after the frontmatter is empty')
    return new AgentDefinition({
      name: fields.get('name'),
      description: fields.get('description') ?? '',
      tools: fields.get('tools').split(',').map((tool) => tool.trim()).filter(Boolean),
      model: fields.get('model'),
      prompt,
    })
  }

  static #fieldsOf(frontmatter) {
    const fields = new Map()
    for (const line of frontmatter.split('\n')) {
      const separator = line.indexOf(':')
      if (separator === -1) continue
      fields.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
    }
    return fields
  }

  toClaudeAgents() {
    return {
      [this.name]: {
        description: this.description,
        prompt: this.prompt,
        tools: [...this.tools],
        model: this.model,
      },
    }
  }
}
