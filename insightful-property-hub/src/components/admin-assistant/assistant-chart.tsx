import { useContext, useState } from "react";
import { z } from "zod";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { RichOutputContext } from "./assistant-runtime-context";
import { safeUrl } from "./rich-output-data";

export const chartTypes = ["bar", "line", "area", "pie", "donut", "scatter", "heatmap"] as const;
type ChartType = (typeof chartTypes)[number];
export const chartSchema = z.object({
  title: z.string().max(240),
  type: z
    .enum(chartTypes)
    .optional()
    .describe("Choose the chart appropriate to the data; defaults to bar for older responses."),
  unit: z.string().max(80),
  xLabel: z.string().max(80).optional().describe("Scatter x-axis label including unit."),
  points: z
    .array(
      z.object({
        label: z.string().min(1).max(120).describe("Category, ordered time label, or heatmap row."),
        value: z
          .number()
          .finite()
          .describe("Retrieved numeric value; also the scatter y coordinate."),
        source: z.string().min(1).max(2000),
        group: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe("Required for heatmaps: column category. One point per row/column pair."),
        x: z
          .number()
          .finite()
          .optional()
          .describe("Required for scatter: retrieved numeric x coordinate."),
      }),
    )
    .min(1)
    .max(144),
});
type ChartData = z.infer<typeof chartSchema>;
const names: Record<ChartType, string> = {
  bar: "Bar chart",
  line: "Line chart",
  area: "Area chart",
  pie: "Pie chart",
  donut: "Donut chart",
  scatter: "Scatter plot",
  heatmap: "Heatmap",
};
const colors = ["#2563eb", "#0891b2", "#d97706", "#7c3aed", "#db2777", "#059669", "#64748b"];
const format = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);

/** Keep invalid chart geometry out of Recharts and never fill gaps with zero. */
export function chartProblem(data: ChartData, type: ChartType): string | null {
  if (type !== "heatmap" && data.points.length > 24) return "Use at most 24 points for this chart.";
  if (type === "pie" || type === "donut") {
    const total = data.points.reduce((sum, point) => sum + point.value, 0);
    if (data.points.some((point) => point.value < 0) || !Number.isFinite(total) || total <= 0)
      return "Pie and donut charts need non-negative values with a positive total. Choose a bar or line chart for this data.";
  }
  if (type === "scatter" && data.points.some((point) => point.x === undefined))
    return "A scatter plot needs a numeric x value for every point. Ask the assistant to retrieve both measures.";
  if (type === "heatmap") {
    if (data.points.some((point) => !point.group))
      return "A heatmap needs a row and column for every value. Ask the assistant for grouped data.";
    const cells = data.points.map((point) => JSON.stringify([point.label, point.group]));
    if (new Set(cells).size !== cells.length)
      return "This heatmap contains duplicate row/column values. Ask the assistant to clarify the grouping.";
    if (
      new Set(data.points.map((point) => point.label)).size > 12 ||
      new Set(data.points.map((point) => point.group)).size > 12
    )
      return "Use at most 12 rows and 12 columns in a heatmap.";
  }
  return null;
}

