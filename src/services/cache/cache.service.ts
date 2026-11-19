import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis/models/RedisClient'

@Injectable()
export class CacheService {
  constructor(private readonly redisClient: RedisClient) {}

  public async save<T>(key: string, value: T, ttlSeconds: number) {
    await this.redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds)
  }

  public async delete(key: string) {
    await this.redisClient.del(key)
  }

  public async get<T>(key: string): Promise<T | null> {
    const value = await this.redisClient.get(key)
    return value === null ? null : JSON.parse(value) // might throw an exception if not valid JSON
  }

  // The three below are each one atomic Redis command, so two requests at the same moment can never
  // both pass the guard they implement (row 17, spec 0039: password reset codes).

  // Adds 1 and returns the new count. The expiry is set only when the count is created (it was 1),
  // so the window runs from the first increment, not the latest.
  public async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redisClient.incr(key)
    if (count === 1) {
      await this.redisClient.expire(key, ttlSeconds)
    }
    return count
  }

  // Reads the value and deletes it in one step (GETDEL): of two callers at once, only one gets it.
  public async take<T>(key: string): Promise<T | null> {
    const value = await this.redisClient.getdel(key)
    return value === null ? null : JSON.parse(value)
  }

  // Saves only if the key does not exist yet (SET NX EX). True when this call saved it.
  public async setIfAbsent<T>(key: string, value: T, ttlSeconds: number): Promise<boolean> {
    const result = await this.redisClient.set(key, JSON.stringify(value), 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  public async getOrDefault<T>(key: string, defValue: T): Promise<T> {
    const value = await this.redisClient.get(key)
    return value === null ? defValue : JSON.parse(value) // might throw an exception if not valid JSON
  }
}
