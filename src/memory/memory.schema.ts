import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MemoryDocument = Memory & Document;

@Schema({ timestamps: true })
export class Memory {
  @Prop({ required: true, unique: true })
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
}

export const MemorySchema = SchemaFactory.createForClass(Memory);
