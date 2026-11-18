import { useCallback, useEffect, useRef } from "react";
import { Buffer } from "buffer";
import { useState } from "react";

import { createAudioEngine } from "@/audio";
import {
  isMicrophoneEnabled,
  requireMicrophoneEnabled,
  subscribeMicrophoneDisabled,
} from "@/audio/microphone-policy";
import { AttemptGuard } from "@/utils/attempt-guard";

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "./use-dictation-audio-source.types";

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const onInterruptionRef = useRef(config.onInterruption);
  const [volume, setVolume] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const engineRef = useRef<ReturnType<typeof createAudioEngine> | null>(null);
  const captureAttemptRef = useRef(new AttemptGuard());

  const getOrCreateEngine = useCallback(() => {
    if (engineRef.current) {
      return engineRef.current;
    }

    engineRef.current = createAudioEngine(
      {
        onCaptureData: (pcm) => {
          if (!isMicrophoneEnabled()) return;
          onPcmSegmentRef.current(Buffer.from(pcm).toString("base64"));
        },
        onVolumeLevel: (level) => {
          setVolume(isMicrophoneEnabled() ? level : 0);
        },
        onError: (error) => {
          onErrorRef.current?.(error);
        },
        onInterruption: () => {
          onInterruptionRef.current?.();
        },
        onCaptureAvailabilityChange: (available) => setIsPaused(!available),
      },
      { captureMode: "dictation" },
    );
    return engineRef.current;
  }, []);

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
    onInterruptionRef.current = config.onInterruption;
  }, [config.onPcmSegment, config.onError, config.onInterruption]);

  const start = useCallback(async () => {
    const engine = getOrCreateEngine();
    const attemptId = captureAttemptRef.current.next();
    await requireMicrophoneEnabled();
    captureAttemptRef.current.assertCurrent(attemptId);
    await engine.initialize();
    captureAttemptRef.current.assertCurrent(attemptId);
    await engine.startCapture();
  }, [getOrCreateEngine]);

  const stop = useCallback(async () => {
    captureAttemptRef.current.cancel();
    await engineRef.current?.stopCapture();
    setVolume(0);
  }, []);

  useEffect(() => {
    const unsubscribeMicrophoneDisabled = subscribeMicrophoneDisabled(() => {
      captureAttemptRef.current.cancel();
      setVolume(0);
      setIsPaused(false);
    });
    return () => {
      const engine = engineRef.current;
      captureAttemptRef.current.cancel();
      unsubscribeMicrophoneDisabled();
      engineRef.current = null;
      void engine?.destroy().catch(() => undefined);
    };
  }, []);

  return {
    start,
    stop,
    volume,
    isPaused,
  };
}
