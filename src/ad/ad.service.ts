import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AdCatalog, AdCatalogDocument } from './ad.schema';

@Injectable()
export class AdService {
  constructor(
    @InjectModel(AdCatalog.name)
    private readonly adModel: Model<AdCatalogDocument>,
  ) {}

  async getByAdId(pageId: string, adId: string) {
    if (!pageId || !adId) return null;
    return this.adModel.findOne({ pageId, adId }).lean();
  }

  /**
   * Optional helper if you want to create/update manually via admin endpoint later.
   */
  async upsertAd(pageId: string, adId: string, data: Partial<AdCatalog>) {
    if (!pageId) throw new Error('pageId is required');
    if (!adId) throw new Error('adId is required');

    return this.adModel.findOneAndUpdate(
      { pageId, adId },
      {
        $set: {
          pageId,
          adId,
          title: data.title ?? '',
          product: data.product ?? '',
          description: data.description ?? '',
          tags: Array.isArray(data.tags) ? data.tags : [],
        },
      },
      { upsert: true, new: true },
    );
  }
}
