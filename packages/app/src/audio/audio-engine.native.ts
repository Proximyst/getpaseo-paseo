import type {
  AudioEngine,
  AudioEngineCallbacks,
  AudioEngineOptions,
  AudioPlaybackSource,
} from "./audio-engine-types";
import { AttemptCancelledError, AttemptGuard } from "@/utils/attempt-guard";
import {
  isMicrophoneEnabled,
  requireMicrophoneEnabled,
  subscribeMicrophoneDisabled,
} from "./microphone-policy";

import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { createPlaybackQueue } from "./playback";
import { playFile } from "./file-playback";
import { parsePcmSampleRate, playPcm16 } from "./pcm";

function pcm16ToWav(bytes: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + bytes.byteLength);
  const header = new DataView(wav.buffer);
  wav.set([82, 73, 70, 70], 0); // RIFF
  header.setUint32(4, 36 + bytes.byteLength, true);
  wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8); // WAVEfmt
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  wav.set([100, 97, 116, 97], 36); // data
  header.setUint32(40, bytes.byteLength, true);
  wav.set(bytes, 44);
  return wav;
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  options?: AudioEngineOptions,
): AudioEngine {
  const native = require("@getpaseo/expo-two-way-audio");
  const captureAttempt = new AttemptGuard();
  let initializationPromise: Promise<void> | null = null;

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
      if (!refs.captureActive || refs.muted || refs.destroyed || !isMicrophoneEnabled()) {
        return;
      }
      const pcm = event.data;
      callbacks.onCaptureData(pcm);
    },
  );
  const volumeSubscription = native.addExpoTwoWayAudioEventListener(
    "onInputVolumeLevelData",
    (event: { data: number }) => {
      if (!refs.captureActive || refs.destroyed || !isMicrophoneEnabled()) {
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

  async function ensureInitialized(attemptId: number): Promise<void> {
    if (initializationPromise) {
      await initializationPromise.catch(() => undefined);
      captureAttempt.assertCurrent(attemptId);
    }
    if (refs.initialized) {
      return;
    }
    const pending = (async () => {
      const success = await native.initialize();
      if (!success) {
        throw new Error("expo-two-way-audio: native initialize() returned false");
      }
      refs.initialized = true;
      if (!captureAttempt.isCurrent(attemptId) || refs.destroyed || !isMicrophoneEnabled()) {
        native.tearDown();
        refs.initialized = false;
        throw new AttemptCancelledError();
      }
    })();
    initializationPromise = pending;
    try {
      await pending;
    } finally {
      if (initializationPromise === pending) {
        initializationPromise = null;
      }
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
    captureAttempt.assertCurrent(attemptId);
    if (!isMicrophoneEnabled()) {
      throw new AttemptCancelledError();
    }
    if (!permission?.granted) {
      permission = await native.requestMicrophonePermissionsAsync().catch(() => null);
      captureAttempt.assertCurrent(attemptId);
    }
    if (!permission?.granted) {
      throw new Error(
        "Microphone permission is required to capture audio. Please enable microphone access in system settings.",
      );
    }
  }

  let nextFileId = 0;
  async function playAudio(audio: AudioPlaybackSource, signal: AbortSignal): Promise<number> {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (signal.aborted) throw new Error("Playback stopped");
    const isPcm = audio.type.startsWith("audio/pcm");
    if (isPcm && refs.captureActive && isMicrophoneEnabled()) {
      return playPcm16(bytes, audio.type, signal, native);
    }
    // The two-way iOS engine opens its input even for playback. Output-only
    // playback uses the file player and never initializes that engine.
    if (!refs.captureActive) {
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        interruptionMode: "duckOthers",
        interruptionModeAndroid: "duckOthers",
      });
    }
    if (signal.aborted) throw new Error("Playback stopped");
    // AVPlayer needs a file extension to recognize local encoded audio on iOS.
    const extension = isPcm
      ? "wav"
      : ({
          "audio/wav": "wav",
          "audio/x-wav": "wav",
          "audio/wave": "wav",
          "audio/mpeg": "mp3",
          "audio/mp3": "mp3",
          "audio/mp4": "m4a",
          "audio/aac": "aac",
          "audio/ogg": "ogg",
          "audio/flac": "flac",
        }[audio.type.split(";")[0].trim()] ?? "audio");
    const file = new File(Paths.cache, `paseo-audio-${Date.now()}-${nextFileId++}.${extension}`);
    try {
      file.write(isPcm ? pcm16ToWav(bytes, parsePcmSampleRate(audio.type) ?? 24000) : bytes);
      const player = createAudioPlayer(file.uri, {
        updateInterval: 100,
        keepAudioSessionActive: refs.captureActive,
      });
      return await playFile(player, signal);
    } finally {
      if (file.exists) file.delete();
    }
  }
  const playback = createPlaybackQueue(playAudio, releaseSessionIfIdle);

  function stopCapture(releaseInput = false): void {
    captureAttempt.cancel();
    const wasActive = refs.captureActive;
    refs.captureActive = false;
    refs.muted = false;
    if (wasActive) {
      native.toggleRecording(false);
    }
    if (releaseInput && (refs.initialized || initializationPromise)) {
      native.tearDown();
      refs.initialized = false;
    }
    callbacks.onVolumeLevel(0);
    callbacks.onCaptureAvailabilityChange?.(true);
    releaseSessionIfIdle();
  }

  const unsubscribeMicrophoneDisabled = subscribeMicrophoneDisabled(() => {
    stopCapture(true);
  });

  return {
    async initialize() {
      // Input initialization is deferred until a permitted capture starts.
    },

    async destroy() {
      if (refs.destroyed) {
        return;
      }
      refs.destroyed = true;
      unsubscribeMicrophoneDisabled();
      playback.destroy();
      stopCapture(true);
      microphoneSubscription.remove();
      volumeSubscription.remove();
      interruptionSubscription.remove();
    },

    async startCapture() {
      if (refs.captureActive && isMicrophoneEnabled()) {
        return;
      }
      const attemptId = captureAttempt.next();

      try {
        await requireMicrophoneEnabled();
        captureAttempt.assertCurrent(attemptId);
        if (refs.destroyed) {
          throw new AttemptCancelledError();
        }
        await ensureMicrophonePermission(attemptId);
        await ensureInitialized(attemptId);
        captureAttempt.assertCurrent(attemptId);
        if (!isMicrophoneEnabled()) {
          throw new AttemptCancelledError();
        }
        const isRecording =
          options?.captureMode === "dictation"
            ? native.startDictation()
            : native.toggleRecording(true);
        if (!isRecording) {
          throw new Error(
            "Microphone capture could not start because Android audio focus is unavailable.",
          );
        }
        refs.captureActive = true;
      } catch (error) {
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
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
