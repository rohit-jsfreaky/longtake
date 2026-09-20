/**
 * Captures mic audio and posts it back as PCM16 at 24 kHz, the rate the Voice Agent API wants.
 *
 * We resample inside the worklet instead of forcing `new AudioContext({ sampleRate: 24000 })`,
 * because that shortcut is Chromium-only:
 *   - Firefox honours the rate but then routes the context around its echo canceller, so the
 *     agent hears its own voice and interrupts itself.
 *   - Safari ignores the option entirely and runs at 48 kHz, which sounds chipmunked.
 * Letting the context keep the device rate and resampling here works on all three.
 *
 * Source: https://www.assemblyai.com/docs/voice-agents/voice-agent-api/browser-integration
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { inputSampleRate, targetSampleRate } = options.processorOptions;
    this.ratio = inputSampleRate / targetSampleRate;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;

    const outLength = Math.floor(input.length / this.ratio);
    const pcm16 = new Int16Array(outLength);
    for (let i = 0; i < outLength; i++) {
      const sample = input[Math.floor(i * this.ratio)] ?? 0;
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    }

    this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
    return true;
  }
}

registerProcessor("pcm-processor", PCMProcessor);
