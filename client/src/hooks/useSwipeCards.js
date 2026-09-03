import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DRAG_ACTIVATE_PX = 10; // minimum movement before a drag commits to being a swipe on this axis
const COMMIT_THRESHOLD = 0.35; // fraction of the panel's size needed to complete the swipe
const MAX_SETTLE_MS = 320; // settle duration for a full-length transition; scaled down by remaining distance

// dir 'up'/'left' means the finger moved toward the negative end of the axis
// (up the screen, or left across it) — the outgoing card exits that way and
// the incoming one enters from the opposite (positive) side, sliding to 0.
function layerTransform(axis, dir, progress, which) {
  const prop = axis === 'y' ? 'translateY' : 'translateX';
  const fromSign = dir === 'up' || dir === 'left' ? -1 : 1;
  const value = which === 'from' ? fromSign * progress * 100 : fromSign * 100 * (progress - 1);
  return `${prop}(${value}%)`;
}

// A live-tracking "stack of cards on an axis" swipe engine: a drag tracks
// the pointer 1:1 (the incoming card follows the finger, no waiting for
// release), and lifting either completes the swipe or springs back
// depending on how far you dragged. `triggerTransition` plays the identical
// animation for a non-drag change (a tab tap, a voice command, a camera
// gesture).
//
// "What page/mode are we actually on" is tracked as a single value
// (currentRef) updated synchronously the instant a swipe commits — this is
// the one place that answers that question; `neighbor(dir, current)` is
// plain index-with-wraparound arithmetic over that value (see
// PageStage/DetailPage), never a second copy of it. `displayValue` (React
// state) exists only to drive the steady-state render and always catches up
// to currentRef once the settle animation finishes — reading `displayValue`
// instead of currentRef for an "are we already there" check is exactly the
// bug that made taps/swipes silently do nothing during a previous pass at
// this, so every internal decision here deliberately goes through
// currentRef, never displayValue.
//
// Uses Pointer Events + setPointerCapture rather than Touch Events — once
// captured, every subsequent pointermove/up for that pointer is delivered
// to this element regardless of what the browser's native scroll/pan
// gesture recognizer would otherwise try to do with it (touch-action: none
// on the container, still set, is belt-and-suspenders on top of that
// guarantee). This also unifies touch/mouse/pen into one code path. Capture
// is deliberately NOT claimed on pointerdown — see claimGesture(), called
// only once an axis actually decides — because DetailPage's horizontal
// swipe container is nested inside PageStage's vertical one, and capturing
// eagerly on every pointerdown regardless of axis is what let the outer one
// silently steal every gesture away from the inner one.
//
// Every deferred step below uses setTimeout, never requestAnimationFrame.
// rAF is throttled by the browser to match display refresh — which sounds
// harmless, but Chrome can throttle it to a near-standstill (confirmed:
// multi-second gaps) for a page that's visible but doesn't have OS focus, a
// real condition for a kiosk touchscreen window, not just an edge case. That
// showed up as a swipe correctly starting, then hanging for a noticeable
// stretch, then jumping/reverting well after the fact — exactly what a
// stalled rAF looks like from the outside. setTimeout keeps firing on a much
// shorter leash under the same condition.
//
// Shared by PageStage (vertical, Detail <-> Gallery) and DetailPage
// (horizontal, Today <-> Week <-> Agenda) so every swipeable surface in the
// app behaves the same way instead of each reimplementing its own feel.
export function useSwipeCards({ axis, value, onChange, neighbor }) {
  const [displayValue, setDisplayValue] = useState(value);
  const [preview, setPreview] = useState(null); // { dir, from, to } | null — mounted while dragging or settling

  const containerRef = useRef(null);
  const fromRef = useRef(null);
  const toRef = useRef(null);
  const drag = useRef(null); // live pointer state; see handlePointerDown
  const cleanupTimer = useRef(null);
  const settling = useRef(false); // true from settle() start until its cleanup runs
  const currentRef = useRef(value); // see file header — the single source of truth

  // Applies each new preview's starting position exactly once, right after
  // its layers mount — keyed on `preview`'s identity, not on every render.
  // A JSX inline style here would get re-applied by React on every
  // unrelated re-render (a clock tick, a data refresh, anything) while a
  // drag or settle was mid-flight, silently snapping the transform back to
  // its start — a swipe that stalls partway and needs a second attempt.
  //
  // Reads drag.current?.progress instead of assuming 0: fromRef/toRef don't
  // exist until this commits, so a fast burst of pointermove events can
  // easily advance d.progress well past its value at the moment setPreview
  // was called, *before* React gets around to mounting these layers at all.
  // Reading the live value here instead of a hardcoded 0 makes this effect
  // the single, deterministic place that sets the starting position.
  useLayoutEffect(() => {
    if (preview) setLayerProgress(preview.dir, drag.current?.progress ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  // Keeps displayValue (and currentRef) in sync with an externally-driven
  // `value` change that didn't go through triggerTransition (first mount,
  // or a caller that intentionally wants an instant cut). Never fires while
  // something is already animating.
  useEffect(() => {
    if (drag.current || settling.current || preview) return;
    currentRef.current = value;
    setDisplayValue((prev) => (prev === value ? prev : value));
  }, [value, preview]);

  useEffect(() => () => clearTimeout(cleanupTimer.current), []);

  function setLayerTransition(transition) {
    if (fromRef.current) fromRef.current.style.transition = transition;
    if (toRef.current) toRef.current.style.transition = transition;
  }

  function setLayerProgress(dir, progress) {
    if (fromRef.current) fromRef.current.style.transform = layerTransform(axis, dir, progress, 'from');
    if (toRef.current) toRef.current.style.transform = layerTransform(axis, dir, progress, 'to');
  }

  // Animates from wherever the layers currently sit (startProgress) to a
  // final progress of 1 (commit — finish changing cards) or 0 (cancel —
  // spring back), then settles React state once the transition completes.
  function settle(dir, from, to, startProgress, target) {
    clearTimeout(cleanupTimer.current);
    settling.current = true;
    const duration = Math.max(80, MAX_SETTLE_MS * Math.abs(target - startProgress));
    setLayerTransition(`transform ${duration}ms ease-out`);
    // Letting the transition property above actually apply before changing
    // the transform is what makes this animate instead of jumping — see the
    // file header for why this is a setTimeout and not a requestAnimationFrame.
    setTimeout(() => setLayerProgress(dir, target), 0);
    cleanupTimer.current = setTimeout(() => {
      setDisplayValue(target === 1 ? to : from);
      setPreview(null);
      settling.current = false;
      // fromRef's div is a persistent node (see PageStage/DetailPage's
      // render comment) — it's the same DOM element before, during, and
      // after this transition, so whatever transform this animation last
      // applied to it (up to fully off-screen, at target 1) stays on it
      // unless explicitly cleared here. Once collapsed back to steady
      // state, its content is just whichever page is current now, and it
      // needs to render in place, not wherever the outgoing card's exit
      // animation left it.
      if (fromRef.current) {
        fromRef.current.style.transition = 'none';
        fromRef.current.style.transform = 'none';
      }
    }, duration);
  }

  // Plays the same slide animation as a drag, but for a change that didn't
  // come from a pointer (a tab tap, a pushed voice/gesture command). Always
  // a commit (there's nothing to spring back from), so the logical value
  // updates immediately, same as a drag commit below.
  function triggerTransition(targetValue, dir) {
    if (drag.current || targetValue === currentRef.current) return;
    const from = currentRef.current;
    currentRef.current = targetValue;
    setLayerTransition('none');
    setPreview({ dir, from, to: targetValue });
    setTimeout(() => settle(dir, from, targetValue, 0, 1), 0);
  }

  // Direction is read fresh from the CURRENT signed offset from the origin
  // every move, not locked in once at decide time — a drag that overshoots
  // back through the origin and continues the other way flips to the other
  // neighbor, rather than continuing to animate the first-guessed direction
  // with a growing absolute-distance number. Returns whether it changed.
  function recomputeTarget(d, primary) {
    const dir = primary < 0 ? (axis === 'y' ? 'up' : 'left') : axis === 'y' ? 'down' : 'right';
    if (dir === d.dir) return false;
    d.dir = dir;
    d.to = neighbor(dir, d.from);
    return true;
  }

  function handlePointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Agenda's event list is packed edge-to-edge with buttons, so a swipe
    // starting there almost always lands its first touch directly on one.
    // A button taking focus on press is normal, but something in this
    // touchscreen setup reacts to that by yanking window focus away, and the
    // browser then cancels the in-flight gesture (pointercancel) — seen
    // directly in the debug HUD as phase jumping straight from "down" to
    // "settling" without ever reaching "dragging". Blurring immediately,
    // before whatever grabs focus gets a chance to, is a more direct fix
    // than trying to stop the button from taking focus in the first place
    // (which didn't hold up against real touch input) — it doesn't affect
    // tap-to-select, since a click doesn't depend on focus state.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    const rect = containerRef.current?.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      dir: null,
      to: null,
      decided: false,
      progress: 0,
      size: (axis === 'y' ? rect?.height : rect?.width) || 1,
    };
    // No setPointerCapture here — see the decide branch in handlePointerMove
    // for why capture is deliberately deferred until the axis is decided.
  }

  // Claims this gesture exclusively, once (and only once) this hook has
  // decided the drag is really its axis. DetailPage's horizontal swipe
  // container sits inside PageStage's vertical one, so every pointer event
  // that starts within DetailPage reaches BOTH of their handlers via
  // bubbling. If both captured on pointerdown (as this used to), the OUTER
  // one (PageStage) always wins — it's the later listener in the bubble
  // order for the *same* event — silently stealing the pointer away from
  // DetailPage before it even knows which axis this gesture is. Once that
  // happens, DetailPage never receives another move/up for that pointer (a
  // capturing element's descendants are cut out of its dispatch entirely),
  // so its drag state gets stuck open forever, waiting for a release that
  // will never arrive — every later swipe attempt on it is silently
  // swallowed until something else forces a remount. Deferring capture (and
  // pointer events) to the moment of actually deciding, plus stopping
  // propagation right then, means whichever axis recognizes the gesture
  // first claims it outright and the other one's ancestor/descendant never
  // gets a conflicting say.
  function claimGesture(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Second blur pass, on top of the one in handlePointerDown — see its
    // comment. Whatever grabs focus in reaction to a button being pressed
    // might not do so until slightly after pointerdown itself, so this
    // catches it at the moment we recognize a real drag (a few pixels of
    // movement) in case the first pass was too early to catch it.
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }

  function handlePointerMove(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    // touch-action: none on the container is a declarative hint the browser
    // is supposed to honor before a touch ever reaches JS — but "supposed
    // to" isn't "always does": real touch input has been reported to still
    // lose this gesture to the browser (a native scroll/pan attempt, or
    // some other gesture-recognizer takeover) in cases mouse input never
    // hits, since mouse drags never go through that recognizer at all.
    // preventDefault() here is the imperative, per-event version of the
    // same instruction, with no room for the browser to negotiate — called
    // on every move (not on pointerdown, deliberately, so a real tap can
    // still fire its click) because native gesture takeover has to be
    // headed off from the very first move, not once we've already decided
    // this is our drag; waiting even one event can be too late.
    if (e.cancelable) e.preventDefault();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const primary = axis === 'y' ? dy : dx;
    const cross = axis === 'y' ? dx : dy;

    if (!d.decided) {
      if (Math.abs(primary) < DRAG_ACTIVATE_PX || Math.abs(primary) < Math.abs(cross)) return;
      d.decided = true;
      claimGesture(e);
      // currentRef, not displayValue — displayValue can still be lagging
      // behind a prior swipe's commit while its settle animation finishes.
      // This stays fixed for the whole gesture; only dir/to (below) can
      // change as the finger moves back and forth across the origin.
      d.from = currentRef.current;
      recomputeTarget(d, primary);
      // Record this move's own progress now — a fast, decisive swipe often
      // only produces one move event before release, and without this the
      // commit/cancel decision would always see progress stuck at 0.
      d.progress = Math.min(1, Math.abs(primary) / d.size);
      clearTimeout(cleanupTimer.current);
      setLayerTransition('none');
      // The layers haven't mounted yet this tick — the useLayoutEffect above
      // applies d.progress to them the instant they do, so there's nothing
      // further to do here.
      setPreview({ dir: d.dir, from: d.from, to: d.to });
      return;
    }

    // Already decided (and already captured/claimed above on the event that
    // decided it) — still stop propagation on every subsequent event of
    // this gesture. Capture retargets dispatch to this element, but the
    // ancestor chain from here up is unaffected by that, so without this an
    // ancestor's own handler for the same event type keeps right on
    // receiving these too.
    e.stopPropagation();
    const flipped = recomputeTarget(d, primary);
    d.progress = Math.min(1, Math.abs(primary) / d.size);
    if (flipped) {
      // Swapped which neighbor is being revealed — remount so the new pair
      // starts from d.progress, not 0 (see the useLayoutEffect above), so
      // there's no visible jump back to the origin before continuing.
      setLayerTransition('none');
      setPreview({ dir: d.dir, from: d.from, to: d.to });
    } else {
      setLayerProgress(d.dir, d.progress);
    }
  }

  function handlePointerEnd(e) {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // already released, or never captured because this gesture never
      // decided — nothing to do either way
    }
    if (!d.decided) return;
    e.stopPropagation();

    const { from, to } = d;
    const outcome = d.progress >= COMMIT_THRESHOLD ? 'COMMIT' : 'CANCEL';
    // Deferred one tick, same as triggerTransition — if release lands in the
    // same tick as decide (only reachable synthetically, not by an actual
    // finger, but cheap to close off properly), settle() running immediately
    // isn't enough on its own: it would run, and its "settling" flag would
    // already read true, before React has ever mounted this gesture's
    // preview layers or run the layout effect that positions them. Waiting
    // here first guarantees that mount/position-once happens before settle
    // touches anything, exactly like it does for every non-drag transition.
    if (outcome === 'COMMIT') {
      currentRef.current = to;
      onChange(to);
      setTimeout(() => settle(d.dir, from, to, d.progress, 1), 0);
    } else {
      setTimeout(() => settle(d.dir, from, to, d.progress, 0), 0);
    }
  }

  return {
    containerRef,
    fromRef,
    toRef,
    displayValue,
    preview,
    // The single source of truth for "what are we logically on right now" —
    // every internal check above uses this, never `displayValue`. Any
    // caller that needs to ask the same question (e.g. "is this button
    // already the active one") has to read from here too — displayValue
    // only catches up once a settle animation's timer fires, up to
    // MAX_SETTLE_MS later, so a check against it can disagree with what
    // this hook itself will decide a moment later.
    getCurrent: () => currentRef.current,
    triggerTransition,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerEnd,
      onPointerCancel: handlePointerEnd,
    },
  };
}
