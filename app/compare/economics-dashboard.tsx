/**
 * The economics of V1 to V2, as four charts.
 *
 * Hand-built SVG and CSS. No chart library, and no "use client": every
 * animation is a CSS keyframe driven by a custom property rendered inline on
 * the server, so all four charts cost the page zero JavaScript and nothing
 * hydrates. A dashboard about cost discipline should not ship 40kB of chart
 * runtime to make that point.
 *
 * Every number is a property of evals/data/v1-v2.json, and every card names
 * the file it came from, so a reader can go and check it.
 */

interface SweepRow {
  model: string;
  accuracy: number;
  cost: number;
  ms: number;
  note?: string;
}

export interface Charts {
  correction: { reported: number; actual: number; caption: string; source: string };
  cache: { percent: number; agents: number; caption: string; source: string };
  sweep: { caption: string; source: string; rows: SweepRow[] };
  roundTrip: { thinking: number; tools: number; total: number; caption: string; source: string };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Before and after, on one scale, so the drop is a length rather than a claim. */
function Correction({ data }: { readonly data: Charts["correction"] }) {
  const max = Math.max(data.reported, data.actual);
  const pct = (n: number) => `${(n / max) * 100}%`;
  const drop = Math.round((1 - data.actual / data.reported) * 100);
  const rows: Array<{ label: string; value: number; tone: "was" | "now"; delay: number }> = [
    { label: "reported", value: data.reported, tone: "was", delay: 0 },
    { label: "actual", value: data.actual, tone: "now", delay: 220 },
  ];
  return (
    <div className="veco-card veco-wide">
      <p className="veco-label">The largest movement — and no model changed</p>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div className="veco-bar-row" key={r.label}>
            <span className="text-muted-foreground text-xs">{r.label}</span>
            <span className="veco-bar-track">
              <span
                className="veco-bar-fill block"
                data-tone={r.tone}
                style={
                  { "--veco-w": pct(r.value), "--veco-delay": `${r.delay}ms` } as React.CSSProperties
                }
              />
            </span>
            <span className="veco-figure venus-serif text-lg">{usd(r.value)}</span>
          </div>
        ))}
      </div>
      <p className="venus-serif text-base">
        <span className="text-primary">{drop}% lower</span> — because{" "}
        <code className="text-[0.85em]">prompt_tokens</code> already contains{" "}
        <code className="text-[0.85em]">cached_tokens</code>, and the cost function was adding them.
      </p>
      <p className="veco-caption">{data.caption}</p>
      <p className="veco-source">{data.source}</p>
    </div>
  );
}

/** The hit rate, because it is the number that explains the bill. */
function Cache({ data }: { readonly data: Charts["cache"] }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - data.percent / 100);
  return (
    <div className="veco-card">
      <p className="veco-label">Prefix cache hit rate</p>
      <div className="flex items-center gap-4">
        <svg
          aria-hidden="true"
          className="shrink-0"
          height="132"
          viewBox="0 0 132 132"
          width="132"
        >
          <circle className="veco-ring-track" cx="66" cy="66" fill="none" r={r} strokeWidth="12" />
          <circle
            className="veco-ring-fill"
            cx="66"
            cy="66"
            fill="none"
            r={r}
            strokeWidth="12"
            style={
              {
                "--veco-circ": `${circumference}`,
                "--veco-offset": `${offset}`,
                transform: "rotate(-90deg)",
                transformOrigin: "66px 66px",
              } as React.CSSProperties
            }
          />
          <text
            className="veco-figure"
            dominantBaseline="central"
            fill="var(--foreground)"
            fontSize="24"
            textAnchor="middle"
            x="66"
            y="66"
          >
            {data.percent}%
          </text>
        </svg>
        <div className="flex flex-col gap-1">
          <p className="veco-caption">{data.caption}</p>
          <p className="text-muted-foreground text-xs">across {data.agents} agents</p>
        </div>
      </div>
      <p className="veco-source">{data.source}</p>
    </div>
  );
}

/**
 * Cost against accuracy, bubble size for latency.
 *
 * This is the chart that carries the argument: the cheapest model per token
 * sits bottom-right — the worst corner — and the cheapest run of all scored
 * 73% on untrusted email.
 */
