// /* eslint-disable @typescript-eslint/no-unsafe-return */
// import {
//   Body,
//   Controller,
//   Get,
//   HttpStatus,
//   Post,
//   Res,
//   Request,
// } from '@nestjs/common';
// import { AppService } from '../service/app.service';
// import { OpenaiService } from '../service/openai.service';

// @Controller('/api')
// export class AppController {
//   constructor(
//     private readonly appService: AppService,
//     private readonly openaiService: OpenaiService,
//   ) {}

//   @Get()
//   getHello(): string {
//     return this.appService.getHello();
//   }

//   @Post('/skill')
//   async createSkill(@Res() response, @Body() createSkillDto: CreateSkillDto) {
//     try {
//       const newSkill = await this.appService.createSkill(createSkillDto);
//       return response.status(HttpStatus.CREATED).json({
//         message: 'Skill has been created successfully',
//         newStudent: newSkill,
//       });
//       // eslint-disable-next-line @typescript-eslint/no-unused-vars
//     } catch (err) {
//       return response.status(HttpStatus.BAD_REQUEST).json({
//         statusCode: 400,
//         message: 'Error: Skill not created!',
//         error: 'Bad Request',
//       });
//     }
//   }

//   // // @UseGuards(AuthenticatedGuard)
//   // @Get('/skills')
//   // getSkills(): Promise<Skill[]> {
//   //   return this.appService.getSkills();
//   // }
// }
