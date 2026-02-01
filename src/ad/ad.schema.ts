import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AdCatalogDocument = AdCatalog & Document;

@Schema({ timestamps: true })
export class AdCatalog {
  // Tenant key (important if you have multiple FB pages/companies)
  @Prop({ required: true })
  pageId: string;

  // Facebook ad id
  @Prop({ required: true })
  adId: string;

  // Your manual fields (what the ad is about)
  @Prop({ default: '' })
  title: string;

  @Prop({ default: '' })
  product: string;

  @Prop({ default: '' })
  description: string;

  @Prop({ type: [String], default: [] })
  tags: string[];
}

export const AdCatalogSchema = SchemaFactory.createForClass(AdCatalog);

// Unique per tenant
AdCatalogSchema.index({ pageId: 1, adId: 1 }, { unique: true });
