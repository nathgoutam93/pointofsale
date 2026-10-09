import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { MetaService } from './meta.service';

@Controller()
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  /** Called before sign-in: which mode this API runs in, its versions, and whether setup is needed. */
  @Public()
  @Get('/meta')
  getMeta() {
    return this.meta.getMeta();
  }
}