function Sweep({ data }: { readonly data: Charts["sweep"] }) {
  const W = 340;
  const H = 232;
  const L = 40;
  const R = 12;
  const T = 14;
  const B = 34;
  const costs = data.rows.map((d) => d.cost);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const msList = data.rows.map((d) => d.ms);
  const minMs = Math.min(...msList);
  const maxMs = Math.max(...msList);

  const x = (c: number) => L + ((c - minCost) / (maxCost - minCost)) * (W - L - R);
  const y = (a: number) => H - B - ((a - 70) / 30) * (H - B - T);
  const rad = (ms: number) => 6 + ((ms - minMs) / (maxMs - minMs)) * 10;

  return (
    <div className="veco-card veco-wide">
      <p className="veco-label">Price per token does not predict price per task</p>
      <div className="overflow-x-auto">
        <svg
          className="w-full min-w-[320px]"
          role="img"
          viewBox={`0 0 ${W} ${H}`}
          aria-label="Scatter of accuracy against cost per set for five candidate models. The cheapest model per token, Nemotron-3.5-Lightning, is both the least accurate of the cheap options and the most expensive per run."
        >
          <title>Accuracy against cost per set, five candidates</title>
          {[70, 80, 90, 100].map((a) => (
            <g key={a}>
              <line className="veco-axis" x1={L} x2={W - R} y1={y(a)} y2={y(a)} strokeWidth="0.5" />
              <text className="veco-tick" textAnchor="end" x={L - 6} y={y(a) + 3}>
                {a}%
              </text>
            </g>
          ))}
          {data.rows.map((d, i) => {
            const cx = x(d.cost);
            const cy = y(d.accuracy);
            const flip = cx > W - 90;
            return (
              <g
                className="veco-dot"
                key={d.model}
                style={{ "--veco-delay": `${300 + i * 130}ms` } as React.CSSProperties}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  fill="var(--primary)"
                  fillOpacity={d.note ? 0.85 : 0.4}
                  r={rad(d.ms)}
                  stroke="var(--primary)"
                  strokeWidth="1"
                />
                <text
                  className="veco-dot-label"
                  textAnchor={flip ? "end" : "start"}
                  x={cx + (flip ? -rad(d.ms) - 5 : rad(d.ms) + 5)}
                  y={cy + 3}
                >
                  {d.model}
                </text>
              </g>
            );
          })}
          <line className="veco-axis" x1={L} x2={W - R} y1={H - B} y2={H - B} strokeWidth="1" />
          <text className="veco-tick" textAnchor="start" x={L} y={H - B + 14}>
            ${minCost.toFixed(4)}
          </text>
          <text className="veco-tick" textAnchor="end" x={W - R} y={H - B + 14}>
            ${maxCost.toFixed(4)}
          </text>
          <text className="veco-tick" textAnchor="middle" x={(L + W - R) / 2} y={H - B + 26}>
            cost per 15-reply set →
          </text>
        </svg>
      </div>
      <p className="veco-caption">{data.caption}</p>
      <p className="veco-source">{data.source}</p>
    </div>
  );
}

/** Where a research run's wall clock actually goes. */
function RoundTrip({ data }: { readonly data: Charts["roundTrip"] }) {
  const pct = (n: number) => `${(n / data.total) * 100}%`;
  return (
    <div className="veco-card">
      <p className="veco-label">Where a scout&rsquo;s {data.total} seconds went</p>
      <div className="veco-stack">
        <span
          className="veco-seg"
          data-tone="thinking"
          style={{ "--veco-w": pct(data.thinking) } as React.CSSProperties}
        />
        <span
          className="veco-seg"
          data-tone="tools"
          style={
            { "--veco-w": pct(data.tools), "--veco-delay": "260ms" } as React.CSSProperties
          }
        />
      </div>
      <div className="veco-key">
        <span style={{ "--veco-swatch": "var(--primary)" } as React.CSSProperties}>
          {data.thinking}s deciding what to call next
        </span>
        <span
          style={
            {
              "--veco-swatch": "color-mix(in srgb, var(--primary) 42%, var(--card))",
            } as React.CSSProperties
          }
        >
          {data.tools}s running the tools
        </span>
      </div>
      <p className="veco-caption">{data.caption}</p>
      <p className="veco-source">{data.source}</p>
    </div>
  );
}

export function EconomicsDashboard({ charts }: { readonly charts: Charts }) {
  return (
    <div className="veco-grid mb-5">
      <Correction data={charts.correction} />
      <Cache data={charts.cache} />
      <RoundTrip data={charts.roundTrip} />
      <Sweep data={charts.sweep} />
    </div>
  );
}
