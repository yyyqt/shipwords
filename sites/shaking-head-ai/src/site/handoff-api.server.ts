import { env } from 'cloudflare:workers';
import { clientIp, ipBucket } from '@shipwords/core/http';
import { consumeQuota } from '@shipwords/core/quota/counters';
import { core } from '~/core.server';
import { phoneHandoffHandlers } from './handoff.server';

export const handoffApi = phoneHandoffHandlers({
  bucket: () => (env as unknown as { OUTPUTS: R2Bucket }).OUTPUTS,
  allowCreate(request) {
    const ip = clientIp(request.headers);
    return consumeQuota(core.db, [
      {
        key: `phone-handoff:${ip ? ipBucket(ip) : 'local'}`,
        window: String(Math.floor(Date.now() / 3_600_000)),
        limit: 30,
      },
    ]);
  },
});
