import { Router } from 'express';
import { DETAIL_MODES, getFocus, setFocus } from '../store/focusState.js';

const router = Router();
const VALID_VIEWS = new Set(DETAIL_MODES);

router.get('/', (req, res) => {
  res.json(getFocus());
});

// Voice always targets the Detail page (there's no spoken command for
// Gallery yet), so this also brings the display back from Gallery if it was
// showing photos.
router.post('/', (req, res) => {
  const { view, date } = req.body ?? {};
  if (!VALID_VIEWS.has(view)) {
    return res.status(400).json({ error: `view must be one of: ${[...VALID_VIEWS].join(', ')}` });
  }
  if (date !== undefined && date !== null && Number.isNaN(Date.parse(date))) {
    return res.status(400).json({ error: 'date must be a valid ISO date string' });
  }

  res.json(setFocus({ page: 'detail', detailMode: view, date: date ?? null, transitionDir: 'up' }));
});

export default router;
