import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import abcjs from "abcjs";
import "./App.css";


type Meter = "2/4" | "3/4" | "4/4" | "6/8";
type Phase = "idle" | "starting" | "pause" | "countin" | "recording" | "finished";

type Rhythm = {
  units: number;
  abcLength: number;
  short: boolean;
  weight: number;
};

type MelodyNote = {
  midi: number;
  duration: number;
};

type PitchSample = {
  time: number;
  midi: number | null;
};

type NoteResult = {
  index: number;
  target: string;
  heard: string;
  correct: boolean;
};

type KeyConfig = {
  label: string;
  abc: string;
  tonic: string;
  mode: "major" | "minor";
  scale: string[];
};

const MIN_MIDI = 55; // G3
const MAX_MIDI = 76; // E5

const KEYS: Record<string, KeyConfig> = {
  C: {
    label: "C Major",
    abc: "C",
    tonic: "C",
    mode: "major",
    scale: ["C", "D", "E", "F", "G", "A", "B"],
  },
  G: {
    label: "G Major",
    abc: "G",
    tonic: "G",
    mode: "major",
    scale: ["G", "A", "B", "C", "D", "E", "F#"],
  },
  D: {
    label: "D Major",
    abc: "D",
    tonic: "D",
    mode: "major",
    scale: ["D", "E", "F#", "G", "A", "B", "C#"],
  },
  F: {
    label: "F Major",
    abc: "F",
    tonic: "F",
    mode: "major",
    scale: ["F", "G", "A", "Bb", "C", "D", "E"],
  },
  A: {
    label: "A Major",
    abc: "A",
    tonic: "A",
    mode: "major",
    scale: ["A", "B", "C#", "D", "E", "F#", "G#"],
  },
  E: {
    label: "E Major",
    abc: "E",
    tonic: "E",
    mode: "major",
    scale: ["E", "F#", "G#", "A", "B", "C#", "D#"],
  },
  Bb: {
    label: "B-flat Major",
    abc: "Bb",
    tonic: "Bb",
    mode: "major",
    scale: ["Bb", "C", "D", "Eb", "F", "G", "A"],
  },
  Eb: {
    label: "E-flat Major",
    abc: "Eb",
    tonic: "Eb",
    mode: "major",
    scale: ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
  },
  Am: {
    label: "A Minor",
    abc: "Am",
    tonic: "A",
    mode: "minor",
    scale: ["A", "B", "C", "D", "E", "F", "G"],
  },
  Dm: {
    label: "D Minor",
    abc: "Dm",
    tonic: "D",
    mode: "minor",
    scale: ["D", "E", "F", "G", "A", "Bb", "C"],
  },
  Em: {
    label: "E Minor",
    abc: "Em",
    tonic: "E",
    mode: "minor",
    scale: ["E", "F#", "G", "A", "B", "C", "D"],
  },
};

const METERS: Meter[] = ["2/4", "3/4", "4/4", "6/8"];

const BAR_UNITS: Record<Meter, number> = {
  "2/4": 8,
  "3/4": 12,
  "4/4": 16,
  "6/8": 12,
};

// All durations use sixteenth-note units.
// A quarter note = 4 units; an eighth note = 2 units.
const RHYTHMS: Rhythm[] = [
  { units: 4, abcLength: 4, short: false, weight: 9 },
  { units: 8, abcLength: 8, short: false, weight: 4 },
  { units: 6, abcLength: 6, short: false, weight: 3 },
  { units: 2, abcLength: 2, short: true, weight: 4 },
  { units: 1, abcLength: 1, short: true, weight: 1 },
  { units: 3, abcLength: 3, short: true, weight: 2 },
];

const NOTE_NAMES = [
  "C", "C#", "D", "Eb", "E", "F",
  "F#", "G", "Ab", "A", "Bb", "B",
];

const NATURAL_SEMITONES: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function pitchClass(name: string): number {
  let value = NATURAL_SEMITONES[name[0]] ?? 0;

  if (name.includes("#")) value += 1;
  if (name.includes("b")) value -= 1;

  return (value + 12) % 12;
}

