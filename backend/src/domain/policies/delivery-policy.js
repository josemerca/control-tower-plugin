export class DeliveryState {
  static IMPLEMENTING = 'implementing'
  static IN_REVIEW = 'in-review'
  static FIXING = 'fixing'
}

export class DeliveryPolicy {
  static of({ pullRequest, inReview }) {
    if (pullRequest === null) return DeliveryState.IMPLEMENTING

    return inReview ? DeliveryState.IN_REVIEW : DeliveryState.FIXING
  }
}
