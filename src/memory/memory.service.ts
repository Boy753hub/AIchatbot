import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Memory, MemoryDocument } from './memory.schema';

@Injectable()
export class MemoryService {
  constructor(
    @InjectModel(Memory.name)
    private readonly memoryModel: Model<MemoryDocument>,
  ) {}

  // ===============================
  // Create or load memory
  // ===============================
  async getOrCreate(senderId: string): Promise<MemoryDocument> {
    let mem = await this.memoryModel.findOne({ senderId }).lean();

    if (!mem) {
      mem = await this.memoryModel.create({
        senderId,
        mode: 'ai',
        recentMessages: [],
      });
    }

    return mem as MemoryDocument;
  }

  // ===============================
  // Switch to HUMAN mode
  // ===============================
  async switchToHuman(senderId: string) {
    await this.memoryModel.updateOne(
      { senderId },
      {
        $set: {
          mode: 'human',
          humanSince: new Date(),
        },
      },
      { upsert: true },
    );
  }

  // ===============================
  // ADMIN: Force AI mode
  // ===============================
  async setMode(senderId: string, mode: 'ai' | 'human') {
    if (mode === 'human') {
      return this.switchToHuman(senderId);
    }

    await this.memoryModel.updateOne(
      { senderId },
      {
        $set: { mode: 'ai' },
        $unset: { humanSince: '' },
      },
      { upsert: true },
    );
  }

  // ===============================
  // ADMIN: Clear conversation memory
  // ===============================
  async clearConversation(senderId: string) {
    await this.memoryModel.updateOne(
      { senderId },
      {
        $set: { recentMessages: [] },
      },
    );
  }

  // ===============================
  // Auto-return to AI after 24h
  // (NO timers – safe for Render)
  // ===============================
  async ensureAiIfExpired(senderId: string): Promise<'ai' | 'human'> {
    const mem = await this.memoryModel.findOne({ senderId }).lean();

    if (!mem || mem.mode !== 'human' || !mem.humanSince) {
      return 'ai';
    }

    const HOURS_24 = 24 * 60 * 60 * 1000;
    const expired = Date.now() - new Date(mem.humanSince).getTime() >= HOURS_24;

    if (expired) {
      await this.memoryModel.updateOne(
        { senderId },
        {
          $set: { mode: 'ai' },
          $unset: { humanSince: '' },
        },
      );
      return 'ai';
    }

    return 'human';
  }

  // ===============================
  // Save conversation turns
  // (Hard limit → prevents memory leaks)
  // ===============================
  async addTurn(senderId: string, role: 'user' | 'assistant', content: string) {
    await this.memoryModel.updateOne(
      { senderId },
      {
        $push: {
          recentMessages: {
            $each: [{ role, content }],
            $slice: -20, // 🔒 HARD LIMIT
          },
        },
      },
      { upsert: true },
    );
  }

  async saveAdContext(
    senderId: string,
    ad: { adId?: string; adTitle?: string; adProduct?: string },
  ) {
    await this.memoryModel.updateOne(
      { senderId },
      {
        $set: {
          adId: ad.adId,
          adTitle: ad.adTitle,
          adProduct: ad.adProduct,
        },
      },
    );
  }
}
