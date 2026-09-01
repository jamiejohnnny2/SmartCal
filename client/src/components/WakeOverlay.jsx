import { useEffect, useRef, useState } from 'react';

const FADE_MS = 350; // overlay mount/unmount fade
const RING_MS = 900; // one-shot wake ping — runs to completion on its own clock
const ENERGY_TAU_S = 0.6; // how quickly the pulse eases toward a new target on a phase change

// How much the orb grows on top of its base size, per phase — small for
// "calm" phases (a subtle breathing presence), larger for speaking. These
// are targets that get eased toward, not snapped to (see the animation loop
// below), which is what makes phase changes feel like one continuous motion
// instead of a cut from one animation to another.
const TARGET_ENERGY = {
  wake: 0.05,
  listening: 0.05,
  thinking: 0.08,
  speaking: 0.2,
};

// A Siri-style overlay driven by linux-voice-assistant's full conversation
// lifecycle (see server/src/services/voiceEvents.js): a single ping when the
// wake word fires, then a pulse that smoothly ramps its intensity up while
// Cal is actually speaking and back down otherwise — one continuous
// animation loop for the whole time this is on screen, not a series of
// separate animations swapped in and out, which is what reads as cuts.
//
// LVA's peripheral API doesn't expose real audio amplitude/waveform data
// (checked — it only has a `tts_speaking` boundary event, not levels), so
// the pulse is a simulated, organic-feeling wobble (layered sine waves),
// not a literal waveform. True waveform-reactivity would need to capture
// the Pi's actual audio output separately — a bigger, separate piece of
// plumbing than what LVA hands us for free.
export default function WakeOverlay({ visible, phase, pingId, transcript, response, onDismiss }) {
  const [mounted, setMounted] = useState(visible);
  const [entered, setEntered] = useState(false);
  const [ring, setRing] = useState(null); // { key } | null

  const orbRef = useRef(null);
  const energyRef = useRef(0);
  const phaseRef = useRef(phase);
  const lastRingId = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Mount immediately when shown; on hide, fade out first, then unmount —
  // without this the overlay was just there one frame and gone the next.
  // Uses a short setTimeout (not requestAnimationFrame) to let the initial
  // opacity:0 style actually paint before switching to opacity:1, so the CSS
  // transition animates instead of jumping — rAF would do the same job, but
  // browsers are free to suspend it entirely while a tab isn't compositing
  // (backgrounded, occluded, etc.), which would leave the overlay stuck
  // invisible. A timer keeps firing regardless.
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const t = setTimeout(() => setEntered(true), 20);
      return () => clearTimeout(t);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [visible]);

  // The wake ping is its own short-lived animation, timed independently of
  // the phase state machine — it always gets to finish gracefully, instead
  // of being yanked out mid-animation the instant `listening` arrives
  // (which in a real conversation can be well under a second later).
  useEffect(() => {
    if (phase !== 'wake' || pingId === lastRingId.current) return;
    lastRingId.current = pingId;
    setRing({ key: pingId });
    const t = setTimeout(() => setRing(null), RING_MS);
    return () => clearTimeout(t);
  }, [phase, pingId]);

  // One continuous loop for as long as the overlay is mounted. Each frame
  // eases `energyRef` toward the current phase's target (see ENERGY_TAU_S)
  // rather than jumping to it, so a phase change ramps the pulse up or down
  // smoothly instead of visibly switching animations.
  useEffect(() => {
    if (!mounted) return;
    let raf;
    let last = performance.now();
    let t = 0;
    function tick(now) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;

      const target = TARGET_ENERGY[phaseRef.current] ?? 0.05;
      energyRef.current += (target - energyRef.current) * (1 - Math.exp(-dt / ENERGY_TAU_S));

      const wobble = Math.sin(t * 1.8) * 0.6 + Math.sin(t * 4.4) * 0.3 + Math.sin(t * 0.7) * 0.1;
      const scale = 1 + energyRef.current * Math.max(0, wobble);
      if (orbRef.current) orbRef.current.style.transform = `scale(${scale})`;

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mounted]);

  if (!mounted) return null;

  const label = response || transcript;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-black/60 backdrop-blur-sm transition-opacity ease-out"
      style={{ opacity: entered ? 1 : 0, transitionDuration: `${FADE_MS}ms` }}
      onClick={onDismiss}
    >
      <style>{`
        @keyframes wake-ping-ring {
          0% { transform: scale(0.6); opacity: 0.6; }
          100% { transform: scale(2.4); opacity: 0; }
        }
      `}</style>

      <div className="relative flex h-40 w-40 items-center justify-center">
        {ring && (
          <span
            key={ring.key}
            className="absolute inset-0 rounded-full bg-accent/50"
            style={{ animation: `wake-ping-ring ${RING_MS}ms ease-out forwards` }}
          />
        )}
        <span
          ref={orbRef}
          className="relative h-16 w-16 rounded-full bg-accent shadow-[0_0_60px_20px_rgba(216,161,92,0.5)]"
        />
      </div>

      {label && (
        <p className="max-w-md px-6 text-center font-serif text-2xl text-ink transition-opacity duration-300">
          {label}
        </p>
      )}
    </div>
  );
}
