import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Memory } from './memory.schema';

@Injectable()
export class MemoryService {
  constructor(@InjectModel(Memory.name) private memModel: Model<Memory>) {}

  async getOrCreate(userId: string) {
    const mem = await this.memModel.findOneAndUpdate(
      { userId },
      {
        $setOnInsert: {
          userId,
          summary: '',
          recentMessages: [],
          profile: {},
          lastSeenAt: new Date(),
        },
      },
      { new: true, upsert: true },
    );
    return mem;
  }

  async addTurn(userId: string, role: 'user' | 'assistant', content: string) {
    const max = 20;

    // push new message and keep only last `max`
    await this.memModel.updateOne(
      { userId },
      {
        $set: { lastSeenAt: new Date() },
        $push: {
          recentMessages: {
            $each: [{ role, content, ts: new Date() }],
            $slice: -max,
          },
        },
      },
      { upsert: true },
    );
  }

  async setSummary(userId: string, summary: string) {
    await this.memModel.updateOne(
      { userId },
      { $set: { summary, lastSeenAt: new Date() } },
      { upsert: true },
    );
  }

  async updateProfile(userId: string, patch: Partial<Memory['profile']>) {
    const setObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v) setObj[`profile.${k}`] = v;
    }
    if (Object.keys(setObj).length === 0) return;

    await this.memModel.updateOne(
      { userId },
      { $set: { ...setObj, lastSeenAt: new Date() } },
      { upsert: true },
    );
  }
}
