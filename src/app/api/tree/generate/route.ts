import { NextRequest, NextResponse } from "next/server";
import { getWorkspace, saveWorkspace } from "@/lib/workspace-store";
import {
  addFragment,
  addEdge,
  appendToSequence,
  updateFragmentContent,
  getConversationHistory,
} from "@/lib/workspace";
import { queryClaudeCode } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { Session } from "@/lib/types";

/**
 * Generate N assistant completions for a given parent fragment.
 *
 * Default mode (ephemeral=false): fires N parallel LLM calls and returns
 * immediately with pending fragment IDs that fill in lazily as each
 * completion arrives. Caller polls /api/tree/get for updates.
 *
 * Ephemeral mode (ephemeral=true): waits for all N parallel completions
 * to finish, returns just the alternative continuation strings — no
 * fragments are created. The frontend renders alternatives inline and
 * commits the chosen one via /api/tree/append-child. This is the
 * "in-place extend preview" pattern, mirror of reroll-phrase ephemeral.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, parentId, count, userMessage, ephemeral } = body as {
    treeId: string;
    parentId: string;
    count?: number;
    userMessage?: string;
    ephemeral?: boolean;
  };

  console.log(`[generate] request: treeId=${treeId?.slice(0, 8)} parentId=${parentId?.slice(0, 8)} count=${count} userMsg=${userMessage ? userMessage.slice(0, 50) + "..." : "none"} ephemeral=${ephemeral ?? false}`);

  const ws = getWorkspace(treeId);
  if (!ws) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  // If userMessage provided, create user fragment first
  let actualParentId = parentId;
  if (userMessage) {
    const userFrag = addFragment(ws, userMessage, { type: "human-typed" });
    addEdge(ws, parentId, userFrag.id, "responded-to");
    appendToSequence(ws, userFrag.id);
    actualParentId = userFrag.id;
    saveWorkspace(ws);
  }

  const parentFrag = ws.fragments[actualParentId];
  if (!parentFrag) return NextResponse.json({ error: "Parent not found" }, { status: 404 });

  const n = count ?? ws.settings.rerollCount;

  // Create pending fragments
  const pendingFragments: string[] = [];
  for (let i = 0; i < n; i++) {
    const f = addFragment(ws, "", { type: "ai-generated", model: ws.settings.model }, "generating");
    addEdge(ws, actualParentId, f.id, "responded-to");
    pendingFragments.push(f.id);
  }
  saveWorkspace(ws);

  // Build context
  const history = getConversationHistory(ws);
  const stubSession: Session = {
    id: ws.id,
    createdAt: ws.createdAt,
    intent: ws.intent,
    completionCondition: ws.completionCondition,
    mode: ws.mode as Session["mode"],
    budget: 999,
    exchanges: [],
    status: "active",
    completionMet: null,
    contextBlocks: [],
    excludedExchanges: [],
    interventionLog: [],
  };
  const systemPrompt = buildSystemPrompt(stubSession);
  const model = ws.settings.model || process.env.VIVEKA_MODEL || "sonnet";
  const isAssistantFragment = parentFrag.provenance.type === "ai-generated";
  const isLastSequenceFragment = ws.sequence[ws.sequence.length - 1] === actualParentId;

  let promptMessage = parentFrag.content;
  let modelHistory = history;

  if (isLastSequenceFragment && !isAssistantFragment) {
    // Preserve the normal chat flow when the selected fragment is the latest user-side turn.
    promptMessage = parentFrag.content;
    modelHistory = history.slice(0, -1);
  } else if (isLastSequenceFragment && isAssistantFragment) {
    // When extending the latest assistant fragment, keep it in history and ask for a direct continuation.
    promptMessage = "Continue directly from the assistant fragment above. Do not restart or answer a new user turn.";
  } else {
    const task = isAssistantFragment
      ? "Continue and elaborate the selected fragment using the current workspace context."
      : "Respond to or continue from the selected fragment using the current workspace context.";
    promptMessage = `${task}\n\nSelected fragment:\n${parentFrag.content}`;
  }

  const historyTokenEst = modelHistory.reduce((s, h) => s + h.content.length, 0);
  console.log(`[generate] firing ${n} parallel completions | model=${model} | history=${modelHistory.length} msgs (~${historyTokenEst} chars) | prompt="${promptMessage.slice(0, 80)}..."`);

  // Ephemeral path: wait for all completions, return strings, NO fragments created.
  if (ephemeral) {
    // Roll back the pending fragments we eagerly added — in ephemeral mode
    // we don't want them to persist.
    const freshWs = getWorkspace(treeId);
    if (freshWs) {
      for (const fragId of pendingFragments) {
        delete freshWs.fragments[fragId];
      }
      freshWs.edges = freshWs.edges.filter(
        (e) => !pendingFragments.includes(e.from) && !pendingFragments.includes(e.to)
      );
      saveWorkspace(freshWs);
    }

    const results = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        const startMs = Date.now();
        try {
          const response = await queryClaudeCode(
            promptMessage,
            systemPrompt,
            modelHistory,
            { model, noTools: true }
          );
          console.log(`[generate ephemeral] alt ${i + 1}/${n} done in ${Date.now() - startMs}ms (${response.text.length} chars)`);
          return response.text.trim();
        } catch (err) {
          console.error(`[generate ephemeral] alt ${i + 1}/${n} failed:`, err);
          return null;
        }
      })
    );
    const alternatives = Array.from(
      new Set(
        results
          .filter((r): r is string => !!r && r.length > 0)
      )
    );
    console.log(`[generate ephemeral] returning ${alternatives.length} alternatives`);
    return NextResponse.json({
      alternatives,
      status: "complete",
      message: `${alternatives.length} continuations`,
    });
  }

  // Persisted path: fire N parallel completions (don't await), fragments fill in lazily.
  Promise.all(
    pendingFragments.map(async (fragId, i) => {
      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      console.log(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) starting...`);
      try {
        const response = await queryClaudeCode(
          promptMessage,
          systemPrompt,
          modelHistory,
          { model, noTools: true }
        );

        const durationMs = Date.now() - startMs;
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          updateFragmentContent(freshWs, fragId, response.text);
          freshWs.fragments[fragId].provenance.model = model;
          freshWs.fragments[fragId].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          // Add first successful completion to sequence
          const anyInSeq = pendingFragments.some((pid) => freshWs.sequence.includes(pid));
          if (!anyInSeq) {
            appendToSequence(freshWs, fragId);
          }
          saveWorkspace(freshWs);
          console.log(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) DONE in ${durationMs}ms | ${response.text.length} chars | tokens: in=${response.usage?.inputTokens ?? "?"} out=${response.usage?.outputTokens ?? "?"}`);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        console.error(`[generate] completion ${i + 1}/${n} (${fragId.slice(0, 8)}) FAILED in ${durationMs}ms:`, err instanceof Error ? err.message : err);
        const freshWs = getWorkspace(treeId);
        if (freshWs && freshWs.fragments[fragId]) {
          freshWs.fragments[fragId].status = "error";
          freshWs.fragments[fragId].error = err instanceof Error ? err.message : String(err);
          freshWs.fragments[fragId].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          saveWorkspace(freshWs);
        }
      }
    })
  ).then(() => {
    console.log(`[generate] all ${n} completions finished for parent ${actualParentId.slice(0, 8)}`);
  });

  return NextResponse.json({
    nodeIds: pendingFragments,
    status: "generating",
    message: `${n} completions started`,
  });
}
