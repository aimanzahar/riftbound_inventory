// Job registry. Modules are imported lazily so a missing/broken job file only fails when that job runs.
import type { JobFn } from './types.ts';
import type { JobName } from '../shared/constants.ts';

function lazy(loader: () => Promise<{ run: JobFn }>): JobFn {
  return async (ctx) => (await loader()).run(ctx);
}

export const JOBS: Record<JobName, JobFn> = {
  cards: lazy(() => import('./cards.ts')),
  products: lazy(() => import('./products.ts')),
  images: lazy(() => import('./images.ts')),
  fx: lazy(() => import('./fx.ts')),
  prices: lazy(() => import('./prices.ts')),
  meta: lazy(() => import('./meta.ts')),
  backup: lazy(() => import('./backup.ts')),
  tips: lazy(() => import('./tips.ts')),
};

/** Order used by `sync all` and the startup/scheduler tick. */
export const ALL_ORDER: JobName[] = ['cards', 'products', 'images', 'fx', 'prices', 'meta'];
export const SCHEDULE_ORDER: JobName[] = ['cards', 'images', 'fx', 'prices', 'meta', 'backup'];