function noteToMidi(name: string, octave: number): number {
  return (octave + 1) * 12 + pitchClass(name);
}

function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  return `${name}${Math.floor(midi / 12) - 1}`;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function tonicMidi(key: KeyConfig): number {
  const candidates = [3, 4, 5]
    .map((octave) => noteToMidi(key.tonic, octave))
    .filter((midi) => midi >= MIN_MIDI && midi <= MAX_MIDI);

  return candidates.sort(
    (a, b) => Math.abs(a - 64) - Math.abs(b - 64),
  )[0] ?? noteToMidi(key.tonic, 4);
}

function scaleMidis(key: KeyConfig): number[] {
  const result: number[] = [];

  for (let octave = 3; octave <= 5; octave++) {
    for (const note of key.scale) {
      const midi = noteToMidi(note, octave);

      if (midi >= MIN_MIDI && midi <= MAX_MIDI) {
        result.push(midi);
      }
    }
  }

  return [...new Set(result)].sort((a, b) => a - b);
}

function intervalNumber(a: number, b: number): number {
  const semitones = Math.abs(a - b);

  if (semitones === 3 || semitones === 4) return 3;
  if (semitones === 5) return 4;
  if (semitones === 7) return 5;
  if (semitones === 8 || semitones === 9) return 6;

  return 99;
}

function allowedInterval(a: number, b: number): boolean {
  return [3, 4, 5, 7, 8, 9].includes(Math.abs(a - b));
}

function weightedRhythm(): Rhythm {
  const pool = RHYTHMS.flatMap((rhythm) =>
    Array.from({ length: rhythm.weight }, () => rhythm),
  );

  return pool[Math.floor(Math.random() * pool.length)];
}

function generateBar(
  units: number,
  isLastBar: boolean,
): number[] | null {
  // The final note must be a quarter or half note.
  const ending = isLastBar
    ? Math.random() < 0.65 ? 4 : 8
    : 0;

  if (ending > units) return null;

  let remaining = units - ending;
  const durations: number[] = [];
  let attempts = 0;

  while (remaining > 0 && attempts < 200) {
    attempts++;

    const rhythm = weightedRhythm();

    if (rhythm.units <= remaining) {
      durations.push(rhythm.units);
      remaining -= rhythm.units;
    }
  }

  if (remaining !== 0) return null;

  if (isLastBar) durations.push(ending);

  return durations;
}

function generatePitches(
  durations: number[],
  scale: number[],
  tonic: number,
): number[] | null {
  if (durations.length < 2) return null;

  const pitches: number[] = [];
  const lastIndex = durations.length - 1;

  function search(index: number): boolean {
    if (index >= durations.length) return true;

    const candidates = index === lastIndex
      ? [tonic]
      : [...scale].sort(() => Math.random() - 0.5);

    for (const candidate of candidates) {
      if (index > 0) {
        const previous = pitches[index - 1];

        if (!allowedInterval(previous, candidate)) continue;

        // Short notes cannot have intervals larger than a third.
        if (
          (durations[index] <= 2 || durations[index - 1] <= 2) &&
          intervalNumber(previous, candidate) > 3
        ) {
          continue;
        }

        // After a sixth, the next interval must be no larger than a third.
        if (index >= 2) {
          const precedingInterval = intervalNumber(
            pitches[index - 2],
            previous,
          );

          if (
            precedingInterval === 6 &&
            intervalNumber(previous, candidate) > 3
          ) {
            continue;
          }
        }
      }

      pitches.push(candidate);

      if (search(index + 1)) return true;

      pitches.pop();
    }

    return false;
  }

  return search(0) ? pitches : null;
}

