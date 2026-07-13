"use client";

import { useMemo, useRef, useEffect } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ProcessedRecord } from "@/lib/announcement-data";
import { uniqueCount } from "@/lib/announcement-data";
import { useFilterStore } from "@/store/filter-store";

// Register only the components we use (tree-shaking)
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

interface ChartsProps {
  data: ProcessedRecord[];
}

function EmptyChartState() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-[13px] text-[#98A2B3] pointer-events-none">
      暂无数据
    </div>
  );
}

export function ProcurementTrendChart({ data }: ChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);
  const { setAnnouncementStage } = useFilterStore();

  const chartData = useMemo(() => {
    // Group by month
    const monthMap: Record<
      string,
      { projects: Set<string>; results: Set<string>; prices: Set<string> }
    > = {};

    for (const r of data) {
      if (!r.validPublishDate) continue;
      const key = `${r.validPublishDate.getFullYear()}-${String(
        r.validPublishDate.getMonth() + 1
      ).padStart(2, "0")}`;
      if (!monthMap[key])
        monthMap[key] = {
          projects: new Set(),
          results: new Set(),
          prices: new Set(),
        };
      monthMap[key].projects.add(r.projectKey);
      if (r.announcement_stage === "结果公示")
        monthMap[key].results.add(r.projectKey);
      if (r.priceSampleKey) monthMap[key].prices.add(r.priceSampleKey);
    }

    const sorted = Object.entries(monthMap).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    return {
      months: sorted.map(([k]) => k),
      projects: sorted.map(([, v]) => v.projects.size),
      results: sorted.map(([, v]) => v.results.size),
      prices: sorted.map(([, v]) => v.prices.size),
    };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }
    const chart = chartInstance.current;
    chart.setOption({
      tooltip: {
        trigger: "axis",
        backgroundColor: "#ffffff",
        borderColor: "#E4EAF2",
        borderWidth: 1,
        textStyle: { color: "#172033", fontSize: 12 },
        extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-radius: 8px;",
      },
      legend: {
        data: ["项目线索", "结果公示", "价格样本"],
        right: 0,
        top: 0,
        icon: "circle",
        itemGap: 12,
        textStyle: { fontSize: 11, color: "#667085", fontWeight: 500 },
      },
      grid: { top: 32, right: 16, bottom: 20, left: 40 },
      xAxis: {
        type: "category",
        data: chartData.months,
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
          name: "项目线索",
          type: "bar",
          data: chartData.projects,
          itemStyle: { color: "#2563EB", borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 24,
        },
        {
          name: "结果公示",
          type: "line",
          data: chartData.results,
          lineStyle: { color: "#0F9F8F", width: 2 },
          itemStyle: { color: "#0F9F8F" },
          symbol: "circle",
          symbolSize: 6,
        },
        {
          name: "价格样本",
          type: "line",
          data: chartData.prices,
          lineStyle: { color: "#F59E0B", width: 2 },
          itemStyle: { color: "#F59E0B" },
          symbol: "circle",
          symbolSize: 6,
        },
      ],
    });
    return () => {};
  }, [chartData]);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="col-span-1 min-w-0 md:col-span-6 lg:col-span-6 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-bold text-[#172033]">
          公开招采趋势
        </h3>
        <span className="text-[10px] text-[#98A2B3]">
          趋势受历史采集覆盖范围影响
        </span>
      </div>
      <div className="relative h-[260px] sm:h-[220px]">
        <div ref={chartRef} className="h-full w-full" />
        {data.length === 0 && <EmptyChartState />}
      </div>
    </div>
  );
}

