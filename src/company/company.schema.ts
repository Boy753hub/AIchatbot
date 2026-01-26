import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CompanyDocument = Company & Document;

@Schema({ timestamps: true })
export class Company {
  // Your internal identifier (slug)
  @Prop({ required: true, unique: true })
  companyId: string; // e.g. "drouli"

  @Prop({ required: true })
  name: string;

  // ✅ Tenant key: which Facebook Page this company owns
  @Prop({ required: true, unique: true })
  fbPageId: string;

  // ✅ Per-company token (recommended for multi-page support)
  // If you want to keep tokens in env for now, you can leave this empty.
  @Prop()
  fbPageToken?: string;

  // ✅ System prompt used by OpenAI (your big Georgian rules text)
  @Prop({ required: true })
  systemPrompt: string;

  // Token the AI returns to request handoff
  @Prop({ default: '__HANDOFF_TO_HUMAN__' })
  handoffToken: string;

  // What YOU send to the user when handoff happens
  @Prop({
    default: 'თქვენი შეტყობინება გადაეცა ოპერატორს. გთხოვთ დაელოდოთ პასუხს.',
  })
  handoffMessage: string;

  // OpenAI config per company
  @Prop({ default: 'gpt-4o' })
  model: string;

  @Prop({ default: 0.4 })
  temperature: number;

  // Optional per-company forbidden words list
  @Prop({ type: [String], default: [] })
  forbiddenWords: string[];

  // Optional: disable company without removing it
  @Prop({ default: true })
  isActive: boolean;
  @Prop({ default: false })
  supportNotifyEnabled: boolean;

  @Prop()
  slackWebhookUrl?: string;
}

export const CompanySchema = SchemaFactory.createForClass(Company);

// Helpful indexes
CompanySchema.index({ fbPageId: 1 }, { unique: true });
CompanySchema.index({ companyId: 1 }, { unique: true });
CompanySchema.index({ isActive: 1 });
