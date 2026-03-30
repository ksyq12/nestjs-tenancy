import { Injectable, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

/**
 * Optional event emission service that integrates with @nestjs/event-emitter.
 *
 * If `@nestjs/event-emitter` is installed and `EventEmitterModule.forRoot()`
 * is imported, events are emitted via EventEmitter2.
 * If not installed, all emit() calls are silently ignored.
 */
@Injectable()
export class TenancyEventService implements OnModuleInit {
  private emitter: { emit: (event: string, ...values: any[]) => boolean } | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  async onModuleInit() {
    try {
      // EventEmitter2 is registered as a class token, not a string token.
      // Dynamic import avoids making @nestjs/event-emitter a hard dependency.
      const { EventEmitter2 } = await import('@nestjs/event-emitter');
      this.emitter = this.moduleRef.get(EventEmitter2, { strict: false });
    } catch {
      // @nestjs/event-emitter not installed or not imported — events silently skip
    }
  }

  emit(event: string, payload: any): void {
    this.emitter?.emit(event, payload);
  }
}