function generateMelody(key: KeyConfig, meter: Meter): MelodyNote[] {
  const scale = scaleMidis(key);
  const tonic = tonicMidi(key);
  const unitsPerBar = BAR_UNITS[meter];

  for (let attempt = 0; attempt < 800; attempt++) {
    const durations: number[] = [];
    let valid = true;

    for (let bar = 0; bar < 4; bar++) {
      const barDurations = generateBar(
        unitsPerBar,
        bar === 3,
      );

      if (!barDurations) {
        valid = false;
        break;
      }

      durations.push(...barDurations);
    }

    if (!valid || durations.length < 4) continue;

    const shortCount = durations.filter((duration) => duration <= 3).length;

    // Require short notes, but no more than one third of all notes.
    if (
      shortCount === 0 ||
      shortCount > Math.floor(durations.length / 3)
    ) {
      continue;
    }

    const pitches = generatePitches(durations, scale, tonic);

    if (!pitches) continue;

    return durations.map((duration, index) => ({
      duration,
      midi: pitches[index],
    }));
  }

  // Guaranteed rhythm fallback: four complete bars.
  // The last note is the tonic and is a half note.
  const fallbackDurations = [
    4, 2, 2, 4,
    4, 4, 2, 2,
    4, 4, 4, 4,
    4, 2, 2, 8,
  ];

  const fallbackPitches: number[] = [];
  const choices = scale.filter((note) => note !== tonic);

  for (let index = 0; index < fallbackDurations.length - 1; index++) {
    const previous = fallbackPitches[index - 1];

    const candidates = choices.filter((candidate) => {
      if (previous === undefined) return true;
      return allowedInterval(previous, candidate);
    });

    fallbackPitches.push(
      candidates[Math.floor(Math.random() * candidates.length)] ??
      tonic,
    );
  }

  fallbackPitches.push(tonic);

  return fallbackDurations.map((duration, index) => ({
    duration,
    midi: fallbackPitches[index],
  }));
}

function midiToAbc(midi: number, key: KeyConfig): string {
  const pc = midi % 12;
  const octave = Math.floor(midi / 12) - 1;

  // Prefer the spelling used by the selected scale.
  const spelling =
    key.scale.find((name) => pitchClass(name) === pc) ??
    NOTE_NAMES[pc];

  const letter = spelling[0];

  // ABC key signatures supply accidentals, so do not duplicate them here.
  const accidental =
    key.scale.some((name) => pitchClass(name) === pc) ? "" :
    spelling.endsWith("#") ? "^" :
    spelling.endsWith("b") ? "_" : "";

  // In ABC, uppercase C is middle C (C4); lowercase c is C5.
  const abcLetter = octave >= 5 ? letter.toLowerCase() : letter;
  const octaveMarks =
    octave >= 5
      ? "'".repeat(octave - 5)
      : ",".repeat(4 - octave);

  return `${accidental}${abcLetter}${octaveMarks}`;
}

function melodyToAbc(
  melody: MelodyNote[],
  key: KeyConfig,
  meter: Meter,
): string {
  const barUnits = BAR_UNITS[meter];
  let unitsInBar = 0;
  const tokens: string[] = [];

  melody.forEach((note, index) => {
    // IMPORTANT: L:1/16 means the ABC duration suffix must be the
    // actual number of sixteenth-note units: 4 = quarter, 8 = half.
    tokens.push(`${midiToAbc(note.midi, key)}${note.duration}`);

    unitsInBar += note.duration;

    if (unitsInBar === barUnits && index < melody.length - 1) {
      tokens.push("|");
      unitsInBar = 0;
    }
  });

  return [
    "X:1",
    "T:Sight Singing Practice",
    "L:1/16",
    `M:${meter}`,
    `K:${key.abc}`,
    tokens.join(" ") + " ||",
  ].join("\n");
}

