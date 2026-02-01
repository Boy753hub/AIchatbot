import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdCatalog, AdCatalogSchema } from './ad.schema';
import { AdService } from './ad.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: AdCatalog.name, schema: AdCatalogSchema },
    ]),
  ],
  providers: [AdService],
  exports: [AdService],
})
export class AdModule {}
