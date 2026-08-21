"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  SPEECH_STATUS_LABELS,
  type SpeechInputErrorCode,
  type SpeechInputState,
} from "@/lib/speech/contracts";
import {
  createPushToTalkController,
  type PushToTalkController,
} from "@/lib/speech/recorder";
import { runPlaybackFallback } from "@/lib/voice/playback";

type SceneState = "ready" | "listening" | "thinking" | "speaking" | "review";
const CORRECTED_SENTENCE = "I’d like to order a flat white, please.";
const INITIAL_SPEECH_INPUT: SpeechInputState = { status: "ready", transcript: "" };

const SPEECH_ERROR_MESSAGES: Record<SpeechInputErrorCode, string> = {
  unsupported: "التسجيل الصوتي غير مدعوم في هذا المتصفح.",
  microphone_permission: "لم يُسمح باستخدام الميكروفون. فعّل الإذن ثم حاول مرة ثانية.",
  microphone_unavailable: "تعذّر تشغيل الميكروفون. تأكد أنه غير مستخدم في تطبيق آخر.",
  no_audio: "ما سمعنا كلامًا واضحًا. حاول مرة ثانية وتكلّم قبل إيقاف التسجيل.",
  invalid_audio: "صيغة التسجيل غير مدعومة. جرّب مرة ثانية من هذا المتصفح.",
  audio_too_large: "التسجيل طويل جدًا. جرّب جملة أقصر.",
  provider_failed: "تعذّر تحويل الصوت إلى نص الآن. حاول مرة ثانية.",
  network_failed: "تعذّر الاتصال بخدمة تحويل الصوت. تحقق من الشبكة وحاول مرة ثانية.",
};

function formatRecordingDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const VOICE_SOURCE_LABEL = {
  api: "elevenlabs",
  file: "coach-response.mp3",
  speech: "speechSynthesis",
  timer: "timer",
  cancelled: "cancelled",
} as const;

// مؤقتًا نستخدم أصوات المتصفح المجانية. عند اعتماد Fish Audio أو ElevenLabs
// سنستبدل هذه الكتلة بموصل خادمي واحد دون تغيير الواجهة.
const VOICE_PROFILE = {
  ar: { locale: "ar-SA", rate: 1.02, pitch: 0.94 },
  en: { locale: "en-US", rate: 0.88, pitch: 0.94 },
} as const;

const COPY: Record<SceneState, { eyebrow: string; title: string; helper: string }> = {
  ready: {
    eyebrow: "جاهز يا نجم؟",
    title: "اطلب قهوتك بالإنجليزي",
    helper: "اضغط المايك وابدأ بطريقتك — عادي تغلط.",
  },
  listening: {
    eyebrow: "جاري التسجيل",
    title: "قل طلبك بالإنجليزي…",
    helper: "اضغط زر المايك مرة أخرى فور انتهائك.",
  },
  thinking: {
    eyebrow: "لحظة بس",
    title: "فهمت عليك",
    helper: "أجهّز لك ردًا وتصحيحًا واحدًا مهمًا.",
  },
  speaking: {
    eyebrow: "اسمعها كذا",
    title: CORRECTED_SENTENCE,
    helper: "صياغة طبيعية وواضحة في المقهى.",
  },
  review: {
    eyebrow: "فرق بسيط، ونتيجة أقوى",
    title: CORRECTED_SENTENCE,
    helper: "استخدم I’d like to… بدل I want… في الطلبات.",
  },
};

function chooseVoice(language: "ar" | "en") {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const exact = language === "ar" ? /^ar-SA$/i : /^en-US$/i;
  const broad = language === "ar" ? /^ar/i : /^en/i;
  return voices.find((voice) => exact.test(voice.lang)) ?? voices.find((voice) => broad.test(voice.lang));
}

function speakSegment(text: string, language: "ar" | "en", signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (!("speechSynthesis" in window) || signal?.aborted) {
      resolve();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    const finish = () => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    };
    const handleAbort = () => {
      window.speechSynthesis.cancel();
      finish();
    };
    const profile = VOICE_PROFILE[language];
    utterance.lang = profile.locale;
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;
    utterance.volume = 1;
    const voice = chooseVoice(language);
    if (voice) utterance.voice = voice;
    utterance.onend = finish;
    utterance.onerror = finish;
    signal?.addEventListener("abort", handleAbort, { once: true });
    window.speechSynthesis.speak(utterance);
  });
}

