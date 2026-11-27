import { supportedModels } from '@mozaik-ai/core';

// Gemini 3 models return a `thoughtSignature` with every function call and require it back
// when that call is sent again as part of the conversation. @mozaik-ai/core 6.0.0 drops it,
// so the second model call of any loop that uses tools fails with
//   HTTP 400 "Function call is missing a thought_signature in functionCall parts".
// This patch remembers each signature the model returns and puts it back on the replayed call.
// Remove it once Mozaik keeps thought signatures itself.

/** Google's documented placeholder for a function call whose signature is not known. */
const UNKNOWN_SIGNATURE = 'skip_thought_signature_validator';

interface FunctionCallPart {
  functionCall?: { id?: string; name?: string; args?: unknown };
  thoughtSignature?: string;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: FunctionCallPart[] } }[];
}

interface GeminiMapper {
  toResponse(response: GeminiResponse): unknown;
  addPart(contents: unknown[], role: string, part: FunctionCallPart): void;
}

const patched = new WeakSet<object>();
const signatures = new Map<string, string>();

// Mozaik writes the call back with the same id, name and args it read, so either one finds it.
function keyOf(call: NonNullable<FunctionCallPart['functionCall']>): string {
  return call.id ? `id:${call.id}` : `call:${call.name}:${JSON.stringify(call.args ?? {})}`;
}

/** Patches every Gemini endpoint Mozaik knows. Safe to call more than once. */
export function preserveGeminiThoughtSignatures(): void {
  for (const model of supportedModels) {
    if (model.specification.provider !== 'google') continue;
    const mapper = (model.endpoint as unknown as { endpointMapper?: GeminiMapper }).endpointMapper;
    if (!mapper || patched.has(mapper)) continue;
    patched.add(mapper);

    const toResponse = mapper.toResponse.bind(mapper);
    mapper.toResponse = (response) => {
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.functionCall && part.thoughtSignature) {
          signatures.set(keyOf(part.functionCall), part.thoughtSignature);
        }
      }
      return toResponse(response);
    };

    const addPart = mapper.addPart.bind(mapper);
    mapper.addPart = (contents, role, part) => {
      if (part.functionCall && !part.thoughtSignature) {
        const thoughtSignature = signatures.get(keyOf(part.functionCall)) ?? UNKNOWN_SIGNATURE;
        addPart(contents, role, { ...part, thoughtSignature });
        return;
      }
      addPart(contents, role, part);
    };
  }
}