export function DomainDistributionChart({ data }: ChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const chartData = useMemo(() => {
    const domainKeys: Record<string, Set<string>> = {};
    for (const r of data) {
      if (!r.isFinTech) continue;
      if (!domainKeys[r.primaryDomain]) domainKeys[r.primaryDomain] = new Set();
      domainKeys[r.primaryDomain].add(r.projectKey);
    }
    const sorted = Object.entries(domainKeys)
      .map(([d, keys]) => ({ domain: d, count: keys.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const totalFinTech = sorted.reduce((s, d) => s + d.count, 0);
    return {
      domains: sorted.map((d) => d.domain),
      counts: sorted.map((d) => d.count),
      percentages: sorted.map((d) =>
        totalFinTech > 0 ? ((d.count / totalFinTech) * 100).toFixed(1) : "0"
      ),
    };
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }
    chartInstance.current.setOption({
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#ffffff",
        borderColor: "#E4EAF2",
        borderWidth: 1,
        textStyle: { color: "#172033", fontSize: 12 },
        extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-radius: 8px;",
      },
      grid: { top: 8, right: 80, bottom: 8, left: 120, containLabel: false },
      xAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { show: false },
        axisLine: { show: false },
      },
      yAxis: {
        type: "category",
        data: [...chartData.domains].reverse(),
        axisLabel: { fontSize: 11, color: "#667085", width: 110, overflow: "truncate" },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: [...chartData.counts].reverse(),
          itemStyle: {
            color: (params: unknown) => {
              const rawDataIndex =
                typeof params === "object" && params !== null
                  ? Reflect.get(params, "dataIndex")
                  : 0;
              const valIndex = typeof rawDataIndex === "number" ? rawDataIndex : 0;
              const total = chartData.counts.length || 8;
              const opacity = 0.35 + (valIndex / (total - 1)) * 0.65;
              return `rgba(37, 99, 235, ${Math.min(1, Math.max(0.35, opacity))})`;
            },
            borderRadius: [0, 4, 4, 0],
          },
          barMaxWidth: 16,
          label: {
            show: true,
            position: "right",
            formatter: (params: { dataIndex: number }) => {
              const idx = chartData.counts.length - 1 - params.dataIndex;
              return `${chartData.counts[idx]} · ${chartData.percentages[idx]}%`;
            },
            fontSize: 10,
            color: "#667085",
            fontWeight: 500,
          },
        },
      ],
    });
  }, [chartData]);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="col-span-1 min-w-0 md:col-span-3 lg:col-span-3 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4">
      <h3 className="text-[14px] font-bold text-[#172033] mb-4">
        金融科技方向
      </h3>
      <div className="relative h-[260px] sm:h-[220px]">
        <div ref={chartRef} className="h-full w-full" />
        {data.length === 0 && <EmptyChartState />}
      </div>
    </div>
  );
}

export function StageDistributionChart({ data }: ChartsProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const chartData = useMemo(() => {
    const stageCounts: Record<string, number> = {};
    for (const r of data) {
      const stage = r.announcement_stage || "待确认";
      stageCounts[stage] = (stageCounts[stage] || 0) + 1;
    }
    const colorMap: Record<string, string> = {
      采购招标: "#2563EB",
      结果公示: "#0F9F8F",
      流标废标: "#D64545",
      待确认: "#98A2B3",
    };
    return Object.entries(stageCounts).map(([name, value]) => ({
      name,
      value,
      itemStyle: { color: colorMap[name] || "#98A2B3" },
    }));
  }, [data]);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }
    
    const totalSum = chartData.reduce((acc, curr) => acc + curr.value, 0);

    chartInstance.current.setOption({
      title: {
        text: totalSum.toLocaleString(),
        subtext: "全部公告",
        left: "29%",
        top: "40%",
        textAlign: "center",
        textStyle: { fontSize: 20, fontWeight: "bold", color: "#172033" },
        subtextStyle: { fontSize: 11, color: "#98A2B3" },
      },
      tooltip: {
        trigger: "item",
        backgroundColor: "#ffffff",
        borderColor: "#E4EAF2",
        borderWidth: 1,
        textStyle: { color: "#172033", fontSize: 12 },
        extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.05); border-radius: 8px;",
      },
      legend: {
        type: "scroll",
        orient: "vertical",
        right: 0,
        top: 8,
        bottom: 8,
        width: 108,
        icon: "circle",
        itemWidth: 10,
        itemHeight: 10,
        itemGap: 7,
        textStyle: { fontSize: 11, color: "#667085", fontWeight: 500 },
        formatter: (name: string) => (name.length > 7 ? `${name.slice(0, 7)}…` : name),
      },
      series: [
        {
          type: "pie",
          radius: ["46%", "64%"],
          center: ["29%", "50%"],
          avoidLabelOverlap: false,
          label: { show: false },
          data: chartData,
        },
      ],
    });
  }, [chartData]);

  useEffect(() => {
    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="col-span-1 min-w-0 md:col-span-3 lg:col-span-3 bg-white rounded-2xl border border-[#E4EAF2] shadow-[0_1px_3px_rgba(0,0,0,0.02)] p-4">
      <h3 className="text-[14px] font-bold text-[#172033] mb-4">
        公告阶段
      </h3>
      <div className="relative h-[260px] sm:h-[220px]">
        <div ref={chartRef} className="h-full w-full" />
        {data.length === 0 && <EmptyChartState />}
      </div>
    </div>
  );
}
