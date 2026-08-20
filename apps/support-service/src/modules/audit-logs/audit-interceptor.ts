import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuditContext } from './audit-context';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const actorId: string | undefined = req.user?.id;

    if (!actorId) {
      return next.handle();
    }

    return new Observable((observer) => {
      AuditContext.run(actorId, () => {
        next.handle().subscribe(observer);
      });
    });
  }
}
