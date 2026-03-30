import { NextRequest, NextResponse } from "next/server";
import { getTree, saveTree } from "@/lib/tree-store";
import {
  addPendingNodes,
  selectNode,
  getConversationHistory,
  updateNodeContent,
} from "@/lib/tree";
import { queryClaudeCode } from "@/lib/claude";

/**
 * Generate N draft user replies.
 * The AI suggests what the user might say next.
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

  const n = count ?? tree.settings.draftCount;

  // Create pending user draft nodes
  const pendingNodes = addPendingNodes(tree, parentId, "user", "ai-draft", n);
  saveTree(tree);

  // Build conversation history
  selectNode(tree, parentId);
  const history = getConversationHistory(tree);

  const model = tree.settings.model || process.env.VIVEKA_MODEL || "sonnet";
  const nodeIds = pendingNodes.map((nd) => nd.id);

  // Fire N parallel draft generations
  Promise.all(
    pendingNodes.map(async (pendingNode, i) => {
      const draftPrompt = `Given this conversation, suggest what the user might say next. This is draft ${i + 1} of ${n} — each draft should explore a DIFFERENT direction or angle. The session intent is: "${tree.intent}".

Return ONLY the suggested user message, nothing else. No quotes, no explanation, no "The user might say:" prefix. Just the raw message text as if the user typed it.`;

      const startedAt = new Date().toISOString();
      const startMs = Date.now();
      try {
        const response = await queryClaudeCode(
          draftPrompt,
          "You generate diverse draft user messages for conversations. Each draft should be distinct in approach, tone, or direction. Output only the draft message text.",
          history,
          { model, noTools: true }
        );

        const durationMs = Date.now() - startMs;
        const freshTree = getTree(treeId);
        if (freshTree) {
          updateNodeContent(freshTree, pendingNode.id, response.text, "complete");
          freshTree.nodes[pendingNode.id].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          saveTree(freshTree);
          console.log(`[viveka-loom] draft ${pendingNode.id.slice(0, 8)} done in ${durationMs}ms`);
        }
      } catch (err) {
        const durationMs = Date.now() - startMs;
        const freshTree = getTree(treeId);
        if (freshTree && freshTree.nodes[pendingNode.id]) {
          freshTree.nodes[pendingNode.id].status = "error";
          freshTree.nodes[pendingNode.id].error =
            err instanceof Error ? err.message : String(err);
          freshTree.nodes[pendingNode.id].timing = {
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs,
          };
          saveTree(freshTree);
        }
      }
    })
  ).then(() => {
    console.log(`[viveka-loom] ${n} user drafts done for ${parentId}`);
  });

  return NextResponse.json({
    nodeIds,
    status: "generating",
    message: `${n} drafts started`,
  });
}
