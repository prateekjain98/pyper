import type { LanguageModel } from "ai";
import type { TinfoilAI } from "tinfoil";
import { refreshTinfoilModels } from "../../models/tinfoilModels";

type TinfoilModule = typeof import("tinfoil");
type TinfoilAISDKProvider = Awaited<ReturnType<TinfoilModule["createTinfoilAI"]>>;

let tinfoilModulePromise: Promise<TinfoilModule> | null = null;

const chatClientCache = new Map<string, Promise<TinfoilAI>>();
const aiSdkProviderCache = new Map<string, Promise<TinfoilAISDKProvider>>();

function loadTinfoil(): Promise<TinfoilModule> {
  if (!tinfoilModulePromise) {
    // Don't cache a failed import — the next call should retry.
    tinfoilModulePromise = import("tinfoil").catch((error) => {
      tinfoilModulePromise = null;
      throw error;
    });
  }
  return tinfoilModulePromise;
}

function normalizeApiKey(apiKey: string): string {
  const key = apiKey?.trim() || "";
  if (!key) {
    throw new Error("Tinfoil API key not configured");
  }
  return key;
}

/** Tinfoil adds and retires models often; sync the registry in the background. */
function syncTinfoilCatalog(): void {
  void refreshTinfoilModels().catch(() => {});
}

export async function getTinfoilChatClient(apiKey: string): Promise<TinfoilAI> {
  const key = normalizeApiKey(apiKey);
  syncTinfoilCatalog();
  const cached = chatClientCache.get(key);
  if (cached) return cached;

  const clientPromise = loadTinfoil()
    .then(({ TinfoilAI }) => {
      return new TinfoilAI({
        apiKey: key,
        dangerouslyAllowBrowser: true,
      });
    })
    .catch((error) => {
      chatClientCache.delete(key);
      throw error;
    });
  chatClientCache.set(key, clientPromise);
  return clientPromise;
}

async function getTinfoilAISDKProvider(apiKey: string): Promise<TinfoilAISDKProvider> {
  const key = normalizeApiKey(apiKey);
  syncTinfoilCatalog();
  const cached = aiSdkProviderCache.get(key);
  if (cached) return cached;

  const providerPromise = loadTinfoil()
    .then(({ createTinfoilAI }) => createTinfoilAI(key))
    .catch((error) => {
      aiSdkProviderCache.delete(key);
      throw error;
    });
  aiSdkProviderCache.set(key, providerPromise);
  return providerPromise;
}

export async function getTinfoilLanguageModel(
  apiKey: string,
  model: string
): Promise<LanguageModel> {
  const provider = await getTinfoilAISDKProvider(apiKey);
  // `@ai-sdk/openai-compatible` (returned by tinfoil's createTinfoilAI) resolves
  // its own nested `@ai-sdk/provider@4` and hands back a LanguageModelV4, while
  // this app is on `ai@6` / `@ai-sdk/provider@3` (LanguageModelV2/V3). The object
  // is structurally an AI-SDK language model; bridge the provider-spec-version
  // skew here (this is a compile-time cast only — the runtime model is unchanged).
  // TODO: realign the AI SDK versions (upgrade `ai` to v7, or pin
  // `@ai-sdk/openai-compatible` to a v3-provider release) and drop this cast.
  return provider(model) as unknown as LanguageModel;
}

export function clearTinfoilClientCache(): void {
  chatClientCache.clear();
  aiSdkProviderCache.clear();
}
