export class HarvestDeliveryParams {
  constructor({ prepared, repository }) {
    this.prepared = prepared
    this.repository = repository
    Object.freeze(this)
  }
}

export class HarvestDeliveryResult {
  constructor({ outcome }) {
    this.outcome = outcome
    Object.freeze(this)
  }
}

export class HarvestDelivery {
  constructor({ harvest }) {
    this.harvest = harvest
  }

  async execute(params) {
    return new HarvestDeliveryResult({
      outcome: await this.harvest.collect({
        issueNumber: params.prepared.issueNumber,
        repository: params.repository,
        root: params.prepared.located.root,
      }),
    })
  }
}
