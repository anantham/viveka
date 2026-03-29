"use client";

import { useState, useEffect } from "react";

interface DelayScreenProps {
  delayMs: number;
  message: string | null;
  requiresConfirmation: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

const SOMATIC_PROMPTS = [
  "Notice what is happening in the body.",
  "Where is the urgency located? Chest? Jaw? Hands?",
  "What would happen if this response never arrived?",
  "Notice the impulse to read ahead. Just notice it.",
  "Feel the weight of your body in the chair.",
  "What is the quality of your breath right now?",
  "Is there tension you can release without effort?",
];

export default function DelayScreen({
  delayMs,
  message,
  requiresConfirmation,
  onComplete,
  onCancel,
}: DelayScreenProps) {
  const [remaining, setRemaining] = useState(delayMs);
  const [somaticPrompt] = useState(
    () => SOMATIC_PROMPTS[Math.floor(Math.random() * SOMATIC_PROMPTS.length)]
  );

  useEffect(() => {
    if (remaining <= 0 && !requiresConfirmation) {
      onComplete();
      return;
    }

    const interval = setInterval(() => {
      setRemaining((r) => Math.max(0, r - 100));
    }, 100);

    return () => clearInterval(interval);
  }, [remaining, requiresConfirmation, onComplete]);

  const seconds = Math.ceil(remaining / 1000);
  const progress = 1 - remaining / delayMs;

  return (
    <div className="fixed inset-0 bg-stone-950/90 flex items-center justify-center z-50">
      <div className="max-w-md w-full p-8 text-center space-y-6">
        {/* Progress bar */}
        <div className="w-full h-1 bg-stone-800 rounded overflow-hidden">
          <div
            className="h-full bg-stone-500 transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Timer */}
        <p className="text-2xl text-stone-500 tabular-nums">{seconds}s</p>

        {/* Message */}
        {message && (
          <p className="text-sm text-stone-400">{message}</p>
        )}

        {/* Somatic prompt */}
        <p className="text-sm text-stone-600 italic">{somaticPrompt}</p>

        {/* Actions */}
        <div className="flex gap-3 justify-center pt-4">
          {remaining <= 0 && requiresConfirmation && (
            <button
              onClick={onComplete}
              className="px-4 py-2 text-xs bg-stone-800 text-stone-300 border border-stone-600 rounded hover:bg-stone-700"
            >
              Continue anyway
            </button>
          )}
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs text-stone-600 hover:text-stone-400"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
