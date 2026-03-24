/* eslint-disable @typescript-eslint/no-unsafe-call */
// contact.dto.ts
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  phone: string;

  @IsString()
  message: string;
}
