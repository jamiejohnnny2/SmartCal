// In-memory "what should the top half of the kiosk display be showing" state,
// shared by the focus (voice) and gesture (touch/camera) routes. The screen
// is three pages: the month grid (always visible, not tracked here), the
// Detail page (today/week/agenda, picked via `detailMode`), and the Gallery
// page — `page` toggles which of those two occupies the top half.
export const DETAIL_MODES = ['today', 'week', 'agenda'];

let state = {
  page: 'detail', // 'detail' | 'gallery'
  detailMode: 'today',
  date: null,
  updatedAt: 0,
  transitionDir: null, // 'up' | 'down' | null — which way to animate a page change
};

export function getFocus() {
  return state;
}

export function setFocus(patch) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  return state;
}
