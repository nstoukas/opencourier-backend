import { describeErrorForLog, errorForConsole } from './utils/errorForLog'
import { NestFactory } from '@nestjs/core'
import { WinstonModule } from 'nest-winston'
import { getLogger } from './services/logger'
import { ChainWatcherAppModule } from './app.chain-watcher.module'

const { PORT = 3088 } = process.env

async function main() {
  console.log('Starting chain watcher.') // Logs to console to diagnose startup and not logger failures
  const logger = getLogger('Nest')

  logger.info('Initialized logger.')

  const app = await NestFactory.create(ChainWatcherAppModule, {
    logger: WinstonModule.createLogger({
      instance: logger,
    }),
  })

  void app.listen(PORT)
  logger.info(`Started server on port ${PORT}`)

  return app
}

const panicLogger = getLogger('Panic')
process
  // Row 139, as main.ts does since row 132: a crash is logged by its name, code and frames, never the whole
  // error or the rejected promise.
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

module.exports = main().catch((error) => console.error(`The chain watcher did not start: ${errorForConsole(error)}`))
