import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Memory, MemorySchema } from './memory.schema';
import { MemoryService } from './memory.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Memory.name, schema: MemorySchema }]),
  ],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
