import { WeightedRecyclerMatcher, type GeoPoint, type MatchResult } from '@ewaste/shared';
import type { Repository } from '../repository/types.ts';
import type { PriceService } from './prices.ts';

export class MatchService {
  private readonly matcher = new WeightedRecyclerMatcher();

  constructor(
    private readonly repo: Repository,
    private readonly prices: PriceService,
  ) {}

  async forLot(
    lotId: string,
    options: {
      collectorPoint?: GeoPoint;
      maxDistanceKm?: number;
      preferredPayment?: 'cash' | 'upi' | 'bank_transfer';
      limit?: number;
    } = {},
  ): Promise<MatchResult | undefined> {
    const lot = await this.repo.getLot(lotId);
    if (!lot) return undefined;

    const point = options.collectorPoint ?? lot.collectionPlace.point;
    if (!point) return { matches: [], excluded: [], matcherId: this.matcher.id };

    // Neighbouring districts matter: a collector on a district boundary should
    // not be cut off from the buyer 6 km away on the other side of the line.
    const recyclers = await this.repo.listRecyclers();
    const priceIndex = await this.prices.getIndex(lot.collectionPlace.district);

    return this.matcher.match({
      lot,
      collectorPoint: point,
      recyclers,
      priceIndex,
      maxDistanceKm: options.maxDistanceKm,
      preferredPayment: options.preferredPayment,
      limit: options.limit,
    });
  }
}
