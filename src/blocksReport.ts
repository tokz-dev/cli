import Table from "cli-table3";
import pc from "picocolors";
import { burnRate, maxBlockTokens, type Block } from "./blocks.js";
import { compact, shortModel, usd } from "./format.js";

export function fmtMs(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function fmtStart(ms: number): string {
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function renderBlocksReport(
  blocks: Block[],
  opts?: { tokenLimit?: number | "max"; now?: number },
): string {
  if (blocks.length === 0) return "No Claude Code activity found.";
  const now = opts?.now ?? Date.now();
  const limit = opts?.tokenLimit === "max" ? maxBlockTokens(blocks) : opts?.tokenLimit;

  const parts: string[] = [];
  parts.push(
    pc.bold(`tokz blocks — ${blocks.length} × 5-hour billing windows`) +
      pc.dim("  (Claude usage limits reset per rolling 5h block)"),
  );

  const table = new Table({ head: ["Block start", "Status", "Models", "Tokens", "Cost"] });
  for (const b of blocks) {
    const models = [...new Set(Object.keys(b.usageByModel).map(shortModel))].join(", ");
    const status = b.active
      ? pc.green(`ACTIVE · ${fmtMs(b.end - now)} left`)
      : pc.dim(`done · ${fmtMs(b.lastTs - b.firstTs)}`);
    const tokens =
      limit && b.totalTokens > limit
        ? pc.red(`${compact(b.totalTokens)} 🚨`)
        : limit && b.totalTokens > limit * 0.8
          ? pc.yellow(`${compact(b.totalTokens)} ⚠️`)
          : compact(b.totalTokens);
    table.push([fmtStart(b.start), status, models, tokens, usd(b.costUsd)]);
  }
  parts.push(table.toString());

  const active = blocks.find((b) => b.active);
  const rate = active ? burnRate(active, now) : undefined;
  if (active && rate) {
    const lines = [
      pc.bold("Active block") +
        ` — started ${fmtStart(active.start)}, ${pc.green(fmtMs(rate.remainingMs))} remaining`,
      `  burn rate   ${compact(Math.round(rate.tokensPerMinute))} tok/min · ${usd(rate.costPerHour)}/hr`,
      `  projected   ${compact(rate.projectedTokens)} tokens · ${usd(rate.projectedCostUsd)} by block end`,
    ];
    if (limit) {
      const over = rate.projectedTokens > limit;
      const nearing = !over && active.totalTokens > limit * 0.8;
      lines.push(
        `  limit       ${compact(limit)} tokens — ` +
          (over
            ? pc.red(`🚨 projected to exceed (${compact(rate.projectedTokens)})`)
            : nearing
              ? pc.yellow(`⚠️ ${Math.round((active.totalTokens / limit) * 100)}% used`)
              : pc.green(`${Math.round((active.totalTokens / limit) * 100)}% used`)),
      );
    }
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
