import { Injectable } from "@nestjs/common";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

const workflowState = Annotation.Root({
  checkpoint: Annotation<"planner" | "inspector" | "approval" | "executor" | "tester" | "reviewer" | "done">(),
  requireApproval: Annotation<boolean>(),
  next: Annotation<string>()
});

/**
 * LangGraph owns only graph routing. Node effects stay in WorkflowsService,
 * which delegates every filesystem and command operation to WorkspaceService.
 */
@Injectable()
export class LangGraphWorkflowEngine {
  private readonly graph = new StateGraph(workflowState)
    .addNode("route", (state) => ({ next: nextNode(state.checkpoint, state.requireApproval) }))
    .addEdge(START, "route")
    .addEdge("route", END)
    .compile({ name: "sp-agent-code-workflow-router" });

  async next(checkpoint: "planner" | "inspector" | "approval" | "executor" | "tester" | "reviewer", requireApproval: boolean) {
    const state = await this.graph.invoke({ checkpoint, requireApproval, next: "" });
    return state.next as "inspector" | "approval" | "executor" | "tester" | "reviewer" | "done";
  }
}

function nextNode(checkpoint: string, requireApproval: boolean) {
  if (checkpoint === "planner") return "inspector";
  if (checkpoint === "inspector") return requireApproval ? "approval" : "executor";
  if (checkpoint === "approval") return "executor";
  if (checkpoint === "executor") return "tester";
  if (checkpoint === "tester") return "reviewer";
  return "done";
}
