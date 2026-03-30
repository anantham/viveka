"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Session, Exchange, ContextBlock } from "@/lib/types";
import BudgetMeter from "./BudgetMeter";
import PatternOverlay from "./PatternOverlay";
import CompletionCheck from "./CompletionCheck";
import DelayScreen from "./DelayScreen";
import ContextPanel from "./ContextPanel";
import UsageMeters from "./UsageMeters";
import LLMSettings from "./LLMSettings";

interface ChatInterfaceProps {
  session: Session;
  onSessionUpdate: (session: Session) => void;
}

interface Timing {
  heuristics_ms: number;
  claude_ms: number;
  classifier_ms?: number;
  store_ms: number;
  total_ms: number;
}

interface RateLimitInfo {
  status: string;
  resetsAt: number;
  rateLimitType: string;
  percentUsed?: number;
}

interface ContextUsage {
  contextBlockTokens: number;
  historyTokens: number;
  totalTokens: number;
  maxTokens: number;
}

interface DelayInfo {
  delayMs: number;
  message: string | null;
  requiresConfirmation: boolean;
}

interface PendingDelayResponse {
  pendingDelay: true;
  delay: DelayInfo;
  timing: Timing;
  sessionStatus: string;
  budgetUsed: number;
  budgetTotal: number;
}

interface MessageResponse {
  pendingDelay?: false;
  exchange: Exchange;
  delay: DelayInfo;
  timing: Timing;
  sessionStatus: string;
  budgetUsed: number;
  budgetTotal: number;
  rateLimit: RateLimitInfo | null;
  contextUsage: ContextUsage | null;
}

