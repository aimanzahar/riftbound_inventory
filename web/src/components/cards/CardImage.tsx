import type { Card } from '../../../../shared/types.ts';
import { cx } from '../../lib/format.ts';
import { useCardImage, type ImageKind } from '../../lib/images.ts';
import { domainColor } from './DomainPips.tsx';

export interface CardImageProps {
  card: Pick<Card, 'id' | 'name' | 'image_url' | 'domains' | 'orientation'>;
  kind?: ImageKind;
  className?: string;
  imgClassName?: string;
  /** fetchpriority / eager for the drawer */
  eager?: boolean;
  /** rounded corners radius class */
  rounded?: string;
  /** called when the image finished loading */
  onLoaded?: () => void;
}

/**
 * Lazy card image with the fallback chain (local thumb → local full → Riot CDN → placeholder).
 * Keeps a 5:7 box; landscape battlefields are letter-boxed inside it.
 */
export function CardImage({ card, kind = 'thumb', className, imgClassName, eager, rounded = 'rounded-lg', onLoaded }: CardImageProps) {
  const { src, status, onLoad, onError } = useCardImage(card, kind);
  const landscape = card.orientation === 'landscape';
  return (
    <div className={cx('relative aspect-[5/7] w-full overflow-hidden bg-surface-2', rounded, className)}>
      {status !== 'loaded' && status !== 'failed' && <div className="skeleton absolute inset-0" aria-hidden />}
      {src && status !== 'failed' && (
        <img
          src={src}
          alt={card.name}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={eager ? 'high' : 'auto'}
          draggable={false}
          onLoad={() => {
            onLoad();
            onLoaded?.();
          }}
          onError={onError}
          className={cx('tile-img absolute inset-0 h-full w-full transition-opacity duration-200', landscape ? 'object-contain' : 'object-cover', status === 'loaded' ? 'opacity-100' : 'opacity-0', imgClassName)}
        />
      )}
      {status === 'failed' && <Placeholder card={card} />}
    </div>
  );
}

/** Domain-tinted placeholder with the card's initial — shown only when every source failed. */
export function Placeholder({ card, className }: { card: Pick<Card, 'name' | 'domains'>; className?: string }) {
  const c1 = domainColor(card.domains[0] ?? 'colorless');
  const c2 = domainColor(card.domains[1] ?? card.domains[0] ?? 'colorless');
  const initial = card.name.trim().charAt(0).toUpperCase() || '?';
  return (
    <div
      aria-hidden
      className={cx('absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center', className)}
      style={{ background: `linear-gradient(160deg, color-mix(in oklab, ${c1} 35%, var(--color-surface-2)), color-mix(in oklab, ${c2} 18%, var(--color-bg)))` }}
    >
      <span className="text-3xl font-bold tracking-tight text-fg/70">{initial}</span>
      <span className="line-clamp-2 text-[10px] leading-tight text-fg/50">{card.name}</span>
    </div>
  );
}
