import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { TenantContext } from './tenant-context';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const tenantId: string | undefined = req.user?.impersonatedTenantId ?? req.user?.tenantId;

    if (!tenantId) {
      return next.handle();
    }

    return new Observable((observer) => {
      TenantContext.run(tenantId, () => {
        next.handle().subscribe(observer);
      });
    });
  }
}
