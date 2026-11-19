import { expect, test } from "vitest";
import { parsePcm16Wav } from "@/utils/pcm16-wav";
import type { AudioEngineCallbacks } from "./audio-engine-types";
import { createNativeAudioEngine, type NativeAudioEngineDeps } from "./native-audio-engine";

// In-memory stand-in for `@getpaseo/expo-two-way-audio`, matching its iOS and Android modules:
// one native engine per app, `initialize()` reuses it, `tearDown()` frees it, and
// `toggleRecording(true)` / `startDictation()` return false while no engine exists.
// Session handling follows iOS: recording activates the OS audio session, stopping does not
// deactivate it, and `releaseAudioSession()` deactivates it only while nothing is recording.
function fakeTwoWayAudio({
  captureAvailable = true,
  permissionRequestError,
}: { captureAvailable?: boolean; permissionRequestError?: Error } = {}) {
  let engine: { recording: boolean; sessionActive: boolean } | null = null;
  const calls = { initialize: 0, tearDown: 0, permissionReads: 0, captureStarts: 0 };
  const native: NativeAudioEngineDeps["native"] = {
    async initialize() {
      calls.initialize += 1;
      engine ??= { recording: false, sessionActive: false };
      return true;
    },
    tearDown() {
      calls.tearDown += 1;
      engine = null;
    },
    toggleRecording(value: boolean) {
      if (!engine) return false;
      engine.recording = value;
      if (value) {
        engine.sessionActive = true;
        calls.captureStarts += 1;
      }
      return value;
    },
    startDictation() {
      if (!engine || !captureAvailable) return false;
      engine.recording = true;
      engine.sessionActive = true;
      calls.captureStarts += 1;
      return true;
    },
    releaseAudioSession() {
      if (engine && !engine.recording) engine.sessionActive = false;
    },
    playPCMData() {},
    resumePlayback() {},
    stopPlayback() {},
    async getMicrophonePermissionsAsync() {
      calls.permissionReads += 1;
      return { granted: !permissionRequestError };
    },
    async requestMicrophonePermissionsAsync() {
      if (permissionRequestError) throw permissionRequestError;
      return { granted: true };
    },
    addExpoTwoWayAudioEventListener() {
      return { remove() {} };
    },
  };
  return {
    native,
    calls,
    hasEngine: () => engine !== null,
    sessionActive: () => engine?.sessionActive ?? false,
  };
}

const recordingCallbacks: AudioEngineCallbacks = {
  onCaptureData() {},
  onVolumeLevel() {},
};

function microphonePolicy(enabled = true) {
  const listeners = new Set<() => void>();
  return {
    setEnabled(value: boolean) {
      if (enabled === value) return;
      enabled = value;
      if (!enabled) {
        for (const listener of listeners) listener();
      }
    },
    isMicrophoneEnabled: () => enabled,
    async requireMicrophoneEnabled() {
      if (!enabled) throw new Error("Microphone access is disabled in app settings.");
    },
    subscribeMicrophoneDisabled(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function holdNativeInitialization(native: NativeAudioEngineDeps["native"]) {
  const started = Promise.withResolvers<void>();
  const proceed = Promise.withResolvers<void>();
  const initialize = native.initialize;
  native.initialize = async () => {
    started.resolve();
    await proceed.promise;
    return initialize();
  };
  return { started: started.promise, proceed: proceed.resolve };
}

function deps(
  native: NativeAudioEngineDeps["native"],
  policy: NativeAudioEngineDeps["microphonePolicy"] = microphonePolicy(),
): NativeAudioEngineDeps {
  return {
    native,
    microphonePolicy: policy,
    playEncodedAudio: async () => 0,
  };
}

// Issue #4147: on iPhone, voice mode failed with "Android audio focus is unavailable"
// after the dictation engine was destroyed.
test("voice capture starts after the dictation engine is destroyed", async () => {
  const fake = fakeTwoWayAudio();
  const voiceEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);
  await voiceEngine.startCapture();
  await voiceEngine.stopCapture();

  const dictationEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });
  await dictationEngine.startCapture();
  await dictationEngine.stopCapture();
  await dictationEngine.destroy();

  await expect(voiceEngine.startCapture()).resolves.toBeUndefined();
});

test("destroying dictation while voice is capturing keeps the native engine", async () => {
  const fake = fakeTwoWayAudio();
  const voiceEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);

  const dictationEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });
  await dictationEngine.startCapture();
  await dictationEngine.stopCapture();
  await voiceEngine.startCapture();
  await dictationEngine.destroy();

  expect(fake.hasEngine()).toBe(true);
  expect(fake.calls.tearDown).toBe(0);
});

// Review on #9051: with voice holding the engine, destroying an active dictation engine must
// still hand back the idle OS audio session so background music resumes (#2866).
test("destroying active dictation releases the idle audio session while voice keeps the engine", async () => {
  const fake = fakeTwoWayAudio();
  const voiceEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);
  await voiceEngine.startCapture();
  await voiceEngine.stopCapture();

  const dictationEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });
  await dictationEngine.startCapture();
  await dictationEngine.destroy();

  expect(fake.hasEngine()).toBe(true);
  expect(fake.sessionActive()).toBe(false);
});

test("destroying dictation does not release the session while voice is recording", async () => {
  const fake = fakeTwoWayAudio();
  const voiceEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);

  const dictationEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });
  await dictationEngine.startCapture();
  await dictationEngine.stopCapture();
  await voiceEngine.startCapture();
  await dictationEngine.destroy();

  expect(fake.sessionActive()).toBe(true);
});

