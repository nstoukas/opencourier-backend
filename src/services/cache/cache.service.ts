import { Injectable } from '@nestjs/common'
import { RedisClient } from '../redis/models/RedisClient'

// KEYS[1] is the counter, ARGV[1] its lifetime in seconds. TTL answers -1 for a key with no expiry.
const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count`

// Row 148: a sorted set where each member's score is the time (ms) it stops counting. KEYS[1] is the set,
// ARGV[1] the member, ARGV[2] now and ARGV[3] the member's end, both in ms. It drops members already
// past their end, gives this member the later of its old and new end, then sets the key's own expiry
// to its last member's end, so Redis deletes the set once nobody in it counts any more. Returns 1 when
// the member was not counting before this call, 0 when it already was.
const ADD_WITH_OWN_EXPIRY = `
local now = tonumber(ARGV[2])
local ends = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
local before = redis.call('ZSCORE', KEYS[1], ARGV[1])
-- GT keeps the later end for a member already there, and still adds a new member.
redis.call('ZADD', KEYS[1], 'GT', ends, ARGV[1])
local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[1], math.max(1, tonumber(last[2]) - now))
if before == false then return 1 end
return 0`

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

  // The three below each run as one step in Redis, so two requests at the same moment can never both
  // pass the guard they implement (row 17, spec 0039: password reset codes).

  // Adds 1 and returns the new count. The expiry is set when the count has none (it was just
  // created), so the window runs from the first increment, not the latest. A Lua script runs in Redis
  // as one step: no crash or other request can land between the INCR and the EXPIRE, and a counter
  // that somehow lost its expiry gets one back instead of counting up forever.
  public async increment(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.redisClient.eval(INCREMENT_WITH_EXPIRY, 1, key, ttlSeconds)
    return Number(count)
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

  // Row 148: sets whose members each count for their own time (a delivery's skip list). Adds the member
  // until `endsAtMs`, or keeps its later end if it already counts. True when this call is what made
  // it count; false when it already did.
  public async addWithOwnExpiry(key: string, member: string, nowMs: number, endsAtMs: number): Promise<boolean> {
    const added = await this.redisClient.eval(ADD_WITH_OWN_EXPIRY, 1, key, member, nowMs, endsAtMs)
    return Number(added) === 1
  }

  // The members whose end is still ahead of `nowMs`. An empty array when the key is missing.
  public async membersStillCounting(key: string, nowMs: number): Promise<string[]> {
    // '(' makes the bound exclusive: a member whose end is exactly now no longer counts.
    return this.redisClient.zrangebyscore(key, `(${nowMs}`, '+inf')
  }

  // Takes one member out and leaves the rest with their own ends. Redis deletes a set left empty.
  public async removeMember(key: string, member: string): Promise<void> {
    await this.redisClient.zrem(key, member)
  }
}
