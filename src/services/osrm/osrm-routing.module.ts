import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { OsrmRoutingService } from './osrm-routing.service'

// NestJS module encapsulating the OSRM routing service and its HTTP client dependency
@Module({
  imports: [HttpModule],
  providers: [OsrmRoutingService],
  exports: [OsrmRoutingService],
})
export class OsrmRoutingModule {}