test("destroying the last engine tears the native engine down", async () => {
  const fake = fakeTwoWayAudio();
  const voiceEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);
  const dictationEngine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });
  await voiceEngine.startCapture();
  await voiceEngine.stopCapture();
  await dictationEngine.startCapture();
  await dictationEngine.stopCapture();

  await dictationEngine.destroy();
  await voiceEngine.destroy();

  expect(fake.calls.tearDown).toBe(1);
  expect(fake.hasEngine()).toBe(false);
});

test("an engine destroyed while initializing does not keep the native engine", async () => {
  const fake = fakeTwoWayAudio();
  const { started, proceed } = holdNativeInitialization(fake.native);
  const engine = createNativeAudioEngine(deps(fake.native), recordingCallbacks);

  const initializing = expect(engine.startCapture()).rejects.toThrow("Attempt cancelled");
  await started;
  await engine.destroy();
  proceed();
  await initializing;

  expect(fake.hasEngine()).toBe(false);
});

test("a failed native recording start rejects with a platform-neutral error", async () => {
  const fake = fakeTwoWayAudio({ captureAvailable: false });
  const engine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });

  await expect(engine.startCapture()).rejects.toThrow(/^Microphone capture could not start\.$/);
  await engine.destroy();
});

test("a failed native permission request retains the permission reason and original error", async () => {
  const permissionRequestError = new Error("The current activity is not available.");
  const fake = fakeTwoWayAudio({ permissionRequestError });
  const engine = createNativeAudioEngine(deps(fake.native), recordingCallbacks, {
    captureMode: "dictation",
  });

  await expect(engine.startCapture()).rejects.toMatchObject({
    reason: "permissionDenied",
    cause: permissionRequestError,
  });
  expect(fake.hasEngine()).toBe(false);
  await engine.destroy();
});

test("disabled microphone never requests permission or initializes input, including PCM playback", async () => {
  const fake = fakeTwoWayAudio();
  const engine = createNativeAudioEngine(
    {
      ...deps(fake.native, microphonePolicy(false)),
      playEncodedAudio: async (bytes, mimeType, _signal, context) => {
        expect(mimeType).toBe("audio/wav");
        expect(context.isCaptureActive()).toBe(false);
        expect(parsePcm16Wav(new Uint8Array(bytes).buffer)).toEqual({
          sampleRate: 16000,
          samples: new Int16Array([256]),
        });
        return 1 / 16000;
      },
    },
    recordingCallbacks,
  );

  await engine.initialize();
  await expect(engine.startCapture()).rejects.toThrow("Microphone access is disabled");
  const pcm = Uint8Array.of(0, 1);
  await expect(
    engine.play({
      arrayBuffer: async () => pcm.buffer,
      size: pcm.byteLength,
      type: "audio/pcm;rate=16000",
    }),
  ).resolves.toBe(1 / 16000);
  expect(fake.calls.permissionReads).toBe(0);
  expect(fake.calls.initialize).toBe(0);
  await engine.destroy();
});

test("disabling during a pending permission prompt invalidates capture even if re-enabled", async () => {
  const fake = fakeTwoWayAudio();
  const prompted = Promise.withResolvers<void>();
  const permission = Promise.withResolvers<{ granted: boolean }>();
  fake.native.getMicrophonePermissionsAsync = async () => ({ granted: false });
  fake.native.requestMicrophonePermissionsAsync = () => {
    prompted.resolve();
    return permission.promise;
  };
  const policy = microphonePolicy();
  const engine = createNativeAudioEngine(deps(fake.native, policy), recordingCallbacks);

  const capture = expect(engine.startCapture()).rejects.toThrow("Attempt cancelled");
  await prompted.promise;
  policy.setEnabled(false);
  policy.setEnabled(true);
  permission.resolve({ granted: true });
  await capture;
  expect(fake.calls.initialize).toBe(0);
  expect(fake.calls.captureStarts).toBe(0);
  await engine.destroy();
});

test("disabling during native initialization releases the late lease without starting capture", async () => {
  const fake = fakeTwoWayAudio();
  const { started, proceed } = holdNativeInitialization(fake.native);
  const policy = microphonePolicy();
  const engine = createNativeAudioEngine(deps(fake.native, policy), recordingCallbacks);

  const capture = expect(engine.startCapture()).rejects.toThrow("Attempt cancelled");
  await started;
  policy.setEnabled(false);
  proceed();
  await capture;
  expect(fake.hasEngine()).toBe(false);
  expect(fake.calls.captureStarts).toBe(0);
  expect(fake.calls.tearDown).toBe(1);

  policy.setEnabled(true);
  await engine.startCapture();
  expect(fake.calls.captureStarts).toBe(1);
  await engine.destroy();
});

test("disabling active capture releases all policy-scoped leases", async () => {
  const fake = fakeTwoWayAudio();
  const policy = microphonePolicy();
  const voiceEngine = createNativeAudioEngine(deps(fake.native, policy), recordingCallbacks);
  const dictationEngine = createNativeAudioEngine(deps(fake.native, policy), recordingCallbacks, {
    captureMode: "dictation",
  });
  await voiceEngine.startCapture();
  await voiceEngine.stopCapture();
  await dictationEngine.startCapture();

  policy.setEnabled(false);
  expect(fake.hasEngine()).toBe(false);
  expect(fake.calls.tearDown).toBe(1);
  expect(fake.sessionActive()).toBe(false);
  await dictationEngine.destroy();
  await voiceEngine.destroy();
});
