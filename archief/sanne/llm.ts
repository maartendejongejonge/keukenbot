// Anthropic Messages API client met tool-use loop en model-fallback.

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

export type Msg = { role: "user" | "assistant"; content: unknown };

const FALLBACK_MODELS = [
  Deno.env.get("ANTHROPIC_MODEL") ?? "",
  "claude-sonnet-4-5",
  "claude-sonnet-4-5-20250929",
  "claude-3-7-sonnet-latest",
  "claude-3-5-sonnet-latest",
].filter(Boolean);

let workingModel: string | null = null;

export async function callAnthropic(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY ontbreekt");

  const models = workingModel ? [workingModel, ...FALLBACK_MODELS.filter((m) => m !== workingModel)] : FALLBACK_MODELS;
  let lastErr = "";

  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...payload, model }),
      });
      if (res.ok) {
        workingModel = model;
        return await res.json();
      }
      const errText = await res.text();
      lastErr = `${res.status} ${errText}`;
      const isModelIssue = res.status === 404 || errText.includes("not_found_error") || errText.includes("model");
      if (isModelIssue) break;                    // volgend model proberen
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;                                  // retry
      }
      throw new Error(`Anthropic fout: ${lastErr}`);
    }
  }
  throw new Error(`Anthropic fout (alle modellen): ${lastErr}`);
}

export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<unknown>;

export type AgentResult = {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown>; result: unknown }[];
};

/**
 * Draait een volledige tool-use loop en geeft de uiteindelijke tekst terug.
 */
export async function runAgent(opts: {
  system: string;
  messages: Msg[];
  tools: AnthropicTool[];
  execute: ToolExecutor;
  maxTurns?: number;
  maxTokens?: number;
}): Promise<AgentResult> {
  const messages: Msg[] = [...opts.messages];
  const toolCalls: AgentResult["toolCalls"] = [];
  const maxTurns = opts.maxTurns ?? 6;

  for (let turn = 0; turn < maxTurns; turn++) {
    const data = await callAnthropic({
      max_tokens: opts.maxTokens ?? 1400,
      system: opts.system,
      tools: opts.tools,
      messages,
    }) as { content?: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[]; stop_reason?: string };

    const content = data.content ?? [];
    const textParts = content.filter((c) => c.type === "text").map((c) => c.text ?? "");
    const toolUses = content.filter((c) => c.type === "tool_use");

    if (toolUses.length === 0) {
      return { text: textParts.join("\n").trim(), toolCalls };
    }

    messages.push({ role: "assistant", content });

    const results: unknown[] = [];
    for (const tu of toolUses) {
      let result: unknown;
      try {
        result = await opts.execute(tu.name!, tu.input ?? {});
      } catch (e) {
        result = { fout: String(e) };
      }
      toolCalls.push({ name: tu.name!, input: tu.input ?? {}, result });
      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { text: "", toolCalls };
}
