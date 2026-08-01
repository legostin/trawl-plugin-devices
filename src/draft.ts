/**
 * A scenario an agent worked out, put in front of the person before it becomes
 * a file. Writing to the workspace something nobody has read is how a folder
 * fills with scenarios of unknown provenance.
 *
 * The same shape the http-client plugin uses to hand a request to its panel: a
 * value plus subscribers, because the MCP tool and the panel live in one webview
 * but never see each other directly.
 */

export interface Draft {
  code: string;
  /** What the agent was asked for, so the panel can say why this appeared. */
  note?: string;
  /** Where it means to be saved, if the agent had an opinion. */
  suggestedPath?: string;
}

let pending: Draft | null = null;
const listeners = new Set<(draft: Draft) => void>();

export function proposeDraft(draft: Draft): void {
  pending = draft;
  listeners.forEach((notify) => notify(draft));
}

/** Consumed on mount: a draft proposed while the panel was closed is not lost. */
export function consumeDraft(): Draft | null {
  const draft = pending;
  pending = null;
  return draft;
}

export function subscribeDraft(listener: (draft: Draft) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
