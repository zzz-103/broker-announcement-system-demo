"use client";

import { useEffect, useMemo, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { AppReleaseRecord } from "@/lib/app-release-data";
import {
  getBrokerReleaseCounts,
  getFeatureTagDistribution,
  getReleaseTrend,
  getUpdateTypeDistribution,
  UPDATE_TYPE_COLORS,
} from "@/lib/app-release-data";

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CanvasRenderer,
]);

interface AppChartsProps {
  data: AppReleaseRecord[];
}

const TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  borderColor: "#E4EAF2",
  borderWidth: 1,
  textStyle: { color: "#172033", fontSize: 12 },
  extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-radius: 8px;",
};

function EmptyChartState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#98A2B3] pointer-events-none">
      暂无数据
    </div>
  );
}

function useEchart(setOption: (chart: echarts.ECharts) => void, deps: unknown[]) {
  const chartRef = useRef<HTMLDivElement>(null);
  const instance = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!instance.current) instance.current = echarts.init(chartRef.current);
    setOption(instance.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const handleResize = () => instance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return chartRef;
}

function ChartCard({
  title,
  children,
  span = "lg:col-span-3",
}: {
  title: string;
  children: React.ReactNode;
  span?: string;
}) {
  return (
    <div
      className={`col-span-1 min-w-0 md:col-span-3 ${span} bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4`}
    >
      <h3 className="text-[14px] font-bold text-[#172033] mb-4">{title}</h3>
      <div className="relative h-[260px] sm:h-[220px]">{children}</div>
    </div>
  );
}

export function ReleaseTrendChart({ data }: AppChartsProps) {
  const chartData = useMemo(() => getReleaseTrend(data), [data]);
  const chartRef = useEchart(
    (chart) => {
      chart.setOption({
        tooltip: { trigger: "axis", ...TOOLTIP_STYLE },
        grid: { top: 20, right: 16, bottom: 20, left: 36 },
        xAxis: {
          type: "category",
          data: chartData.map((d) => d.name),
          axisLabel: { fontSize: 10, color: "#98A2B3" },
          axisLine: { lineStyle: { color: "#E4EAF2" } },
        },
        yAxis: {
          type: "value",
          axisLabel: { fontSize: 10, color: "#98A2B3" },
          splitLine: { lineStyle: { color: "#F0F2F5" } },
        },
        series: [
          {
            name: "更新条数",
            type: "line",
            smooth: true,
            data: chartData.map((d) => d.count),
            areaStyle: { color: "rgba(37, 99, 235, 0.08)" },
            lineStyle: { color: "#2563EB", width: 2 },
            itemStyle: { color: "#2563EB" },
            symbol: "circle",
            symbolSize: 6,
          },
        ],
      });
    },
    [chartData],
  );

  return (
    <ChartCard title="更新随时间分布" span="lg:col-span-6">
      <div ref={chartRef} className="h-full w-full" />
      {data.length === 0 && <EmptyChartState />}
    </ChartCard>
  );
}

export function UpdateTypeChart({ data }: AppChartsProps) {
  const chartData = useMemo(() => getUpdateTypeDistribution(data), [data]);
  const chartRef = useEchart(
    (chart) => {
      const total = chartData.reduce((sum, item) => sum + item.count, 0);
      chart.setOption({
        title: {
          text: total.toLocaleString(),
          subtext: "全部更新",
          left: "29%",
          top: "40%",
          textAlign: "center",
          textStyle: { fontSize: 20, fontWeight: "bold", color: "#172033" },
          subtextStyle: { fontSize: 11, color: "#98A2B3" },
        },
        tooltip: { trigger: "item", ...TOOLTIP_STYLE },
        legend: {
          type: "scroll",
          orient: "vertical",
          right: 0,
          top: 8,
          bottom: 8,
          width: 100,
          icon: "circle",
          itemWidth: 10,
          itemHeight: 10,
          itemGap: 7,
          textStyle: { fontSize: 11, color: "#667085", fontWeight: 500 },
        },
        series: [
          {
            type: "pie",
            radius: ["46%", "64%"],
            center: ["29%", "50%"],
            avoidLabelOverlap: false,
            label: { show: false },
            data: chartData.map((item) => ({
              name: item.name,
              value: item.count,
              itemStyle: { color: UPDATE_TYPE_COLORS[item.name] ?? "#98A2B3" },
            })),
          },
        ],
      });
    },
    [chartData],
  );

  return (
    <ChartCard title="更新类型占比">
      <div ref={chartRef} className="h-full w-full" />
      {data.length === 0 && <EmptyChartState />}
    </ChartCard>
  );
}

export function FeatureTagChart({ data }: AppChartsProps) {
  const chartData = useMemo(() => getFeatureTagDistribution(data).slice(0, 8), [data]);
  const chartRef = useEchart(
    (chart) => {
      chart.setOption({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP_STYLE },
        grid: { top: 8, right: 40, bottom: 8, left: 70, containLabel: false },
        xAxis: {
          type: "value",
          axisLabel: { show: false },
          splitLine: { show: false },
          axisLine: { show: false },
        },
        yAxis: {
          type: "category",
          data: [...chartData].reverse().map((d) => d.name),
          axisLabel: { fontSize: 11, color: "#667085", width: 60, overflow: "truncate" },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            data: [...chartData].reverse().map((d) => d.count),
            itemStyle: { color: "#0F9F8F", borderRadius: [0, 4, 4, 0] },
            barMaxWidth: 16,
            label: { show: true, position: "right", fontSize: 10, color: "#667085", fontWeight: 500 },
          },
        ],
      });
    },
    [chartData],
  );

  return (
    <ChartCard title="功能标签分布">
      <div ref={chartRef} className="h-full w-full" />
      {data.length === 0 && <EmptyChartState />}
    </ChartCard>
  );
}

export function BrokerReleaseCountChart({ data }: AppChartsProps) {
  const chartData = useMemo(() => getBrokerReleaseCounts(data).slice(0, 10), [data]);
  const chartRef = useEchart(
    (chart) => {
      chart.setOption({
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, ...TOOLTIP_STYLE },
        grid: { top: 8, right: 40, bottom: 8, left: 90, containLabel: false },
        xAxis: {
          type: "value",
          axisLabel: { show: false },
          splitLine: { show: false },
          axisLine: { show: false },
        },
        yAxis: {
          type: "category",
          data: [...chartData].reverse().map((d) => d.name),
          axisLabel: { fontSize: 11, color: "#667085", width: 80, overflow: "truncate" },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            data: [...chartData].reverse().map((d) => d.count),
            itemStyle: { color: "#2563EB", borderRadius: [0, 4, 4, 0] },
            barMaxWidth: 16,
            label: { show: true, position: "right", fontSize: 10, color: "#667085", fontWeight: 500 },
          },
        ],
      });
    },
    [chartData],
  );

  return (
    <ChartCard title="各券商更新条数" span="lg:col-span-6">
      <div ref={chartRef} className="h-full w-full" />
      {data.length === 0 && <EmptyChartState />}
    </ChartCard>
  );
}
