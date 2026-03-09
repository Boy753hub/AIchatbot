import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import mongoose from 'mongoose';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
  app.enableCors({
    origin: ['http://localhost:5173', 'https://drouli.ge'],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  mongoose.connection.on('connected', () =>
    console.log('✅ Mongo connected:', mongoose.connection.name),
  );
  mongoose.connection.on('error', (err) => console.log('❌ Mongo error:', err));
  mongoose.connection.on('disconnected', () =>
    console.log('⚠️ Mongo disconnected'),
  );
}
bootstrap();
