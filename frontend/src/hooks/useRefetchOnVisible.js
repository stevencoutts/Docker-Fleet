import { useEffect, useRef } from 'react';

/**
 * Calls refetch when the page/tab becomes visible (user returns to the tab).
 * Use so displayed data is the latest available when the user views the page.
 */
export function useRefetchOnVisible(refetch) {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && typeof refetchRef.current === 'function') {
        refetchRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
}
