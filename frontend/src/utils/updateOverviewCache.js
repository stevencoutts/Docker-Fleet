/**
 * Shared cache for the Dashboard "image updates" overview.
 * Persisted in localStorage so we can update it after running an update from Dashboard or ContainerDetails.
 */

export const UPDATE_OVERVIEW_STORAGE_KEY = 'dockerfleet.imageUpdateOverview';

export function getUpdateOverviewFromStorage() {
  try {
    const raw = localStorage.getItem(UPDATE_OVERVIEW_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved && typeof saved.ranOnce === 'boolean' && Array.isArray(saved.containers)) {
      return {
        ranOnce: saved.ranOnce,
        containers: saved.containers || [],
        totalChecked: saved.totalChecked ?? 0,
        errors: Array.isArray(saved.errors) ? saved.errors : [],
        lastCheckedAt: saved.lastCheckedAt || null,
      };
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Remove a container from the cached update overview (e.g. after a successful update).
 * Call from Dashboard or ContainerDetails after pull-and-update or recreate succeeds.
 */
export function removeContainerFromUpdateOverview(serverId, containerId) {
  try {
    const current = getUpdateOverviewFromStorage();
    if (!current || !Array.isArray(current.containers)) return;
    const next = {
      ...current,
      containers: current.containers.filter(
        (c) => !(String(c.serverId) === String(serverId) && String(c.containerId) === String(containerId))
      ),
    };
    localStorage.setItem(UPDATE_OVERVIEW_STORAGE_KEY, JSON.stringify(next));
  } catch (e) { /* ignore */ }
}
