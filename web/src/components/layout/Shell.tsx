import { useEffect, type ReactNode } from 'react';
import { useRoute, closeCard } from '../../lib/router.ts';
import { useIsDesktop } from '../../lib/useMediaQuery.ts';
import { useVisibleIds } from '../../store/selectors.ts';
import { NavRail, BottomTabs } from './NavTabs.tsx';
import { TopBar } from './TopBar.tsx';
import { CardDrawer } from '../cards/CardDrawer.tsx';

/**
 * ≥1024 px: nav rail + content + inline 420 px drawer.
 * 640–1023: top tabs; drawer overlays from the right.
 * <640: bottom tab bar; drawer is a full-height sheet.
 */
export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const desktop = useIsDesktop();
  const visibleIds = useVisibleIds();
  const cardId = route.cardId;

  // lock body scroll behind the mobile overlay
  useEffect(() => {
    if (desktop || !cardId) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [desktop, cardId]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <NavRail className="hidden lg:flex" />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="relative flex min-h-0 flex-1 flex-col">{children}</main>
        <BottomTabs className="sm:hidden" />
      </div>

      {cardId && desktop && (
        <aside className="drawer-enter flex w-[420px] shrink-0 flex-col border-l border-border bg-surface" aria-label="Card details">
          <CardDrawer cardId={cardId} visibleIds={visibleIds} />
        </aside>
      )}

      {cardId && !desktop && (
        <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Card details">
          <button type="button" aria-label="Close details" onClick={closeCard} className="absolute inset-0 bg-black/55 backdrop-blur-[1px]" />
          <div className="drawer-enter relative flex h-full w-full flex-col bg-surface shadow-pop sm:w-[440px] sm:border-l sm:border-border">
            <CardDrawer cardId={cardId} visibleIds={visibleIds} overlay />
          </div>
        </div>
      )}
    </div>
  );
}
