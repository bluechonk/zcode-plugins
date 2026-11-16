/**
 * ZCode 的 provider 配置：审查请求必须复用「当前会话实际在用的那套」。
 *
 * 为什么不能自己拼默认值：provider 是两个独立配置空间——同一个模型名在
 * longcat 官方与本机网关下是不同的接入点。插件曾硬编码 `127.0.0.1:4412`，
 * 于是会话跑 longcat 时审查请求被发进网关，网关只认自己的模型清单，
 * 直接 400；而插件把 400 当传输错误静默放行，故障藏了十几天。
 *
 * 配置源：`~/.zcode/v2/provider_config.json`（ZCode 自己维护，schemaVersion 1）。
 * 只读，不写；apiKey 只进请求头，不打印、不落盘。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface ProviderRule {
  providerId?: string;
  providerName?: string;
  config?: {
    api?: { type?: string; baseUrl?: string };
    access?: { type?: string; apiKey?: string };
  };
}

interface ProviderConfigFile {
  schemaVersion?: number;
  config?: { providerConfigRules?: { providerRules?: ProviderRule[] } };
}

const PROVIDER_CONFIG = join(homedir(), ".zcode", "v2", "provider_config.json");

export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}

/** 读某个 provider 的接入点；配置缺失或不完整时返回 null（调用方不得回落） */
export function providerEndpoint(providerId: string): ProviderEndpoint | null {
  if (!providerId) return null;
  try {
    const parsed = JSON.parse(readFileSync(PROVIDER_CONFIG, "utf8")) as ProviderConfigFile;
    const rules = parsed.config?.providerConfigRules?.providerRules ?? [];
    const rule = rules.find((r) => r.providerId === providerId);
    const api = rule?.config?.api;
    const access = rule?.config?.access;
    if (!api?.baseUrl || api.type !== "openai-chat-completions") return null;
    // 只支持 api-key 这一种接入；oauth 等类型没有可直接复用的静态密钥
    if (access?.type !== "api-key" || !access.apiKey) return null;
    return { baseUrl: api.baseUrl.replace(/\/+$/, ""), apiKey: access.apiKey };
  } catch {
    // 配置文件不可读：当作没有配置，调用方跳过审查而不是瞎发
    return null;
  }
}