function autoCorrelate(
  buffer: Float32Array,
  sampleRate: number,
): number | null {
  let rms = 0;

  for (let i = 0; i < buffer.length; i++) {
    rms += buffer[i] * buffer[i];
  }

  rms = Math.sqrt(rms / buffer.length);

  if (rms < 0.012) return null;

  const minPeriod = Math.floor(sampleRate / 900);
  const maxPeriod = Math.min(
    Math.floor(sampleRate / 70),
    buffer.length - 1,
  );

  let bestOffset = -1;
  let bestCorrelation = 0;

  for (let offset = minPeriod; offset <= maxPeriod; offset++) {
    let correlation = 0;

    for (let i = 0; i < buffer.length - offset; i++) {
      correlation += buffer[i] * buffer[i + offset];
    }

    correlation /= buffer.length - offset;

    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestOffset = offset;
    }
  }

  if (bestOffset < 0 || bestCorrelation < 0.01) return null;

  const frequency = sampleRate / bestOffset;

  if (frequency < 70 || frequency > 900) return null;

  return Math.round(69 + 12 * Math.log2(frequency / 440));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function beatCount(meter: Meter): number {
  return Number(meter.split("/")[0]);
}

export default function App() {
  const [keyName, setKeyName] = useState("C");
  const [meter, setMeter] = useState<Meter>("4/4");
  const [tempo, setTempo] = useState(80);
  const [melody, setMelody] = useState<MelodyNote[]>(() =>
    generateMelody(KEYS.C, "4/4"),
  );

  const [phase, setPhase] = useState<Phase>("idle");
  const [countNumber, setCountNumber] = useState(0);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [statusMessage, setStatusMessage] = useState(
    "Choose your settings, then start the test.",
  );
  const [errorMessage, setErrorMessage] = useState("");
  const [noteResults, setNoteResults] = useState<NoteResult[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [demoPlaying, setDemoPlaying] = useState(false);

  const scoreRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sampleTimerRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const samplesRef = useRef<PitchSample[]>([]);
  const recordStartRef = useRef(0);
  const runIdRef = useRef(0);
  const phaseRef = useRef<Phase>("idle");
  const tempoRef = useRef(tempo);

  const key = KEYS[keyName];
  const isBusy = ["starting", "pause", "countin", "recording"].includes(phase);

  useEffect(() => {
    tempoRef.current = tempo;
  }, [tempo]);

  const abcNotation = useMemo(
    () => melodyToAbc(melody, key, meter),
    [melody, key, meter],
  );

  useEffect(() => {
    if (!scoreRef.current) return;

    scoreRef.current.innerHTML = "";

    abcjs.renderAbc(scoreRef.current, abcNotation, {
      add_classes: true,
      responsive: "resize",
      staffwidth: 760,
      scale: 1,
      paddingtop: 16,
      paddingbottom: 16,
      paddingleft: 16,
      paddingright: 16,
    });
  }, [abcNotation]);

  useEffect(() => {
    if (phase === "finished") {
      // Give the result section time to render before scrolling.
      const timer = window.setTimeout(() => {
        resultRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 120);

      return () => window.clearTimeout(timer);
    }
  }, [phase]);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }

    return audioContextRef.current;
  }, []);

  const playTone = useCallback(
    async (midi: number, durationSeconds: number, startAt?: number) => {
      const ctx = getAudioContext();

      if (ctx.state === "suspended") await ctx.resume();

      const start = startAt ?? ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = "sine";
      oscillator.frequency.value = midiToFrequency(midi);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.025);
      gain.gain.setValueAtTime(
        0.16,
        start + Math.max(0.04, durationSeconds - 0.06),
      );
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        start + durationSeconds,
      );

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + durationSeconds + 0.02);
    },
    [getAudioContext],
  );

  const playClick = useCallback(
    async (accent = false) => {
      const ctx = getAudioContext();

      if (ctx.state === "suspended") await ctx.resume();

      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.value = accent ? 1100 : 760;

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(
        accent ? 0.14 : 0.08,
        start + 0.005,
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.06);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.07);
    },
    [getAudioContext],
  );

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];

    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }
  }, []);

  const wait = useCallback((ms: number, runId: number) => {
    return new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        resolve(runIdRef.current === runId);
      }, ms);

      timersRef.current.push(timer);
    });
  }, []);

  const stopMicrophone = useCallback(() => {
    if (sampleTimerRef.current !== null) {
      window.clearInterval(sampleTimerRef.current);
      sampleTimerRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    analyserRef.current?.disconnect();
    analyserRef.current = null;
  }, []);

  const startMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is unavailable. Use HTTPS or localhost.",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    streamRef.current = stream;

    const ctx = getAudioContext();
    if (ctx.state === "suspended") await ctx.resume();

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();

    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;

    source.connect(analyser);
    analyserRef.current = analyser;
  }, [getAudioContext]);

  const startSampling = useCallback(() => {
    samplesRef.current = [];

    const analyser = analyserRef.current;
    const ctx = audioContextRef.current;

    if (!analyser || !ctx) return;

    const buffer = new Float32Array(analyser.fftSize);

    sampleTimerRef.current = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);

      samplesRef.current.push({
        time: performance.now(),
        midi: autoCorrelate(buffer, ctx.sampleRate),
      });
    }, 30);
  }, []);

  const calculateScore = useCallback(() => {
    const beatMs = 60000 / tempoRef.current;
    let elapsedUnits = 0;

    const results: NoteResult[] = melody.map((note, index) => {
      const startMs = (elapsedUnits / 4) * beatMs;
      const durationMs = (note.duration / 4) * beatMs;
      const endMs = startMs + durationMs;

      const innerStart = startMs + Math.min(90, durationMs * 0.2);
      const innerEnd = endMs - Math.min(70, durationMs * 0.15);

      const observed = samplesRef.current
        .filter((sample) => {
          const relativeTime = sample.time - recordStartRef.current;

          return (
            relativeTime >= innerStart &&
            relativeTime <= innerEnd &&
            sample.midi !== null
          );
        })
        .map((sample) => sample.midi as number);

      const heardMidi = median(observed);

      elapsedUnits += note.duration;

      return {
        index,
        target: midiToName(note.midi),
        heard: heardMidi === null ? "Not detected" : midiToName(heardMidi),
        correct: heardMidi !== null &&
          Math.abs(heardMidi - note.midi) <= 1,
      };
    });

    const correctCount = results.filter((result) => result.correct).length;
    const finalScore = Math.round((correctCount / results.length) * 100);

    setNoteResults(results);
    setScore(finalScore);
    setPhase("finished");
    phaseRef.current = "finished";
    setDemoPlaying(false);

    setStatusMessage(
      `${correctCount} of ${results.length} notes matched the target pitch.`,
    );
  }, [melody]);

  const startTest = useCallback(async () => {
    const runId = ++runIdRef.current;

    clearTimers();
    stopMicrophone();

    setErrorMessage("");
    setNoteResults([]);
    setScore(null);
    setDemoPlaying(false);
    setActiveBeat(-1);
    setCountNumber(0);
    setPhase("starting");
    phaseRef.current = "starting";
    setStatusMessage("Requesting microphone access...");

    try {
      await startMicrophone();

      if (runIdRef.current !== runId) return;

      startSampling();

      const beatMs = 60000 / tempoRef.current;
      const beats = beatCount(meter);

      // Only the first melody note is played before the test.
      setStatusMessage("Listen to the starting note.");
      await playTone(melody[0].midi, 1);

      if (!(await wait(1000, runId))) return;

      setPhase("pause");
      phaseRef.current = "pause";
      setStatusMessage("Get ready to sing the melody.");

      if (!(await wait(1000, runId))) return;

      setPhase("countin");
      phaseRef.current = "countin";
      setStatusMessage("Count-in");

      // In 6/8, the six count-in pulses are eighth-note pulses.
      const countInInterval = meter === "6/8" ? beatMs / 2 : beatMs;

      for (let beat = 0; beat < beats; beat++) {
        if (runIdRef.current !== runId) return;

        setCountNumber(beats - beat);
        setActiveBeat(beat);

        await playClick(beat === 0);

        if (!(await wait(countInInterval, runId))) return;
      }

      if (runIdRef.current !== runId) return;

      // The scoring clock begins immediately after the count-in.
      recordStartRef.current = performance.now();

      setPhase("recording");
      phaseRef.current = "recording";
      setCountNumber(0);
      setActiveBeat(0);
      setStatusMessage("Sing the complete melody.");

      const melodyDurationMs =
        melody.reduce((sum, note) => sum + note.duration, 0) / 4 * beatMs;

      const recordingBeatInterval =
        meter === "6/8" ? beatMs / 2 : beatMs;

      let beatIndex = 0;

      const tick = () => {
        if (
          runIdRef.current !== runId ||
          phaseRef.current !== "recording"
        ) {
          return;
        }

        setActiveBeat(beatIndex % beats);
        void playClick(beatIndex % beats === 0);
        beatIndex++;

        const timer = window.setTimeout(tick, recordingBeatInterval);
        timersRef.current.push(timer);
      };

      // First metronome click coincides with the recording start.
      void playClick(true);

      const firstTick = window.setTimeout(tick, recordingBeatInterval);
      timersRef.current.push(firstTick);

      if (!(await wait(melodyDurationMs + 80, runId))) return;

      stopMicrophone();
      clearTimers();
      setActiveBeat(-1);
      calculateScore();
    } catch (error) {
      stopMicrophone();
      clearTimers();

      setPhase("idle");
      phaseRef.current = "idle";

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to start the test. Check microphone permissions.",
      );

      setStatusMessage("The test could not start.");
    }
  }, [
    calculateScore,
    clearTimers,
    melody,
    meter,
    playClick,
    playTone,
    startMicrophone,
    startSampling,
    stopMicrophone,
    wait,
  ]);

  
  const playTonic = async () => {
    const ctx = getAudioContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const isMinor = key.mode === "minor";
    const tonic = tonicMidi(key);

    // Major: Do Mi Sol Mi Do
    // Minor: La Do Mi Do La
    const intervals = isMinor
      ? [0, 3, 7, 3, 0]
      : [0, 4, 7, 4, 0];

    // Keep the arpeggio within G3–E5.
    const notes = intervals.map((interval) => {
      let midi = tonic + interval;

      while (midi > MAX_MIDI) midi -= 12;
      while (midi < MIN_MIDI) midi += 12;

      return midi;
    });

    // Play a short tonic chord first.
    const chordStart = ctx.currentTime + 0.05;
    const chordNotes = [0, isMinor ? 3 : 4, 7].map((interval) => {
      let midi = tonic + interval;

      while (midi > MAX_MIDI) midi -= 12;
      while (midi < MIN_MIDI) midi += 12;

      return midi;
    });

    chordNotes.forEach((midi) => {
      void playTone(midi, 0.55, chordStart);
    });

    // Then play Do–Mi–Sol–Mi–Do or La–Do–Mi–Do–La.
    const arpeggioStart = chordStart + 0.65;

    notes.forEach((midi, index) => {
      void playTone(midi, 0.32, arpeggioStart + index * 0.4);
    });
  };

  const playDemo = useCallback(async () => {
    // Never play the answer before the test is completed.
    if (phaseRef.current !== "finished") return;

    const runId = ++runIdRef.current;
    clearTimers();

    setDemoPlaying(true);
    setStatusMessage("Playing the correct melody...");

    try {
      const ctx = getAudioContext();

      if (ctx.state === "suspended") await ctx.resume();

      const beatMs = 60000 / tempoRef.current;
      let startAt = ctx.currentTime + 0.08;

      for (const note of melody) {
        if (runIdRef.current !== runId) return;

        const durationSeconds = (note.duration / 4) * beatMs / 1000;

        await playTone(note.midi, durationSeconds * 0.9, startAt);

        startAt += durationSeconds;
      }

      const totalDuration =
        melody.reduce((sum, note) => sum + note.duration, 0) / 4 * beatMs;

      if (!(await wait(totalDuration, runId))) return;

      setStatusMessage("Correct melody playback completed.");
    } catch {
      setErrorMessage("Unable to play the demo. Please try again.");
    } finally {
      if (runIdRef.current === runId) setDemoPlaying(false);
    }
  }, [clearTimers, getAudioContext, melody, playTone, wait]);

  const resetTest = useCallback(() => {
    runIdRef.current++;
    clearTimers();
    stopMicrophone();

    setPhase("idle");
    phaseRef.current = "idle";
    setScore(null);
    setNoteResults([]);
    setDemoPlaying(false);
    setCountNumber(0);
    setActiveBeat(-1);
    setErrorMessage("");
    setStatusMessage("Ready when you are. Start the test to begin.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [clearTimers, stopMicrophone]);

  const newMelody = useCallback(() => {
    runIdRef.current++;
    clearTimers();
    stopMicrophone();

    setMelody(generateMelody(key, meter));
    setPhase("idle");
    phaseRef.current = "idle";
    setScore(null);
    setNoteResults([]);
    setDemoPlaying(false);
    setCountNumber(0);
    setActiveBeat(-1);
    setErrorMessage("");
    setStatusMessage("A new melody is ready. The answer stays hidden until you finish.");

    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [clearTimers, key, meter, stopMicrophone]);

  const updateKey = (nextKey: string) => {
    setKeyName(nextKey);
    setMelody(generateMelody(KEYS[nextKey], meter));
    setPhase("idle");
    phaseRef.current = "idle";
    setScore(null);
    setNoteResults([]);
    setDemoPlaying(false);
    setStatusMessage("Settings updated. Start a new test when ready.");
  };

  const updateMeter = (nextMeter: Meter) => {
    setMeter(nextMeter);
    setMelody(generateMelody(key, nextMeter));
    setPhase("idle");
    phaseRef.current = "idle";
    setScore(null);
    setNoteResults([]);
    setDemoPlaying(false);
    setStatusMessage("Settings updated. Start a new test when ready.");
  };

  useEffect(() => {
    return () => {
      runIdRef.current++;
      clearTimers();
      stopMicrophone();

      if (audioContextRef.current) {
        void audioContextRef.current.close();
      }
    };
  }, [clearTimers, stopMicrophone]);

  return (
    <main className="app-container">
      <header className="app-header">
        <div className="header-copy">
          <span className="eyebrow">MUSIC TRAINING STUDIO</span>
          <h1>Sing a Little</h1>
          <p>Read the music. Hear the starting note. Sing with confidence.</p>
        </div>
        <div className="header-mark" aria-hidden="true">♪</div>
      </header>

      <section className="settings-panel" aria-label="Practice settings">
        <div className="control-group">
          <label htmlFor="key-select">Key</label>
          <select
            id="key-select"
            className="control-select"
            value={keyName}
            disabled={isBusy}
            onChange={(event) => updateKey(event.target.value)}
          >
            {Object.entries(KEYS).map(([value, config]) => (
              <option key={value} value={value}>{config.label}</option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label htmlFor="meter-select">Time Signature</label>
          <select
            id="meter-select"
            className="control-select"
            value={meter}
            disabled={isBusy}
            onChange={(event) => updateMeter(event.target.value as Meter)}
          >
            {METERS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </div>

        <div className="control-group tempo-control">
          <label htmlFor="tempo-slider">Tempo <strong>{tempo} BPM</strong></label>
          <input
            id="tempo-slider"
            type="range"
            min="50"
            max="140"
            step="5"
            value={tempo}
            disabled={isBusy}
            onChange={(event) => setTempo(Number(event.target.value))}
          />
        </div>
      </section>

      <nav className="action-toolbar" aria-label="Practice actions">
        {phase === "finished" ? (
          <>
            <button
              className="button primary-button"
              onClick={resetTest}
              disabled={demoPlaying}
            >
              Retry
            </button>
            <button
              className="button secondary-button"
              onClick={() => void playDemo()}
              disabled={demoPlaying}
            >
              {demoPlaying ? "Playing Demo..." : "Demo"}
            </button>
            <button
              className="button secondary-button"
              onClick={newMelody}
              disabled={demoPlaying}
            >
              New Melody
            </button>
            <button
              type="button"
              onClick={() => void playTonic()}
              className="secondary-button"
            >
              Play Tonic
            </button>
          </>
        ) : (
          <>
            <button
              className="button primary-button"
              onClick={() => void startTest()}
              disabled={isBusy}
            >
              {isBusy ? "Test in Progress..." : "Start Test"}
            </button>
            <button
              className="button secondary-button"
              onClick={newMelody}
              disabled={isBusy}
            >
              New Melody
            </button>
            <button
              type="button"
              onClick={() => void playTonic()}
              className="secondary-button"
            >
              Play Tonic
            </button>
          </>
        )}
      </nav>

      <section className="sheet-container">
        <div className="section-heading-row">
          <div>
            <span className="eyebrow">YOUR EXERCISE</span>
            <h2>Read the Score</h2>
          </div>
          <span className="sheet-tag">4 bars</span>
        </div>

        <p className="section-description">
          Follow the notation and sing the melody. Before your test, only the
          starting note will be played.
        </p>

        <div className="music-score" ref={scoreRef} />
      </section>

      <section className={`practice-panel phase-${phase}`}>
        <div className="practice-panel-heading">
          <span className="status-indicator" />
          <h2>
            {phase === "starting" && "Starting Note"}
            {phase === "pause" && "Get Ready"}
            {phase === "countin" && "Count-In"}
            {phase === "recording" && "Recording"}
            {phase === "finished" && "Test Complete"}
            {phase === "idle" && "Ready to Practice"}
          </h2>
        </div>

        <p className="status-message">{statusMessage}</p>

        {phase === "pause" && (
          <p className="helper-text">
            Remember the starting pitch. The full melody will not be played yet.
          </p>
        )}

        {phase === "countin" && (
          <div className="countin-number" aria-live="polite">
            {countNumber}
          </div>
        )}

        {(phase === "countin" || phase === "recording") && (
          <div className="beat-dots" aria-label="Beat indicator">
            {Array.from({ length: beatCount(meter) }, (_, index) => (
              <span
                key={index}
                className={`beat-dot ${activeBeat === index ? "active" : ""}`}
              >
                {index + 1}
              </span>
            ))}
          </div>
        )}

        {errorMessage && (
          <p className="error-message" role="alert">{errorMessage}</p>
        )}
      </section>

      {phase === "finished" && score !== null && (
        <section className="score-panel" ref={resultRef} aria-live="polite">
          <div className="result-heading">
            <span className="eyebrow">YOUR PERFORMANCE</span>
            <h2>Test Results</h2>
            <p className="section-description">
              Your results are below. Review the notes, then use Demo above
              to hear the correct melody.
            </p>
          </div>

          <div className="score-summary">
            <div className="score-number">{score}%</div>
            <div className="score-summary-copy">
              <strong>Pitch Accuracy</strong>
              <p>{statusMessage}</p>
            </div>
          </div>

          <h3 className="analysis-heading">Note-by-Note Analysis</h3>

          <div className="note-analysis-grid">
            {noteResults.map((result) => (
              <article
                key={result.index}
                className={`note-analysis-card ${
                  result.correct ? "matched" : "not-matched"
                }`}
              >
                <span className="note-index">NOTE {result.index + 1}</span>
                <strong className="target-note">{result.target}</strong>
                <span className="heard-note">
                  Heard: {result.heard}
                </span>
                <span className={`note-status ${
                  result.correct ? "correct-status" : "review-status"
                }`}>
                  {result.correct ? "Correct" : "Review"}
                </span>
              </article>
            ))}
          </div>

          <p className="result-footer">
            Ready for another round? Use Retry or generate a New Melody above.
          </p>
        </section>
      )}

      <footer className="app-footer">
        <span className="footer-symbol">♪</span>
        <p>
          Practice slowly, listen carefully, and let your confidence grow.
        </p>
      </footer>
    </main>
  );
}
