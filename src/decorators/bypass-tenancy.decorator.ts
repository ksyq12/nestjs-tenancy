import { SetMetadata } from '@nestjs/common';
import { BYPASS_TENANCY_KEY } from '../tenancy.constants';

export const BypassTenancy = () => SetMetadata(BYPASS_TENANCY_KEY, true);
