"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

/**
 * Dictée vocale via la reconnaissance vocale native du navigateur
 * (Web Speech API : Safari iOS, Chrome, Edge). Rien n'est envoyé à notre
 * serveur. Le bouton est masqué si le navigateur ne la supporte pas (Firefox).
 *
 * Le texte dicté est ajouté à la suite de `value` et mis à jour en direct
 * (résultats provisoires compris) via `onChange`.
 */

// Typage minimal : l'API n'est pas dans toutes les versions de lib.dom.
type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type RecognitionCtor = new () => Recognition;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Ajoute `addition` à `base` avec le séparateur voulu (rien si l'un est vide). */
function append(base: string, addition: string, joiner: string) {
  if (!addition) return base;
  if (!base) return addition;
  return /\s$/.test(base) ? base + addition : base + joiner + addition;
}

export function DictateButton({
  value,
  onChange,
  joiner = " ",
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  /** Séparateur entre le texte existant et la dictée (« \n » pour les champs ligne par ligne). */
  joiner?: string;
  className?: string;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);

  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false); // l'utilisateur veut continuer à dicter
  const baseRef = useRef(""); // texte figé avant la session de reconnaissance en cours
  const finalRef = useRef(""); // texte définitif de la session en cours
  const joinerRef = useRef(joiner); // séparateur à placer avant la prochaine dictée
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  // Détection côté client uniquement (évite un écart d'hydratation).
  useEffect(() => setSupported(getRecognitionCtor() !== null), []);

  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.abort();
    },
    [],
  );

  function startSession() {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    finalRef.current = "";

    rec.onresult = (e) => {
      const finals: string[] = [];
      const interims: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r) continue;
        (r.isFinal ? finals : interims).push(r[0].transcript);
      }
      finalRef.current = clean(finals.join(" "));
      const spoken = clean([finalRef.current, ...interims].join(" "));
      onChangeRef.current(append(baseRef.current, spoken, joinerRef.current));
    };

    rec.onerror = (e) => {
      // « no-speech » (silence) et « aborted » (arrêt volontaire) ne sont pas des erreurs.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wantRef.current = false;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Accès au micro refusé. Autorise-le dans les réglages du navigateur.");
      } else if (e.error === "network") {
        toast.error("Dictée indisponible : pas de connexion.");
      } else {
        toast.error("La dictée s'est interrompue.");
      }
    };

    rec.onend = () => {
      // Fige ce qui a été reconnu (on retire le provisoire non confirmé).
      if (finalRef.current) {
        baseRef.current = append(baseRef.current, finalRef.current, joinerRef.current);
        // La suite d'une même dictée se colle avec une simple espace.
        joinerRef.current = " ";
      }
      onChangeRef.current(baseRef.current);
      // Certains navigateurs coupent après un silence : on relance tant que
      // l'utilisateur n'a pas arrêté.
      if (wantRef.current) {
        try {
          startSession();
          return;
        } catch {
          wantRef.current = false;
        }
      }
      recRef.current = null;
      setListening(false);
    };

    recRef.current = rec;
    rec.start();
  }

  function toggle() {
    if (listening) {
      wantRef.current = false;
      recRef.current?.stop();
      return;
    }
    wantRef.current = true;
    baseRef.current = valueRef.current;
    joinerRef.current = joiner;
    try {
      startSession();
      setListening(true);
    } catch {
      wantRef.current = false;
      toast.error("Impossible de démarrer la dictée.");
    }
  }

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      aria-label={listening ? "Arrêter la dictée" : "Dicter"}
      title={listening ? "Arrêter la dictée" : "Dicter"}
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95",
        listening
          ? "animate-pulse bg-destructive text-destructive-foreground shadow-md"
          : "bg-primary/10 text-primary hover:bg-primary/20",
        className,
      )}
    >
      {listening ? <Square className="size-3.5 fill-current" /> : <Mic className="size-[18px]" />}
    </button>
  );
}
