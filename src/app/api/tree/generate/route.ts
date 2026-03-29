import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import {
  addPendingNodes,
  selectNode,
  updateNodeContent,
  getConversationHistory,
} from "@/lib/tree";
import { queryClaudeCode } from "@/lib/claude";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { Session } from "@/lib/types";

/**
 * Generate N assistant completions for a given parent node.
 * Fires N parallel claude -p calls and returns immediately with pending node IDs.
 * Completions fill in lazily (poll /api/tree/get to see updates).
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { treeId, parentId, count } = body as {
    treeId: string;
    parentId: string;
    count?: number;
  };

  const tree = getTree(treeId);
  if (!tree) return NextResponse.json({ error: "Tree not found" }, { status: 404 });

  const parent = tree.nodes[parentId];
  if (!parent) return NextResponse.json({ error: "Parent node not found" }, { status: 404 });

  const n = count ?? tree.settings.rerollCount;

  // Create pending nodes
  const pendingNodes = addPendingNodes(tree, parentId, "assistant", "ai-completion", n);
  saveTree(tree);

  // Build conversation history from active path up to parentId
  // First, temporarily select the parent to get the right path
  selectNode(tree, parentId);
  const history = getConversationHistory(tree);

  // Build a stub session for the system prompt builder
  const stubSession: Session = {
    id: tree.id,
    createdAt: tree.createdAt,
    intent: tree.intent,
    completionCondition: tree.completionCondition,
    mode: tree.mode as Session["mode"],
    budget: 999,
    exchanges: [],
    status: "active",
    completionMet: null,
    contextBlocks: [],
    excludedExchanges: [],
  };
  const systemPrompt = buildSystemPrompt(stubSession);
  const model = tree.settings.model || process.env.VIVEKA_MODEL || "sonnet";

  // The parent node's content is the latest user message
  const userMessage = parent.role === "user" ? parent.content : "";

  // Fire N parallel completions
  const nodeIds = pendingNodes.map((n) => n.id);

  // Don't await — let them run in background
  Promise.all(
    pendingNodes.map(async (pendingNode) => {
      try {
        const response = await queryClaudeCode(
          userMessage,
          systemPrompt,
          // Don't include the last user message in history since it's the prompt
          history.slice(0, -1),
          { model, noTools: true }
        );

        const freshTree = getTree(treeId);
        if (freshTree) {
          updateNodeContent(freshTree, pendingNode.id, response.text, "complete");
          freshTree.nodes[pendingNode.id].model = model;
          saveTree(freshTree);
        }
      } catch (err) {
        const freshTree = getTree(treeId);
        if (freshTree && freshTree.nodes[pendingNode.id]) {
          freshTree.nodes[pendingNode.id].status = "error";
          freshTree.nodes[pendingNode.id].error =
            err instanceof Error ? err.message : String(err);
          saveTree(freshTree);
        }
      }
    })
  ).then(() => {
    console.log(`[viveka-loom] ${n} completions done for ${parentId}`);
  });

  // Return immediately with the pending node IDs
  return NextResponse.json({
    nodeIds,
    status: "generating",
    message: `${n} completions started`,
  });
}
