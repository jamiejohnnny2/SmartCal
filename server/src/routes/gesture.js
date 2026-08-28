import { Router } from 'express';
import { DETAIL_MODES, getFocus, setFocus } from '../store/focusState.js';

const router = Router();

// Up/down toggles between the Detail page and the Gallery page (works from
// either page, direction only affects which way the incoming page slides
// in). Left/right cycles Today → Week → Agenda within the Detail page and is
// a no-op while Gallery is showing — same semantics for a touch swipe and
// the camera gesture detector (pi-setup/gesture-presence.py).
router.post('/', (req, res) => {
  const { direction } = req.body ?? {};
  if (!['left', 'right', 'up', 'down'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be one of: left, right, up, down' });
  }

  const current = getFocus();

  if (direction === 'up' || direction === 'down') {
    const nextPage = current.page === 'gallery' ? 'detail' : 'gallery';
    return res.json(setFocus({ page: nextPage, transitionDir: direction }));
  }

  if (current.page !== 'detail') return res.json(current);

  const idx = DETAIL_MODES.indexOf(current.detailMode);
  const step = direction === 'left' ? 1 : -1;
  const nextMode = DETAIL_MODES[(idx + step + DETAIL_MODES.length) % DETAIL_MODES.length];
  res.json(setFocus({ detailMode: nextMode }));
});

export default router;