function SoundMark({ active = false }: { active?: boolean }) {
  return (
    <span className={`sound-mark ${active ? "is-active" : ""}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export default function Home() {
  const [scene, setScene] = useState<SceneState>("ready");
  const [speechInput, setSpeechInput] = useState<SpeechInputState>(INITIAL_SPEECH_INPUT);
  const [isStartingCapture, setIsStartingCapture] = useState(false);
  const [isStoppingCapture, setIsStoppingCapture] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const timers = useRef<number[]>([]);
  const pushToTalk = useRef<PushToTalkController | null>(null);
  const startingCapture = useRef(false);
  const stoppingCapture = useRef(false);
  const conversation = useRef<HTMLElement | null>(null);
  const correctionCard = useRef<HTMLDivElement | null>(null);
  const coachAudio = useRef<HTMLAudioElement | null>(null);
  const coachAudioUrl = useRef<string | null>(null);
  const coachRequest = useRef<AbortController | null>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current = [];
  }, []);

  const addTimer = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timers.current.push(timer);
  }, []);

  const releaseCoachMedia = useCallback(() => {
    if (coachAudio.current) {
      coachAudio.current.pause();
      coachAudio.current.removeAttribute("src");
      coachAudio.current = null;
    }
    if (coachAudioUrl.current) {
      URL.revokeObjectURL(coachAudioUrl.current);
      coachAudioUrl.current = null;
    }
  }, []);

  const stopCoachPlayback = useCallback(() => {
    coachRequest.current?.abort();
    coachRequest.current = null;
    releaseCoachMedia();
    window.speechSynthesis?.cancel();
  }, [releaseCoachMedia]);

  const resetScene = useCallback(() => {
    clearTimers();
    startingCapture.current = false;
    stoppingCapture.current = false;
    setIsStartingCapture(false);
    setIsStoppingCapture(false);
    setRecordingSeconds(0);
    pushToTalk.current?.reset();
    stopCoachPlayback();
    setTranscript("");
    setSpeechInput(INITIAL_SPEECH_INPUT);
    setScene("ready");
    setNotice("");
  }, [clearTimers, stopCoachPlayback]);

  useEffect(
    () => () => {
      clearTimers();
      stopCoachPlayback();
    },
    [clearTimers, stopCoachPlayback],
  );

  useEffect(() => {
    if (scene !== "review") return;
    const frame = window.requestAnimationFrame(() => {
      correctionCard.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scene]);

  useEffect(() => {
    if (speechInput.status !== "listening") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [speechInput.status]);

  const playCoachReply = useCallback(async () => {
    stopCoachPlayback();
    const controller = new AbortController();
    coachRequest.current = controller;

    const playMedia = (source: string) =>
      new Promise<void>((resolve, reject) => {
        const media = new Audio(source);
        coachAudio.current = media;

        const cleanup = () => {
          media.removeEventListener("ended", handleEnded);
          media.removeEventListener("error", handleError);
          controller.signal.removeEventListener("abort", handleAbort);
        };
        const handleEnded = () => {
          cleanup();
          resolve();
        };
        const handleError = () => {
          cleanup();
          reject(new Error("Audio playback failed."));
        };
        const handleAbort = () => {
          media.pause();
          cleanup();
          reject(new DOMException("Playback cancelled.", "AbortError"));
        };

        media.addEventListener("ended", handleEnded, { once: true });
        media.addEventListener("error", handleError, { once: true });
        controller.signal.addEventListener("abort", handleAbort, { once: true });
        void media.play().catch(handleError);
      });

    try {
      const source = await runPlaybackFallback({
        signal: controller.signal,
        api: async () => {
          const response = await fetch("/api/tts", {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scriptId: "coffee-v1" }),
          });
          if (!response.ok || !response.headers.get("content-type")?.startsWith("audio/mpeg")) return false;

          coachAudioUrl.current = URL.createObjectURL(await response.blob());
          try {
            await playMedia(coachAudioUrl.current);
            return true;
          } finally {
            releaseCoachMedia();
          }
        },
        file: async () => {
          try {
            await playMedia("/audio/coach-response.mp3");
            return true;
          } finally {
            releaseCoachMedia();
          }
        },
        speech: async () => {
          if (!("speechSynthesis" in window)) return false;
          window.speechSynthesis.cancel();
          await speakSegment("حلو، فهمتك. بس خلنا نخليها طبيعية أكثر.", "ar", controller.signal);
          await speakSegment(CORRECTED_SENTENCE, "en", controller.signal);
          await speakSegment("ممتاز. الحين جرّب تقولها مرة ثانية.", "ar", controller.signal);
          return !controller.signal.aborted;
        },
        timer: () =>
          new Promise<void>((resolve) => {
            const timer = window.setTimeout(finish, 2600);
            timers.current.push(timer);
            const handleAbort = () => {
              window.clearTimeout(timer);
              finish();
            };
            function finish() {
              controller.signal.removeEventListener("abort", handleAbort);
              timers.current = timers.current.filter((activeTimer) => activeTimer !== timer);
              resolve();
            }
            controller.signal.addEventListener("abort", handleAbort, { once: true });
          }),
      });

      if (process.env.NODE_ENV === "development" && source !== "cancelled") {
        console.info(`[voice] source: ${VOICE_SOURCE_LABEL[source]}`);
      }

      if (source !== "cancelled" && coachRequest.current === controller) setScene("review");
    } finally {
      releaseCoachMedia();
      if (coachRequest.current === controller) coachRequest.current = null;
    }
  }, [releaseCoachMedia, stopCoachPlayback]);

  const completeListening = useCallback(
    (heardText: string) => {
      if (!heardText.trim()) return;
      setTranscript(heardText);
      setScene("thinking");
      addTimer(() => {
        setScene("speaking");
        void playCoachReply();
      }, 1250);
    },
    [addTimer, playCoachReply],
  );

  useEffect(() => {
    let active = true;
    const controller = createPushToTalkController((state) => {
      if (!active) return;
      setSpeechInput(state);

      if (state.status === "listening") {
        stoppingCapture.current = false;
        setIsStoppingCapture(false);
        setRecordingSeconds(0);
        setTranscript("");
        setNotice("");
        setScene("listening");
        return;
      }
      if (state.status === "processing") {
        stoppingCapture.current = false;
        setIsStoppingCapture(false);
        setNotice("");
        return;
      }
      if (state.status === "completed") {
        stoppingCapture.current = false;
        setIsStoppingCapture(false);
        completeListening(state.transcript);
        return;
      }
      if (state.status === "error") {
        stoppingCapture.current = false;
        setIsStoppingCapture(false);
        clearTimers();
        setTranscript("");
        setScene("ready");
        setNotice(
          state.errorCode
            ? SPEECH_ERROR_MESSAGES[state.errorCode]
            : "حدث خطأ غير متوقع. حاول مرة ثانية.",
        );
      }
    });

    pushToTalk.current = controller;
    return () => {
      active = false;
      controller.dispose();
      if (pushToTalk.current === controller) pushToTalk.current = null;
    };
  }, [clearTimers, completeListening]);

  const begin = async () => {
    const controller = pushToTalk.current;
    if (!controller) return;
    const status = controller.getState().status;

    if (status === "listening") {
      if (stoppingCapture.current) return;
      stoppingCapture.current = true;
      setIsStoppingCapture(true);
      controller.stop();
      return;
    }
    if (
      status === "processing" ||
      startingCapture.current ||
      scene === "thinking" ||
      scene === "speaking"
    ) return;

    resetScene();
    startingCapture.current = true;
    setIsStartingCapture(true);
    try {
      await controller.start();
    } finally {
      if (pushToTalk.current !== controller) {
        controller.dispose();
        return;
      }
      startingCapture.current = false;
      setIsStartingCapture(false);
    }
  };

  const activeCopy =
    speechInput.status === "processing"
      ? {
          eyebrow: "يعالج الصوت",
          title: "لحظة…",
          helper: "نحوّل تسجيلك إلى نص الآن.",
        }
      : speechInput.status === "error" && scene === "ready"
        ? {
            eyebrow: "حدث خطأ",
            title: "ما اكتمل التسجيل",
            helper: "راجع التنبيه وحاول مرة ثانية.",
          }
        : COPY[scene];
  const isBusy = scene === "listening" || scene === "thinking" || scene === "speaking";

  return (
    <main className="stage">
      <section className={`phone-shell state-${scene}`} aria-live="polite">
        <header className="topbar">
          <button className="round-button" type="button" aria-label="مساعدة" onClick={() => setNotice("هذه نسخة عرض سريعة لموقف الطلب في المقهى.")}>
            ؟
          </button>

          <div className="brand" aria-label="سوالف، رفيقك للإنجليزي">
            <span className="brand-symbol" aria-hidden="true"><b /><b /><b /></span>
            <span>سوالف</span>
          </div>

          <button className="round-button more-button" type="button" aria-label="إعدادات العرض" onClick={() => setSettingsOpen(true)}>
            <i /><i /><i />
          </button>
        </header>

        <div className="scenario-row">
          <div>
            <span className="scenario-label">موقف اليوم</span>
            <strong>في الكوفي</strong>
          </div>
          <span className="level-chip">A2</span>
        </div>

        <section className="conversation-stage" ref={conversation}>
          <div className="coach-visual" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="coach-orb">
              <SoundMark active={isBusy} />
            </div>
          </div>

          <div className="coach-copy">
            <span dir="rtl">{activeCopy.eyebrow}</span>
            <h1 dir={scene === "speaking" || scene === "review" ? "ltr" : "rtl"}>{activeCopy.title}</h1>
            <p dir="rtl">{activeCopy.helper}</p>
          </div>

          {(transcript || scene === "thinking" || scene === "speaking" || scene === "review") && (
            <div className="transcript-card" dir="ltr">
              <span className="card-kicker">YOU SAID</span>
              <p>{transcript}</p>
            </div>
          )}

          {scene === "review" && (
            <div className="correction-card" dir="rtl" ref={correctionCard}>
              <div className="correction-heading" dir="rtl">
                <span className="sparkle">✦</span>
                <span>تصحيح سريع</span>
              </div>
              <p dir="ltr"><del>I want order…</del></p>
              <strong dir="ltr">I’d like to order…</strong>
              <small dir="rtl">ألطف وأقرب لطريقة الكلام الطبيعية.</small>
            </div>
          )}
        </section>

        <footer className="control-dock">
          <div className="dock-wave" aria-hidden="true" />
          <div className="control-row">
            <button className="mini-control" type="button" aria-label="إعادة المشهد" onClick={resetScene}>↻</button>
            <button
              className={`mic-button ${isBusy ? "is-active" : ""}`}
              type="button"
              aria-label={
                isStoppingCapture
                  ? "تم إيقاف التسجيل، جارٍ تجهيز الصوت"
                  : speechInput.status === "listening"
                  ? "إنهاء الاستماع وإرسال التسجيل"
                  : speechInput.status === "processing"
                    ? "جارٍ معالجة الصوت"
                    : "بدء التسجيل"
              }
              onClick={() => { void begin(); }}
              disabled={
                isStartingCapture ||
                isStoppingCapture ||
                speechInput.status === "processing" ||
                scene === "thinking" ||
                scene === "speaking"
              }
            >
              <span className="mic-shape" aria-hidden="true" />
            </button>
            <button className="mini-control" type="button" aria-label="تشغيل الجملة الصحيحة" onClick={() => { stopCoachPlayback(); void speakSegment(CORRECTED_SENTENCE, "en"); }} disabled={isBusy}>◖</button>
          </div>
          <strong dir="rtl">
            {isStoppingCapture
              ? "تم إيقاف التسجيل — جارٍ تجهيز الصوت"
              : speechInput.status === "listening"
              ? "جاري التسجيل — اضغط مرة أخرى للإيقاف"
              : speechInput.status === "processing"
                ? "جارٍ إرسال التسجيل وتحويله"
                : scene === "review"
                  ? "جرّب مرة ثانية"
                  : "اضغط وتكلّم"}
          </strong>
          <span dir="rtl" className="mode-label is-live">
            <i /> {isStartingCapture
              ? "يفتح الميكروفون"
              : isStoppingCapture
                ? "تم الإيقاف"
                : speechInput.status === "listening"
                  ? `جاري التسجيل · ${formatRecordingDuration(recordingSeconds)}`
                  : SPEECH_STATUS_LABELS[speechInput.status]}
          </span>
        </footer>

        {notice && (
          <button className="toast" type="button" onClick={() => setNotice("")} aria-label="إغلاق التنبيه">
            {notice}
          </button>
        )}

        {settingsOpen && (
          <div className="sheet-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
            <section className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-handle" />
              <div className="sheet-heading">
                <div>
                  <span>إعداد سريع</span>
                  <h2 id="settings-title">طريقة الإدخال</h2>
                </div>
                <button type="button" aria-label="إغلاق" onClick={() => setSettingsOpen(false)}>×</button>
              </div>

              <button className="mode-option selected" type="button" onClick={() => setSettingsOpen(false)}>
                <span className="option-icon live-dot">●</span>
                <span><strong>مايك مباشر</strong><small>يسجل صوتك ويرسله للتحويل إلى نص بعد الإيقاف</small></span>
                <i />
              </button>

              <div className="voice-note">
                <span>الصوت الحالي</span>
                <strong>صوت ثابت — عربي + إنجليزي واضح</strong>
                <small>سنستبدله لاحقًا بصوتك المختار من مكان واحد فقط.</small>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}
