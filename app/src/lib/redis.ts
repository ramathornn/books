import Redis from 'ioredis'

let redis: Redis | null = null

export function getRedis(): Redis | null {
  if (process.env.REDIS_URL) {
    if (!redis) {
      redis = new Redis(process.env.REDIS_URL)
    }
    return redis
  }
  return null
}
