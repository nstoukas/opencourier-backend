import { Injectable, Module } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AblyDispatcherModule } from '../../integrations/ably/ably-dispatcher.module'
import { AblyDispatcher } from '../../integrations/ably/ably.dispatcher'
import { AblyModule } from '../../integrations/ably/ably.module'
import { AblyService } from '../../integrations/ably/ably.service'
import { SocketIOModule } from '../socketio/socketio.module'
import { SocketIODispatcher } from '../socketio/socketio.dispatcher'
import { WebsocketDispatcher } from './models/WebsocketDispatcher'
import { selectWebsocketDispatcherModule } from './select-websocket-dispatcher-module'

// Consumer service mimicking a service (like DeliveryEventService) that injects
// WebsocketDispatcher without directly importing either dispatcher module.
@Injectable()
class TestConsumerService {
  constructor(public readonly dispatcher: WebsocketDispatcher) {}
}

// Consumer module that imports neither AblyModule nor SocketIOModule.
// Relies entirely on global export of WebsocketDispatcher.
@Module({
  providers: [TestConsumerService],
  exports: [TestConsumerService],
})
class TestConsumerModule {}

// Consumer service mimicking AuthDomainService, which injects AblyService for courier login tokens.
@Injectable()
class TestAuthConsumerService {
  constructor(public readonly ablyService: AblyService) {}
}

// Consumer module that imports AblyModule (mirroring AuthDomainModule).
@Module({
  imports: [AblyModule],
  providers: [TestAuthConsumerService],
  exports: [TestAuthConsumerService],
})
class TestAuthConsumerModule {}

describe('selectWebsocketDispatcherModule', () => {
  describe('module selection logic', () => {
    it('returns AblyDispatcherModule when input is exactly "ably"', () => {
      const selected = selectWebsocketDispatcherModule('ably')
      expect(selected).toBe(AblyDispatcherModule)
    })

    it('returns SocketIOModule when input is undefined (default fallback)', () => {
      const selected = selectWebsocketDispatcherModule(undefined)
      expect(selected).toBe(SocketIOModule)
    })

    it('returns SocketIOModule when input is an empty string', () => {
      const selected = selectWebsocketDispatcherModule('')
      expect(selected).toBe(SocketIOModule)
    })

    it('returns SocketIOModule when input is "socketio"', () => {
      const selected = selectWebsocketDispatcherModule('socketio')
      expect(selected).toBe(SocketIOModule)
    })

    it('returns SocketIOModule when input is "Ably" (case-sensitive check)', () => {
      const selected = selectWebsocketDispatcherModule('Ably')
      expect(selected).toBe(SocketIOModule)
    })

    it('returns SocketIOModule for any unrecognized dispatcher string', () => {
      const selected = selectWebsocketDispatcherModule('unexpected-dispatcher')
      expect(selected).toBe(SocketIOModule)
    })
  })

  describe('dependency injection wiring', () => {
    let moduleRef: TestingModule

    afterEach(async () => {
      if (moduleRef) {
        await moduleRef.close()
      }
    })

    it('injects SocketIODispatcher into consumer when dispatcher is undefined (fixing the Ably override bug)', async () => {
      // Build testing module importing AblyModule (like AuthDomainModule does) plus selectWebsocketDispatcherModule(undefined)
      // Override 'ablyClient' with plain object to prevent network connections or missing API key errors.
      moduleRef = await Test.createTestingModule({
        imports: [AblyModule, selectWebsocketDispatcherModule(undefined), TestConsumerModule],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const consumer = moduleRef.get(TestConsumerService)
      expect(consumer.dispatcher).toBeInstanceOf(SocketIODispatcher)
      expect(consumer.dispatcher).not.toBeInstanceOf(AblyDispatcher)
    })

    it('injects AblyDispatcher into consumer when dispatcher is explicitly "ably"', async () => {
      // Build testing module importing AblyModule plus selectWebsocketDispatcherModule('ably')
      moduleRef = await Test.createTestingModule({
        imports: [AblyModule, selectWebsocketDispatcherModule('ably'), TestConsumerModule],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const consumer = moduleRef.get(TestConsumerService)
      expect(consumer.dispatcher).toBeInstanceOf(AblyDispatcher)
      expect(consumer.dispatcher).not.toBeInstanceOf(SocketIODispatcher)
    })

    it('injects SocketIODispatcher into consumer when dispatcher is "socketio"', async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AblyModule, selectWebsocketDispatcherModule('socketio'), TestConsumerModule],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const consumer = moduleRef.get(TestConsumerService)
      expect(consumer.dispatcher).toBeInstanceOf(SocketIODispatcher)
      expect(consumer.dispatcher).not.toBeInstanceOf(AblyDispatcher)
    })

    it('injects SocketIODispatcher into consumer when dispatcher is empty string', async () => {
      moduleRef = await Test.createTestingModule({
        imports: [AblyModule, selectWebsocketDispatcherModule(''), TestConsumerModule],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const consumer = moduleRef.get(TestConsumerService)
      expect(consumer.dispatcher).toBeInstanceOf(SocketIODispatcher)
      expect(consumer.dispatcher).not.toBeInstanceOf(AblyDispatcher)
    })
  })

  describe('AblyService export for authentication / login (row 57 review minor 2)', () => {
    let moduleRef: TestingModule

    afterEach(async () => {
      if (moduleRef) {
        await moduleRef.close()
      }
    })

    it('compiles AblyModule with ablyClient overridden and strictly exports AblyService', async () => {
      // Confirms AblyModule provides and strictly exports AblyService directly
      moduleRef = await Test.createTestingModule({
        imports: [AblyModule],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const ablyService = moduleRef.get(AblyService)
      expect(ablyService).toBeDefined()
      expect(ablyService).toBeInstanceOf(AblyService)
      expect(Reflect.getMetadata('exports', AblyModule)).toContain(AblyService)
    })

    it('resolves AblyService in a consuming module when Socket.IO dispatcher is selected (default)', async () => {
      // AuthDomainModule imports AblyModule while app.module selects SocketIOModule.
      // A consuming service must still resolve AblyService for courier login.
      moduleRef = await Test.createTestingModule({
        imports: [TestAuthConsumerModule, selectWebsocketDispatcherModule(undefined)],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const authConsumer = moduleRef.get(TestAuthConsumerService)
      expect(authConsumer.ablyService).toBeDefined()
      expect(authConsumer.ablyService).toBeInstanceOf(AblyService)
    })

    it('resolves AblyService in a consuming module when Ably dispatcher is selected', async () => {
      // Consuming service must also resolve AblyService when WEBSOCKET_DISPATCHER=ably.
      moduleRef = await Test.createTestingModule({
        imports: [TestAuthConsumerModule, selectWebsocketDispatcherModule('ably')],
      })
        .overrideProvider('ablyClient')
        .useValue({ close: jest.fn() })
        .compile()

      const authConsumer = moduleRef.get(TestAuthConsumerService)
      expect(authConsumer.ablyService).toBeDefined()
      expect(authConsumer.ablyService).toBeInstanceOf(AblyService)
    })
  })
})
