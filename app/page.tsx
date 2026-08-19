"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { runPlaybackFallback } from "@/lib/voice/playback";

type SceneState = "ready" | "listening" | "thinking" | "speaking" | "review";
type ExperienceMode = "showcase" | "live";

type SpeechRecognitionEventLike = Event & {
  results: ArrayLike<{
    0: { transcript: string };
    isFinal: boolean;
  }>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

const DEMO_TRANSCRIPT = "I want order a flat white, please.";
const CORRECTED_SENTENCE = "I’d like to order a flat white, please.";

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
    eyebrow: "أسمعك الآن",
    title: "قل طلبك بالإنجليزي…",
    helper: "خذ راحتك، ما راح أقاطعك.",
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
  const [mode, setMode] = useState<ExperienceMode>("showcase");
  const [transcript, setTranscript] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const timers = useRef<number[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const latestTranscript = useRef("");
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
    recognition.current?.stop();
    recognition.current = null;
    stopCoachPlayback();
    setTranscript("");
    latestTranscript.current = "";
    setScene("ready");
    setNotice("");
  }, [clearTimers, stopCoachPlayback]);

  useEffect(
    () => () => {
      clearTimers();
      recognition.current?.stop();
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

      if (source !== "cancelled" && coachRequest.current === controller) setScene("review");
    } finally {
      releaseCoachMedia();
      if (coachRequest.current === controller) coachRequest.current = null;
    }
  }, [releaseCoachMedia, stopCoachPlayback]);

  const completeListening = useCallback(
    (heardText: string) => {
      recognition.current?.stop();
      recognition.current = null;
      const finalTranscript = heardText.trim() || DEMO_TRANSCRIPT;
      latestTranscript.current = finalTranscript;
      setTranscript(finalTranscript);
      setScene("thinking");
      addTimer(() => {
        setScene("speaking");
        void playCoachReply();
      }, 1250);
    },
    [addTimer, playCoachReply],
  );

  const runShowcase = useCallback(() => {
    setScene("listening");
    setTranscript("");
    latestTranscript.current = "";
    addTimer(() => { latestTranscript.current = "I want…"; setTranscript("I want…"); }, 650);
    addTimer(() => { latestTranscript.current = "I want order…"; setTranscript("I want order…"); }, 1250);
    addTimer(() => completeListening(DEMO_TRANSCRIPT), 2150);
  }, [addTimer, completeListening]);

  const runLive = useCallback(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("التعرّف المباشر غير متاح هنا، شغّلت وضع العرض بدلًا منه.");
      runShowcase();
      return;
    }

    const engine = new Recognition();
    recognition.current = engine;
    engine.continuous = false;
    engine.interimResults = true;
    engine.lang = "en-US";
    engine.onresult = (event) => {
      let heard = "";
      for (let index = 0; index < event.results.length; index += 1) {
        heard += event.results[index][0]?.transcript ?? "";
      }
      latestTranscript.current = heard;
      setTranscript(heard);
      const lastResult = event.results[event.results.length - 1];
      if (lastResult?.isFinal) completeListening(heard);
    };
    engine.onerror = () => {
      setNotice("تعذّر الوصول للمايك، استخدمت المشهد الجاهز.");
      runShowcase();
    };
    engine.onend = () => {
      if (latestTranscript.current.trim()) completeListening(latestTranscript.current);
    };
    setScene("listening");
    setTranscript("");
    latestTranscript.current = "";
    engine.start();
  }, [completeListening, runShowcase]);

  const begin = () => {
    if (scene === "listening") {
      completeListening(transcript || DEMO_TRANSCRIPT);
      return;
    }
    if (scene === "thinking" || scene === "speaking") return;
    resetScene();
    addTimer(() => (mode === "live" ? runLive() : runShowcase()), 80);
  };

  const activeCopy = COPY[scene];
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
              <p>{transcript || DEMO_TRANSCRIPT}</p>
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
              aria-label={scene === "listening" ? "إنهاء الاستماع" : "بدء المحادثة"}
              onClick={begin}
              disabled={scene === "thinking" || scene === "speaking"}
            >
              <span className="mic-shape" aria-hidden="true" />
            </button>
            <button className="mini-control" type="button" aria-label="تشغيل الجملة الصحيحة" onClick={() => { stopCoachPlayback(); void speakSegment(CORRECTED_SENTENCE, "en"); }} disabled={isBusy}>◖</button>
          </div>
          <strong dir="rtl">{scene === "listening" ? "اضغط عند الانتهاء" : scene === "review" ? "جرّب مرة ثانية" : "اضغط وتكلّم"}</strong>
          <span dir="rtl" className={`mode-label ${mode === "live" ? "is-live" : ""}`}>
            <i /> {mode === "live" ? "مايك مباشر" : "عرض جاهز للتصوير"}
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
                  <h2 id="settings-title">اختر طريقة العرض</h2>
                </div>
                <button type="button" aria-label="إغلاق" onClick={() => setSettingsOpen(false)}>×</button>
              </div>

              <button className={`mode-option ${mode === "showcase" ? "selected" : ""}`} type="button" onClick={() => { setMode("showcase"); resetScene(); setSettingsOpen(false); }}>
                <span className="option-icon">✦</span>
                <span><strong>عرض مضمون</strong><small>مشهد ثابت لا يفشل أثناء التصوير</small></span>
                <i />
              </button>
              <button className={`mode-option ${mode === "live" ? "selected" : ""}`} type="button" onClick={() => { setMode("live"); resetScene(); setSettingsOpen(false); }}>
                <span className="option-icon live-dot">●</span>
                <span><strong>مايك مباشر</strong><small>يستخدم التعرف المتاح في المتصفح</small></span>
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
