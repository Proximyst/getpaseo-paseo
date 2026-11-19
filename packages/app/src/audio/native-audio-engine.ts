import { AttemptCancelledError, AttemptGuard } from "@/utils/attempt-guard";
import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioEngineOptions,
  AudioPlaybackSource,
} from "./audio-engine-types";

import { AudioCaptureStartError } from "./audio-engine-types";
import { createNativeEngineLease, type NativeEngineLease } from "./native-engine-lease";
import { createPlaybackQueue } from "./playback";
import { parsePcmSampleRate, playPcm16 } from "./pcm";

interface NativeSubscription {
  remove(): void;
}

interface MicrophonePermission {
  granted: boolean;
}

/** The surface of `@getpaseo/expo-two-way-audio` the engine drives. */
export interface TwoWayAudioModule {
  initialize(): Promise<boolean>;
  tearDown(): void;
  toggleRecording(value: boolean): boolean;
  startDictation(): boolean;
  releaseAudioSession(): void;
  playPCMData(data: Uint8Array): void;
  getMicrophonePermissionsAsync(): Promise<MicrophonePermission>;
  requestMicrophonePermissionsAsync(): Promise<MicrophonePermission>;
  addExpoTwoWayAudioEventListener(
    event: "onMicrophoneData",
    listener: (event: { data: Uint8Array }) => void,
  ): NativeSubscription;
  addExpoTwoWayAudioEventListener(
    event: "onInputVolumeLevelData",
    listener: (event: { data: number }) => void,
  ): NativeSubscription;
  addExpoTwoWayAudioEventListener(
    event: "onAudioInterruption",
    listener: (event: { data: string }) => void,
  ): NativeSubscription;
}

export interface NativeAudioEngineDeps {
  native: TwoWayAudioModule & Parameters<typeof playPcm16>[3];
  microphonePolicy: {
    isMicrophoneEnabled(): boolean;
    requireMicrophoneEnabled(): Promise<void>;
    subscribeMicrophoneDisabled(listener: () => void): () => void;
  };
  /** Plays encoded audio (wav, mp3, ...) through the platform player. */
  playEncodedAudio(
    bytes: Uint8Array,
    mimeType: string,
    signal: AbortSignal,
    context: { isCaptureActive(): boolean },
  ): Promise<number>;
}

// Voice mode and dictation each create an engine, but the native module holds a single engine
// per app. Every JS engine on the same module shares one lease, so one engine's teardown
// cannot free the native engine another still uses (#4147).
const leases = new WeakMap<TwoWayAudioModule, NativeEngineLease>();

function leaseFor(native: TwoWayAudioModule): NativeEngineLease {
  let lease = leases.get(native);
  if (!lease) {
    lease = createNativeEngineLease(native);
    leases.set(native, lease);
  }
  return lease;
}

function pcm16ToWav(bytes: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + bytes.byteLength);
  const header = new DataView(wav.buffer);
  header.setUint32(0, 0x52494646); // RIFF
  header.setUint32(4, 36 + bytes.byteLength, true);
  header.setUint32(8, 0x57415645); // WAVE
  header.setUint32(12, 0x666d7420); // fmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  header.setUint32(36, 0x64617461); // data
  header.setUint32(40, bytes.byteLength, true);
  wav.set(bytes, 44);
  return wav;
}

