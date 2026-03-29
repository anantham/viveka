"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import ChatInterface from "@/components/ChatInterface";
import { Session } from "@/lib/types";

export default function SessionPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // We need to fetch the session from the server.
    // Since the session store is in-memory on the server, we use the
    // session data that was returned when we created it.
    // For now, we'll store it in sessionStorage on creation and read it here.
    const stored = sessionStorage.getItem(`viveka-session-${sessionId}`);
    if (stored) {
      setSession(JSON.parse(stored));
    } else {
      setError("Session not found. It may have been lost on page refresh.");
    }
  }, [sessionId]);

  const handleSessionUpdate = useCallback((updated: Session) => {
    setSession(updated);
    sessionStorage.setItem(
      `viveka-session-${updated.id}`,
      JSON.stringify(updated)
    );
  }, []);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-red-400">{error}</p>
          <a
            href="/"
            className="inline-block px-4 py-2 text-sm bg-stone-800 border border-stone-600 rounded text-stone-300 hover:bg-stone-700"
          >
            New Session
          </a>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-sm text-stone-600 animate-pulse">Loading session...</p>
      </main>
    );
  }

  return <ChatInterface session={session} onSessionUpdate={handleSessionUpdate} />;
}
