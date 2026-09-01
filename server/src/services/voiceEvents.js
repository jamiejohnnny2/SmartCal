// Maps linux-voice-assistant's peripheral-API event shape to what the kiosk
// UI listens for over wsHub. Shared by the real bridge (voiceBridge.js,
// fed by an actual LVA connection) and the /api/voice/simulate debug route,
// so a hand-built test event and a real one are guaranteed to produce the
// exact same broadcast shape.
const EVENT_MAP = {
  wake_word_detected: () => ({ type: 'voice-wake' }),
  listening: () => ({ type: 'voice-listening' }),
  stt_text: (data) => ({ type: 'voice-transcript', text: data?.text ?? '' }),
  thinking: () => ({ type: 'voice-thinking' }),
  tts_text: (data) => ({ type: 'voice-response', text: data?.text ?? '' }),
  tts_speaking: () => ({ type: 'voice-speaking' }),
  tts_finished: () => ({ type: 'voice-finished' }),
  idle: () => ({ type: 'voice-idle' }),
};

export const LVA_EVENT_NAMES = Object.keys(EVENT_MAP);

export function mapLvaEvent(event, data) {
  const mapper = EVENT_MAP[event];
  return mapper ? mapper(data) : null;
}
