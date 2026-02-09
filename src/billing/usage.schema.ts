import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UsageLogDocument = UsageLog & Document;

@Schema({ timestamps: true })
export class UsageLog {
  @Prop({ required: true })
  companyId: string; // your internal company slug

  @Prop({ required: true })
  pageId: string;

  @Prop({ required: true })
  senderId: string;

  @Prop({ required: true })
  model: string;

  @Prop({ default: 0 })
  promptTokens: number;

  @Prop({ default: 0 })
  completionTokens: number;

  @Prop({ default: 0 })
  totalTokens: number;

  @Prop({ default: 0 })
  costUsd: number;

  @Prop({ default: 1 })
  numCalls: number;

  @Prop()
  kind?: 'main' | 'rewrite'; // optional: helps debugging (2nd pass rewrite costs money too)
}

export const UsageLogSchema = SchemaFactory.createForClass(UsageLog);

UsageLogSchema.index({ companyId: 1, createdAt: 1 });
UsageLogSchema.index({ pageId: 1, createdAt: 1 });
