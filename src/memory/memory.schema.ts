import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MemoryDocument = HydratedDocument<Memory>;

@Schema({ _id: false })
export class ChatMsg {
  @Prop({ enum: ['user', 'assistant'], required: true })
  role: 'user' | 'assistant';

  @Prop({ required: true })
  content: string;

  @Prop({ type: Date, default: () => new Date() })
  ts: Date;
}

const ChatMsgSchema = SchemaFactory.createForClass(ChatMsg);

@Schema({ timestamps: true })
export class Memory {
  @Prop({ required: true, unique: true, index: true })
  userId: string; // Messenger senderId

  @Prop({ default: '' })
  summary: string;

  @Prop({ type: [ChatMsgSchema], default: [] })
  recentMessages: ChatMsg[];

  @Prop({
    type: Object,
    default: {},
  })
  profile: {
    name?: string;
    phone?: string;
    address?: string;
  };

  // optional: update this whenever user talks (good for TTL)
  @Prop({ type: Date, default: () => new Date(), index: true })
  lastSeenAt: Date;
}

export const MemorySchema = SchemaFactory.createForClass(Memory);

// OPTIONAL TTL: auto-delete memory if user inactive for 90 days
// MemorySchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });
