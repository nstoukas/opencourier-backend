import './telemetry'
import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common'
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core'
import { WinstonModule } from 'nest-winston'
import * as Sentry from '@sentry/node'
import { HttpExceptionFilter } from './filters/HttpExceptions.filter'
import { AppModule } from './app.module'
import { setupLegacyDocs, setupCourierDocs, setupAdminDocs, setupPartnerDocs } from './swagger'
import { getLogger } from './services/logger'
import { NestExpressApplication } from '@nestjs/platform-express'
import { SentryInterceptor } from './integrations/sentry/sentry.interceptor'
import rawBodyMiddleware from './middleware/RawBodyMiddleware'
import { ErrorLoggingInterceptor } from './middleware/ErrorLoggingInterceptor'
import { SocketIOAdapter } from './services/socketio/socketio.adapter'
import { ConfigService } from '@nestjs/config'
import { describeErrorForLog, errorForConsole } from './utils/errorForLog'

const { PORT = 4000 } = process.env

async function main() {
  const logger = getLogger('Nest')
  logger.info('Starting.') // Logs to console to diagnose startup and not logger failures

  logger.info('Initialized logger.')

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    cors: true,
    logger: WinstonModule.createLogger({
      instance: logger,
    }),
  })

  // Sentry
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.OPENCOURIER_ENV || 'local',
      debug: process.env.NODE_ENV === 'development',
    })
    logger.info('Sentry DSN provided. Sentry initialized.')
  } else {
    logger.info('Sentry DSN not provided, no initializing.')
  }

  app.useGlobalInterceptors(new ErrorLoggingInterceptor())
  // `request: false`: an error report carries the exception and its stack, never the request (body,
  // query string, cookies, headers). Customers' names, phones and addresses travel in request bodies
  // and searches, and an error tracker is a log kept by a third party (spec 0005, AC-9).
  app.useGlobalInterceptors(new SentryInterceptor({ request: false }))
  app.use(rawBodyMiddleware())

  if (process.env.WEBSOCKET_DISPATCHER !== 'ably') {
    app.useWebSocketAdapter(new SocketIOAdapter(app, app.get(ConfigService)))
  }

  // This somehow breaks the Middleware
  //app.setGlobalPrefix('v1', { exclude: ['v0(.*)', '(.*)/v1/(.*)'] })

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    })
  )

  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)))

  if (process.env.NODE_ENV !== 'production') {
    setupLegacyDocs(app)
    setupAdminDocs(app)
    setupCourierDocs(app)
    setupPartnerDocs(app)
  }

  const { httpAdapter } = app.get(HttpAdapterHost)
  app.useGlobalFilters(new HttpExceptionFilter(httpAdapter))

  await app.listen(PORT)
  logger.info(`Started server on port ${PORT}`)

  return app
}

const panicLogger = getLogger('Panic')
// Row 132: a crash is logged by its name, code and frames (describeErrorForLog), never the whole error or
// the rejected promise, which prints the error whole, data from a Prisma call included.
process
  .on('unhandledRejection', (reason) => {
    console.error(`Unhandled Rejection at Promise: ${errorForConsole(reason)}`)
    const { summary, stack } = describeErrorForLog(reason)
    panicLogger.error(`Unhandled Rejection at Promise: ${summary}`, { stack })
  })
  .on('uncaughtException', (err) => {
    console.error(`Uncaught Exception thrown: ${errorForConsole(err)}`)
    const { summary, stack } = describeErrorForLog(err)
    panicLogger.error(`Uncaught Exception thrown: ${summary}`, { stack })
    process.exit(1)
  })

module.exports = main().catch((error) => console.error(`The server did not start: ${errorForConsole(error)}`))