export default function ChatInterface({
  session: initialSession,
  onSessionUpdate,
}: ChatInterfaceProps) {
  const [session, setSession] = useState(initialSession);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingDelay, setPendingDelay] = useState<DelayInfo | null>(null);
  const [pendingResponse, setPendingResponse] = useState<Exchange | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [showCompletionCheck, setShowCompletionCheck] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [reviseMode, setReviseMode] = useState(false);
  const [newIntent, setNewIntent] = useState("");
  const [newCompletionCondition, setNewCompletionCondition] = useState("");
  const [debugMode, setDebugMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timings, setTimings] = useState<Map<number, Timing>>(new Map());
  const [loadingStarted, setLoadingStarted] = useState<number | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
  const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [session.exchanges]);

  // Show completion check at 60% budget
  useEffect(() => {
    const threshold = Math.floor(session.budget * 0.6);
    if (session.exchanges.length >= threshold && session.exchanges.length > 0) {
      setShowCompletionCheck(true);
    }
  }, [session.exchanges.length, session.budget]);

  const sendMessage = async (message: string, skipDelay: boolean = false) => {
    setLoading(true);
    setLoadingStarted(Date.now());

    try {
      const res = await fetch("/api/session/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, message, skipDelay }),
      });

      if (!res.ok) {
        const errBody = await res.json();
        console.error("Message error:", errBody);
        setError(errBody.error || `Server error: ${res.status}`);
        setLoading(false);
        setLoadingStarted(null);
        return;
      }
      setError(null);

      const data = await res.json();

      // Phase 1: Server returned delay info without making the Claude call.
      // Show delay screen; on completion, re-send with skipDelay=true.
      if (data.pendingDelay) {
        const delayData = data as PendingDelayResponse;
        setPendingDelay(delayData.delay);
        setPendingMessage(message);
        setLoading(false);
        setLoadingStarted(null);
        return;
      }

      // Phase 2 (or no-delay path): Full response with exchange
      const fullData = data as MessageResponse;

      // Store timing, rate limit, context usage
      if (fullData.timing) {
        setTimings((prev) => {
          const next = new Map(prev);
          next.set(fullData.exchange.index, fullData.timing);
          return next;
        });
      }
      if (fullData.rateLimit) setRateLimit(fullData.rateLimit);
      if (fullData.contextUsage) setContextUsage(fullData.contextUsage);

      applyExchange(fullData.exchange, fullData.sessionStatus);
    } catch (err) {
      console.error("Failed to send message:", err);
      setError(String(err));
    } finally {
      setLoading(false);
      setLoadingStarted(null);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const message = input.trim();
    setInput("");
    await sendMessage(message);
  };

  const applyExchange = useCallback((exchange: Exchange, status: string) => {
    setSession((prev) => {
      const updated = {
        ...prev,
        exchanges: [...prev.exchanges, exchange],
        status: status as Session["status"],
      };
      onSessionUpdate(updated);
      return updated;
    });
    setPendingDelay(null);
    setPendingResponse(null);
  }, [onSessionUpdate]);

  const handleDelayComplete = useCallback(() => {
    if (pendingMessage) {
      setPendingDelay(null);
      // Re-send the same message with skipDelay=true to get the actual response
      sendMessage(pendingMessage, true);
      setPendingMessage(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  const handleClose = async (completionMet: boolean) => {
    try {
      const res = await fetch("/api/session/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, completionMet }),
      });
      const data = await res.json();
      setSession(data.session);
      setSessionEnded(true);
      onSessionUpdate(data.session);
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  };

  const handleRevise = async () => {
    if (!newIntent.trim()) return;
    try {
      const res = await fetch("/api/session/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          newIntent: newIntent.trim(),
          newCompletionCondition: newCompletionCondition.trim() || undefined,
        }),
      });
      const data = await res.json();
      setSession(data);
      onSessionUpdate(data);
      setReviseMode(false);
      setNewIntent("");
      setNewCompletionCondition("");
    } catch (err) {
      console.error("Failed to revise:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (sessionEnded) {
    return (
      <div className="max-w-2xl w-full mx-auto p-6 text-center space-y-4">
        <h2 className="text-lg text-stone-400">Session Complete</h2>
        <p className="text-sm text-stone-500">
          {session.completionMet
            ? "Completion condition met."
            : "Session ended without meeting completion condition."}
        </p>
        <p className="text-sm text-stone-600">
          {session.exchanges.length} exchanges used of {session.budget} budget.
        </p>
        <p className="text-xs text-stone-700">
          Session logged to Obsidian vault.
        </p>
        <a
          href="/"
          className="inline-block mt-4 px-4 py-2 text-sm bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700"
        >
          New Session
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl w-full mx-auto flex flex-col h-screen">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-medium text-stone-500 uppercase tracking-wider">
            Viveka
          </h1>
          <BudgetMeter used={session.exchanges.length} total={session.budget} />
        </div>
        <div className="flex items-center gap-3">
          <LLMSettings />
          <span className="text-xs text-stone-600">
            {session.mode}
          </span>
          <button
            onClick={() => setShowContext(!showContext)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              showContext
                ? "border-blue-700 text-blue-400 bg-blue-950/30"
                : "border-stone-700 text-stone-600 hover:text-stone-400"
            }`}
          >
            ctx{(session.contextBlocks || []).length > 0
              ? ` (${(session.contextBlocks || []).filter((b) => b.enabled).length})`
              : ""}
          </button>
          <button
            onClick={() => setDebugMode(!debugMode)}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
              debugMode
                ? "border-amber-700 text-amber-400 bg-amber-950/30"
                : "border-stone-700 text-stone-600 hover:text-stone-400"
            }`}
          >
            debug
          </button>
        </div>
      </header>

      {/* Usage meters */}
      {(rateLimit || contextUsage) && (
        <div className="px-4 py-1.5 border-b border-stone-800/50">
          <UsageMeters rateLimit={rateLimit} contextUsage={contextUsage} />
        </div>
      )}

      {/* Intent bar */}
      <div className="px-4 py-2 border-b border-stone-800/50 text-xs text-stone-600">
        Intent: {session.intent}
      </div>

      {/* Context panel */}
      {showContext && (
        <ContextPanel
          sessionId={session.id}
          blocks={session.contextBlocks || []}
          onBlocksChange={(blocks) => {
            setSession((prev) => {
              const updated = { ...prev, contextBlocks: blocks };
              onSessionUpdate(updated);
              return updated;
            });
          }}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {session.exchanges.map((ex) => {
          const isExcluded = (session.excludedExchanges || []).includes(ex.index);
          return (
          <div key={ex.index} className={`space-y-2 ${isExcluded ? "opacity-40" : ""}`}>
            {/* User message */}
            <div className="flex gap-2">
              {debugMode && (
                <button
                  onClick={async () => {
                    await fetch("/api/context/exclude-exchange", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sessionId: session.id,
                        exchangeIndex: ex.index,
                        excluded: !isExcluded,
                      }),
                    });
                    setSession((prev) => {
                      const excl = prev.excludedExchanges || [];
                      const updated = {
                        ...prev,
                        excludedExchanges: isExcluded
                          ? excl.filter((i) => i !== ex.index)
                          : [...excl, ex.index],
                      };
                      onSessionUpdate(updated);
                      return updated;
                    });
                  }}
                  className={`text-xs mt-1 shrink-0 ${isExcluded ? "text-red-600" : "text-stone-700 hover:text-stone-400"}`}
                  title={isExcluded ? "Include in context" : "Exclude from context"}
                >
                  {isExcluded ? "x" : "o"}
                </button>
              )}
              <span className="text-xs text-stone-600 mt-1 shrink-0">USER</span>
              <div className="text-sm text-stone-300">
                {debugMode &&
                  ex.heuristicFlags.anthropomorphicMarkers.length > 0 && (
                    <HighlightedMessage
                      text={ex.userMessage}
                      markers={ex.heuristicFlags.anthropomorphicMarkers}
                    />
                  )}
                {(!debugMode ||
                  ex.heuristicFlags.anthropomorphicMarkers.length === 0) && (
                  <span>{ex.userMessage}</span>
                )}
              </div>
            </div>

            {/* System response */}
            <div className="flex gap-2">
              <span className="text-xs text-stone-600 mt-1 shrink-0">SYS</span>
              <div className="text-sm text-stone-400 whitespace-pre-wrap">
                {ex.systemResponse}
              </div>
            </div>

            {/* Pattern overlays */}
            <PatternOverlay
              heuristics={ex.heuristicFlags}
              classifier={ex.classifierFlags}
              intervention={ex.interventionShown}
            />

            {/* Debug info + timing */}
            {debugMode && (
              <div className="ml-10 text-xs text-stone-700 space-y-0.5">
                <div>
                  abstraction: L{ex.heuristicFlags.abstractionLevel} | loop:{" "}
                  {Math.round(ex.heuristicFlags.loopSimilarity * 100)}% | tangent:{" "}
                  {Math.round(ex.heuristicFlags.tangentDistance * 100)}%
                </div>
                {ex.classifierFlags && (
                  <div>
                    classifier: novelty {ex.classifierFlags.noveltyScore} |
                    completion {ex.classifierFlags.completionProximity} |{" "}
                    {ex.classifierFlags.reason}
                  </div>
                )}
                {timings.get(ex.index) && (
                  <TimingBar timing={timings.get(ex.index)!} />
                )}
              </div>
            )}
            {/* Always show timing summary (non-debug) */}
            {!debugMode && timings.get(ex.index) && (
              <div className="ml-10 text-xs text-stone-700">
                {formatMs(timings.get(ex.index)!.total_ms)} total
              </div>
            )}
          </div>
          );
        })}

        {loading && (
          <div className="flex gap-2">
            <span className="text-xs text-stone-600 mt-1">SYS</span>
            <span className="text-sm text-stone-600 animate-pulse">
              Processing...
            </span>
            {loadingStarted && <ElapsedTimer start={loadingStarted} />}
          </div>
        )}

        {error && (
          <div className="p-3 rounded border border-red-800 bg-red-950/30 text-xs text-red-400">
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Completion check */}
      {showCompletionCheck && !reviseMode && (
        <div className="px-4">
          <CompletionCheck
            completionCondition={session.completionCondition}
            onComplete={() => handleClose(true)}
            onNotYet={() => setShowCompletionCheck(false)}
            onRevise={() => {
              setReviseMode(true);
              setShowCompletionCheck(false);
            }}
          />
        </div>
      )}

      {/* Revise intent */}
      {reviseMode && (
        <div className="px-4 py-3 border-t border-stone-800 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newIntent}
              onChange={(e) => setNewIntent(e.target.value)}
              placeholder="New session intent (costs 1 exchange)"
              className="flex-1 bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            />
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCompletionCondition}
              onChange={(e) => setNewCompletionCondition(e.target.value)}
              placeholder="New completion condition (optional)"
              className="flex-1 bg-stone-800 border border-stone-600 rounded px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500"
            />
            <button
              onClick={handleRevise}
              className="px-3 py-1.5 text-xs bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700"
            >
              Revise
            </button>
            <button
              onClick={() => { setReviseMode(false); setNewCompletionCondition(""); }}
              className="px-3 py-1.5 text-xs text-stone-600 hover:text-stone-400"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3 border-t border-stone-800">
        <div className="flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            rows={1}
            disabled={loading}
            className="flex-1 bg-stone-800 border border-stone-600 rounded px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:border-stone-500 resize-none disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-4 py-2 text-sm bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700 transition-colors disabled:opacity-50"
          >
            Send
          </button>
        </div>
        <div className="flex justify-between mt-2">
          <button
            onClick={() => handleClose(false)}
            className="text-xs text-stone-700 hover:text-stone-500"
          >
            End session
          </button>
          <span className="text-xs text-stone-700">
            {session.exchanges.length}/{session.budget} exchanges
          </span>
        </div>
      </div>

      {/* Delay screen overlay */}
      {pendingDelay && pendingDelay.delayMs > 0 && (
        <DelayScreen
          delayMs={pendingDelay.delayMs}
          message={pendingDelay.message}
          requiresConfirmation={pendingDelay.requiresConfirmation}
          onComplete={handleDelayComplete}
          onCancel={() => {
            setPendingDelay(null);
            setPendingResponse(null);
          }}
        />
      )}
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Live elapsed timer shown while waiting
function ElapsedTimer({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - start);
    }, 100);
    return () => clearInterval(interval);
  }, [start]);

  return (
    <span className="text-xs text-stone-600 tabular-nums ml-2 mt-0.5">
      {formatMs(elapsed)}
    </span>
  );
}

// Visual timing breakdown bar
function TimingBar({ timing }: { timing: Timing }) {
  const total = timing.total_ms || 1;
  const segments = [
    { label: "heuristics", ms: timing.heuristics_ms, color: "bg-blue-700" },
    { label: "claude", ms: timing.claude_ms, color: "bg-emerald-700" },
    ...(timing.classifier_ms
      ? [{ label: "classifier", ms: timing.classifier_ms, color: "bg-amber-700" }]
      : []),
    { label: "store", ms: timing.store_ms, color: "bg-stone-600" },
  ];

  return (
    <div className="space-y-1 mt-1">
      {/* Bar */}
      <div className="flex h-2 rounded overflow-hidden w-full">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={`${seg.color} transition-all`}
            style={{ width: `${Math.max((seg.ms / total) * 100, 1)}%` }}
            title={`${seg.label}: ${formatMs(seg.ms)}`}
          />
        ))}
      </div>
      {/* Labels */}
      <div className="flex gap-3 flex-wrap">
        {segments.map((seg) => (
          <span key={seg.label} className="flex items-center gap-1">
            <span className={`inline-block w-2 h-2 rounded-sm ${seg.color}`} />
            {seg.label}: {formatMs(seg.ms)}
          </span>
        ))}
        <span className="text-stone-500">total: {formatMs(timing.total_ms)}</span>
      </div>
    </div>
  );
}

// Debug mode: highlights anthropomorphic markers in user messages
function HighlightedMessage({
  text,
  markers,
}: {
  text: string;
  markers: string[];
}) {
  if (markers.length === 0) return <span>{text}</span>;

  const pattern = new RegExp(
    `(${markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );

  const parts = text.split(pattern);

  return (
    <span>
      {parts.map((part, i) => {
        const isMarker = markers.some(
          (m) => m.toLowerCase() === part.toLowerCase()
        );
        return isMarker ? (
          <span
            key={i}
            className="underline decoration-amber-500 decoration-wavy underline-offset-2"
            title="Anthropomorphic framing detected"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        );
      })}
    </span>
  );
}
