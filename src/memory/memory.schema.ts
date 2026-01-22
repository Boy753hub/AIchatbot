import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MemoryDocument = Memory & Document;

@Schema({ timestamps: true })
export class Memory {
  // Tenant / Page scope (critical for multi-company)
  @Prop({ required: true })
  pageId: string;

  @Prop({ required: true })
  senderId: string;

  @Prop({ default: 'ai' })
  mode: 'ai' | 'human';

  @Prop()
  humanSince?: Date;

  @Prop({ default: '' })
  summary: string;

  @Prop({
    type: [
      {
        role: { type: String },
        content: { type: String },
      },
    ],
    default: [],
  })
  recentMessages: { role: 'user' | 'assistant'; content: string }[];

  // Optional: message dedupe to avoid double replies
  @Prop({ type: [String], default: [] })
  processedMids: string[];

  // Ad context
  @Prop()
  adId?: string;

  @Prop()
  adTitle?: string;

  @Prop()
  adProduct?: string;
}

export const MemorySchema = SchemaFactory.createForClass(Memory);

// ✅ Multi-tenant uniqueness
MemorySchema.index({ pageId: 1, senderId: 1 }, { unique: true });
