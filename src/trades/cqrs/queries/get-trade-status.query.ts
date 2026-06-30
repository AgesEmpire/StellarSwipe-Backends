/** Query to look up a trade (and its status) by id for a given user. */
export class GetTradeStatusQuery {
  constructor(
    public readonly tradeId: string,
    public readonly userId: string,
  ) {}
}
