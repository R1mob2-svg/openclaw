// OpenAI-compatible `/v1/models` HTTP route backed by configured OpenClaw agents.
import type { IncomingMessage, ServerResponse } from "node:http";
import { listAgentIds, resolveAgentEffectiveModelPrimary, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveConfiguredNeoDeepSeekContext } from "./neo-deepseek-context.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getRuntimeConfig } from "../config/io.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import {
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
  sendMissingScopeForbidden,
} from "./http-common.js";
import {
  OPENCLAW_DEFAULT_MODEL_ID,
  OPENCLAW_MODEL_ID,
  authorizeGatewayHttpRequestOrReply,
  type AuthorizedGatewayHttpRequest,
  resolveAgentIdFromModel,
  resolveOpenAiCompatibleHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

type OpenAiModelsHttpOptions = {
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  allowRealIpFallback?: boolean;
  rateLimiter?: AuthRateLimiter;
};

type OpenAiModelObject = {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
  permission: [];
  context_window?: number;
  underlying_model?: string;
};

function toOpenAiModel(id: string, cfg: OpenClawConfig): OpenAiModelObject {
  const agentId = resolveAgentIdFromModel(id) || resolveDefaultAgentId(cfg);
  const ref = resolveAgentEffectiveModelPrimary(cfg, agentId);
  const slash = typeof ref === "string" ? ref.indexOf("/") : -1;
  const provider = slash > 0 ? ref.slice(0, slash) : "";
  const model = slash > 0 ? ref.slice(slash + 1) : "";
  const context = resolveConfiguredNeoDeepSeekContext({ cfg, provider, model });
  return {
    id,
    object: "model",
    created: 0,
    owned_by: "openclaw",
    permission: [],
    ...(context ? { context_window: context, underlying_model: ref } : {}),
  };
}

async function authorizeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OpenAiModelsHttpOptions,
): Promise<AuthorizedGatewayHttpRequest | null> {
  return await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
}

function loadAgentModelIds(): string[] {
  const cfg = getRuntimeConfig();
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const ids = new Set<string>([OPENCLAW_MODEL_ID, OPENCLAW_DEFAULT_MODEL_ID]);
  ids.add(`openclaw/${defaultAgentId}`);
  for (const agentId of listAgentIds(cfg)) {
    ids.add(`openclaw/${agentId}`);
  }
  return Array.from(ids);
}

function resolveRequestPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

/** Handle OpenAI-compatible model list/detail requests, returning false for unrelated paths. */
export async function handleOpenAiModelsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: OpenAiModelsHttpOptions,
): Promise<boolean> {
  const requestPath = resolveRequestPath(req);
  if (requestPath !== "/v1/models" && !requestPath.startsWith("/v1/models/")) {
    return false;
  }

  if (req.method !== "GET") {
    sendMethodNotAllowed(res, "GET");
    return true;
  }

  const requestAuth = await authorizeRequest(req, res, opts);
  if (!requestAuth) {
    return true;
  }

  const requestedScopes = resolveOpenAiCompatibleHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("models.list", requestedScopes);
  if (!scopeAuth.allowed) {
    sendMissingScopeForbidden(res, scopeAuth.missingScope);
    return true;
  }

  const ids = loadAgentModelIds();
  const cfg = getRuntimeConfig();
  if (requestPath === "/v1/models") {
    sendJson(res, 200, {
      object: "list",
      data: ids.map((id) => toOpenAiModel(id, cfg)),
    });
    return true;
  }

  const encodedId = requestPath.slice("/v1/models/".length);
  if (!encodedId) {
    sendInvalidRequest(res, "Missing model id.");
    return true;
  }

  let decodedId: string;
  try {
    decodedId = decodeURIComponent(encodedId);
  } catch {
    sendInvalidRequest(res, "Invalid model id encoding.");
    return true;
  }

  if (decodedId !== OPENCLAW_MODEL_ID && !resolveAgentIdFromModel(decodedId)) {
    sendInvalidRequest(res, "Invalid model id.");
    return true;
  }

  if (!ids.includes(decodedId)) {
    sendJson(res, 404, {
      error: {
        message: `Model '${decodedId}' not found.`,
        type: "invalid_request_error",
      },
    });
    return true;
  }

  sendJson(res, 200, toOpenAiModel(decodedId, cfg));
  return true;
}