export function createNativeAudioEngine(
  deps: NativeAudioEngineDeps,
  callbacks: AudioEngineCallbacks,
  options?: AudioEngineOptions,
): AudioEngine {
  const {
    native,
    microphonePolicy: {
      isMicrophoneEnabled,
      requireMicrophoneEnabled,
      subscribeMicrophoneDisabled,
    },
  } = deps;
  const lease = leaseFor(native);
  const captureAttempt = new AttemptGuard();

  const refs: {
    initialized: boolean;
    captureActive: boolean;
    muted: boolean;
    destroyed: boolean;
  } = {
    initialized: false,
    captureActive: false,
    muted: false,
    destroyed: false,
  };

  const microphoneSubscription = native.addExpoTwoWayAudioEventListener(
    "onMicrophoneData",
    (event: { data: Uint8Array }) => {
      if (!refs.captureActive || refs.muted || !isMicrophoneEnabled()) {
        return;
      }
      const pcm = event.data;
      callbacks.onCaptureData(pcm);
    },
  );
  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      if (!refs.captureActive || !isMicrophoneEnabled()) {
        return;
      }
      const level = refs.muted ? 0 : event.data;
      callbacks.onVolumeLevel(level);
    },
  );
  const interruptionSubscription = native.addExpoTwoWayAudioEventListener(
    "onAudioInterruption",
    (event: { data: string }) => {
      if (refs.destroyed || !isMicrophoneEnabled()) {
        return;
      }
      if (event.data === "capture_paused" || event.data === "capture_resumed") {
        if (refs.captureActive) {
          callbacks.onCaptureAvailabilityChange?.(event.data === "capture_resumed");
        }
        return;
      }
      if (event.data !== "blocked") {
        return;
      }
      const wasCaptureActive = refs.captureActive;
      captureAttempt.cancel();
      refs.captureActive = false;
      refs.muted = false;
      callbacks.onVolumeLevel(0);
      if (wasCaptureActive) {
        callbacks.onInterruption?.();
      }
    },
  );

  function assertCanCapture(attemptId: number): void {
    captureAttempt.assertCurrent(attemptId);
    if (refs.destroyed || !isMicrophoneEnabled()) {
      throw new AttemptCancelledError();
    }
  }

  let initializing: Promise<void> | null = null;
  async function ensureInitialized(attemptId: number): Promise<void> {
    if (initializing) {
      await initializing.catch(() => undefined);
    }
    assertCanCapture(attemptId);
    if (refs.initialized) {
      return;
    }
    const pending = (async () => {
      await lease.acquire();
      try {
        assertCanCapture(attemptId);
      } catch (error) {
        // A disable, stop, or destroy may have arrived while the lease was
        // acquiring. Drop only this engine's holder once acquisition settles.
        releaseNativeEngine();
        throw error;
      }
      refs.initialized = true;
    })();
    initializing = pending;
    try {
      await pending;
    } finally {
      initializing = null;
    }
  }

  /**
   * Release the OS audio session as soon as we are neither capturing nor playing.
   * Holding it keeps the user's background music paused — on iOS the non-mixing
   * `.playAndRecord` category survives backgrounding and is re-asserted on every
   * foreground, so an unreleased session means their music never comes back.
   */
  function releaseSessionIfIdle(): void {
    if (!refs.initialized || refs.destroyed) {
      return;
    }
    if (refs.captureActive || playback.isPlaying()) {
      return;
    }
    // The wrapper no-ops on binaries whose native module predates this function.
    native.releaseAudioSession();
  }

  async function ensureMicrophonePermission(attemptId: number): Promise<void> {
    let permission = await native.getMicrophonePermissionsAsync().catch(() => null);
    assertCanCapture(attemptId);
    if (permission?.granted) return;

    let cause: unknown;
    try {
      permission = await native.requestMicrophonePermissionsAsync();
    } catch (error) {
      cause = error;
    }
    assertCanCapture(attemptId);
    if (permission?.granted) return;
    throw new AudioCaptureStartError(
      "permissionDenied",
      "Allow microphone access in system settings and try again.",
      { cause },
    );
  }

  function releaseNativeEngine(): void {
    try {
      // Native keeps the session active while any wrapper is capturing or playing.
      native.releaseAudioSession();
    } finally {
      lease.release();
    }
  }

  async function playAudio(audio: AudioPlaybackSource, signal: AbortSignal): Promise<number> {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (signal.aborted) throw new Error("Playback stopped");
    const isPcm = audio.type.startsWith("audio/pcm");
    if (isPcm && refs.captureActive && isMicrophoneEnabled()) {
      return playPcm16(bytes, audio.type, signal, native);
    }
    // The two-way engine opens input even for PCM playback. Only use it
    // during an allowed capture; otherwise play through the output-only player.
    return deps.playEncodedAudio(
      isPcm ? pcm16ToWav(bytes, parsePcmSampleRate(audio.type) ?? 24000) : bytes,
      isPcm ? "audio/wav" : audio.type,
      signal,
      { isCaptureActive: () => refs.captureActive && isMicrophoneEnabled() },
    );
  }
  const playback = createPlaybackQueue(playAudio, releaseSessionIfIdle);

  function stopCapture(releaseInput = false): void {
    captureAttempt.cancel();
    const wasCaptureActive = refs.captureActive;
    refs.captureActive = false;
    refs.muted = false;
    try {
      if (wasCaptureActive) {
        native.toggleRecording(false);
      }
    } finally {
      if (releaseInput && refs.initialized) {
        refs.initialized = false;
        releaseNativeEngine();
      } else {
        releaseSessionIfIdle();
      }
      callbacks.onVolumeLevel(0);
      callbacks.onCaptureAvailabilityChange?.(true);
    }
  }

  const unsubscribeMicrophoneDisabled = subscribeMicrophoneDisabled(() => stopCapture(true));

  return {
    async initialize() {
      // On native, opening input is deferred until an allowed capture starts.
      if (refs.destroyed) {
        throw new Error("Audio engine destroyed");
      }
    },

    async destroy() {
      if (refs.destroyed) {
        return;
      }
      refs.destroyed = true;
      unsubscribeMicrophoneDisabled();
      try {
        playback.destroy();
        stopCapture(true);
      } finally {
        microphoneSubscription.remove();
        volumeSubscription.remove();
        interruptionSubscription.remove();
      }
    },

    async startCapture() {
      if (refs.captureActive && isMicrophoneEnabled()) {
        return;
      }

      const attemptId = captureAttempt.next();
      try {
        await requireMicrophoneEnabled();
        assertCanCapture(attemptId);
        await ensureMicrophonePermission(attemptId);
        await ensureInitialized(attemptId);
        assertCanCapture(attemptId);
        const isRecording =
          options?.captureMode === "dictation"
            ? native.startDictation()
            : native.toggleRecording(true);
        if (!isRecording) {
          throw new Error("Microphone capture could not start.");
        }
        refs.captureActive = true;
      } catch (error) {
        captureAttempt.assertCurrent(attemptId);
        throw error;
      }
    },

    async stopCapture() {
      stopCapture();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    play: playback.play,
    stop: playback.stop,
    clearQueue: playback.clearQueue,
    isPlaying: playback.isPlaying,
  };
}