function Heatmap({ data }: { data: ChartData }) {
  const rows = [...new Set(data.points.map((point) => point.label))];
  const columns = [...new Set(data.points.map((point) => point.group!))];
  const cells = new Map(
    data.points.map((point) => [JSON.stringify([point.label, point.group]), point]),
  );
  const min = Math.min(...data.points.map((point) => point.value));
  const max = Math.max(...data.points.map((point) => point.value));
  // Scale before subtracting to avoid overflow with extreme finite inputs.
  const scale = Math.max(Math.abs(min), Math.abs(max), 1);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-center text-xs">
          <caption className="sr-only">{data.title} heatmap. Missing cells are unknown.</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2">
                {data.xLabel || "Category"}
              </th>
              {columns.map((column) => (
                <th key={column} scope="col" className="min-w-20 break-words p-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row}>
                <th scope="row" className="max-w-32 break-words p-2 text-left font-medium">
                  {row}
                </th>
                {columns.map((column) => {
                  const point = cells.get(JSON.stringify([row, column]));
                  const ratio = point
                    ? max === min
                      ? 0.5
                      : (point.value / scale - min / scale) / (max / scale - min / scale)
                    : 0;
                  return (
                    <td
                      key={column}
                      className="rounded-md border p-3 tabular-nums"
                      style={
                        point
                          ? {
                              backgroundColor: `color-mix(in oklch, var(--primary) ${10 + ratio * 70}%, var(--card))`,
                              color:
                                ratio > 0.55 ? "var(--primary-foreground)" : "var(--foreground)",
                            }
                          : undefined
                      }
                      title={`${row} / ${column}: ${point ? `${format(point.value)} ${data.unit}` : "Unknown"}`}
                    >
                      {point ? (
                        format(point.value)
                      ) : (
                        <span className="text-muted-foreground">Unknown</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="flex items-center gap-2 text-xs text-muted-foreground"
        aria-label={`Heatmap scale: ${format(min)} to ${format(max)} ${data.unit}`}
      >
        <span>{format(min)}</span>
        <span
          className="h-2 flex-1 rounded"
          style={{
            background:
              "linear-gradient(to right, color-mix(in oklch, var(--primary) 10%, var(--card)), color-mix(in oklch, var(--primary) 80%, var(--card)))",
          }}
        />
        <span>
          {format(max)} {data.unit}
        </span>
      </div>
    </div>
  );
}

function Plot({ data, type }: { data: ChartData; type: ChartType }) {
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} />;
  const xAxis = <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />;
  const yAxis = <YAxis tick={{ fontSize: 10 }} width={56} />;
  const tooltip = (
    <Tooltip
      formatter={(value: number) => [`${format(value)} ${data.unit}`, data.unit || "Value"]}
      contentStyle={{
        background: "var(--card)",
        borderColor: "var(--border)",
        color: "var(--foreground)",
        borderRadius: 8,
      }}
    />
  );
  if (type === "heatmap") return <Heatmap data={data} />;
  const points = [...data.points];
  let plot;
  if (type === "pie" || type === "donut") {
    plot = (
      <PieChart>
        {tooltip}
        <Pie
          data={points}
          dataKey="value"
          nameKey="label"
          innerRadius={type === "donut" ? "48%" : 0}
          outerRadius="80%"
          paddingAngle={1}
          isAnimationActive={false}
        >
          {points.map((_, index) => (
            <Cell key={index} fill={colors[index % colors.length]} />
          ))}
        </Pie>
      </PieChart>
    );
  } else if (type === "scatter") {
    plot = (
      <ScatterChart>
        {grid}
        <XAxis dataKey="x" type="number" name={data.xLabel || "X"} tick={{ fontSize: 10 }} />
        <YAxis
          dataKey="value"
          type="number"
          name={data.unit || "Value"}
          tick={{ fontSize: 10 }}
          width={56}
        />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={points} name={data.title} fill="var(--primary)" isAnimationActive={false} />
      </ScatterChart>
    );
  } else if (type === "line") {
    plot = (
      <LineChart data={points}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        <Line
          type="linear"
          dataKey="value"
          name={data.unit || "Value"}
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
        />
      </LineChart>
    );
  } else if (type === "area") {
    plot = (
      <AreaChart data={points}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        <Area
          type="linear"
          dataKey="value"
          name={data.unit || "Value"}
          stroke="var(--primary)"
          fill="var(--primary)"
          fillOpacity={0.2}
          isAnimationActive={false}
        />
      </AreaChart>
    );
  } else {
    plot = (
      <BarChart data={points}>
        {grid}
        {xAxis}
        {yAxis}
        {tooltip}
        <Bar
          dataKey="value"
          name={data.unit || "Value"}
          fill="var(--primary)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    );
  }
  return (
    <>
      <div
        className="h-64 w-full"
        role="img"
        aria-label={`${names[type]}: ${data.title}. Exact values and sources are below.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {plot}
        </ResponsiveContainer>
      </div>
      {type === "scatter" ? (
        <p className="text-xs text-muted-foreground">
          X: {data.xLabel || "X"} · Y: {data.unit || "Value"}
        </p>
      ) : null}
      {type === "pie" || type === "donut" ? (
        <ul className="grid gap-2 text-xs sm:grid-cols-2">
          {points.map((point, index) => (
            <li key={index} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: colors[index % colors.length] }}
              />
              {point.label}: {format(point.value)} {data.unit}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function ChartCard(props: ChartData) {
  const [selectedType, setSelectedType] = useState<ChartType>();
  const { busy } = useContext(RichOutputContext);
  const parsed = chartSchema.safeParse(props);
  if (!parsed.success)
    return (
      <p role="status" className="rounded-2xl border p-4 text-xs text-muted-foreground">
        {busy
          ? "Preparing the chart…"
          : "This chart is incomplete. Ask the assistant to try again."}
      </p>
    );
  const data = parsed.data;
  const type =
    selectedType && !chartProblem(data, selectedType) ? selectedType : data.type || "bar";
  const problem = chartProblem(data, type);
  return (
    <section className="min-w-0 space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words font-semibold">{data.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{data.unit}</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          View
          <select
            aria-label="Chart type"
            value={type}
            onChange={(event) => setSelectedType(event.target.value as ChartType)}
            className="max-w-full rounded-md border bg-background px-2 py-1.5 text-foreground"
          >
            {chartTypes
              .filter((option) => option === type || !chartProblem(data, option))
              .map((option) => (
                <option key={option} value={option}>
                  {names[option]}
                </option>
              ))}
          </select>
        </label>
      </div>
      {problem ? (
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          {problem}
        </p>
      ) : (
        <Plot data={data} type={type} />
      )}
      <details className="text-xs">
        <summary className="cursor-pointer">View values and sources</summary>
        <ul className="space-y-2 pt-2">
          {data.points.map((point, index) => (
            <li key={index} className="break-words">
              {point.label}
              {point.group ? ` / ${point.group}` : ""}
              {type === "scatter" && point.x !== undefined ? ` (X: ${format(point.x)})` : ""}:{" "}
              {format(point.value)} {data.unit} ·{" "}
              {safeUrl(point.source) ? (
                <a
                  href={safeUrl(point.source)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  Source
                </a>
              ) : (
                point.source
              )}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
