import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { appContract } from '@pos/contracts';
import { Public } from '../auth/auth.guard';
import { OfflineOnlyGuard } from '../common/mode';
import { type Parsed, ZodValidationPipe } from '../validation/zod-validation.pipe';
import { SetupService } from './setup.service';

@Controller()
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  /**
   * Offline only; online businesses are created through sign-up. Open without a token, but
   * refused once the business has any user.
   */
  @Public()
  @UseGuards(OfflineOnlyGuard)
  @Post('/setup')
  setup(@Body(new ZodValidationPipe(appContract.setup.run.body)) body: Parsed<typeof appContract.setup.run.body>) {
    return this.setupService.setup(body);
  }
}
