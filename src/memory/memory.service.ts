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
    let mem = await this.memoryModel.findOne({ senderId });

    if (!mem) {
      mem = await this.memoryModel.create({ senderId });
    }

    return mem;
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
    );
  }

  // ===============================
  // Auto-return to AI after 24h
  // ===============================
  async ensureAiIfExpired(senderId: string): Promise<'ai' | 'human'> {
    const mem = await this.getOrCreate(senderId);

    if (mem.mode !== 'human' || !mem.humanSince) {
      return mem.mode ?? 'ai';
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
  // ===============================
  async addTurn(senderId: string, role: 'user' | 'assistant', content: string) {
    await this.memoryModel.updateOne(
      { senderId },
      {
        $push: {
          recentMessages: {
            $each: [{ role, content }],
            $slice: -20,
          },
        },
      },
    );
  }
}
