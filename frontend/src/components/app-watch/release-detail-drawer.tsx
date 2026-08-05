"use client";

import { ExternalLink } from "lucide-react";
import type { AppReleaseRecord } from "@/lib/app-release-data";
import { formatReleaseDate, UPDATE_TYPE_COLORS } from "@/lib/app-release-data";
import { Drawer, DrawerContent } from "@/components/ui/drawer";

interface ReleaseDetailDrawerProps {
  record: AppReleaseRecord | null;
  onClose: () => void;
}

export function ReleaseDetailDrawer({ record, onClose }: ReleaseDetailDrawerProps) {
  const typeColor = record ? UPDATE_TYPE_COLORS[record.updateType] ?? "#98A2B3" : "#98A2B3";

  return (
    <Drawer open={Boolean(record)} onOpenChange={(open) => !open && onClose()}>
      {record && <DrawerContent title="更新详情">
        <div className="sticky top-0 bg-white border-b border-[#E4E9F0] px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-[16px] font-semibold text-[#172033]">更新详情</h2>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Section 1: Overview */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full text-white"
                style={{ backgroundColor: typeColor }}
              >
                {record.updateType}
              </span>
              <span className="text-[13px] font-semibold text-[#172033]">
                {record.brokerName} · {record.appName}
              </span>
            </div>
            <div className="space-y-2.5">
              <Field label="版本号" value={record.appVersion || "未识别"} />
              <Field label="平台" value={record.platform} />
              <Field label="发布日期" value={formatReleaseDate(record.publishDate)} />
              <Field label="一句摘要" value={record.updateSummary || "未提供"} />
              <div className="flex items-start gap-3 text-[13px]">
                <span className="text-[#667085] w-24 shrink-0">功能标签</span>
                <div className="flex flex-wrap gap-1">
                  {record.featureTags.length > 0 ? (
                    record.featureTags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[11px] px-1.5 py-0.5 rounded bg-[#F0F2F5] text-[#667085]"
                      >
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="text-[#98A2B3]">无标签</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Highlights */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              更新要点
            </h3>
            {record.highlights.length > 0 ? (
              <ul className="space-y-2">
                {record.highlights.map((item, index) => (
                  <li
                    key={index}
                    className="flex items-start gap-2 text-[13px] text-[#344054]"
                  >
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#2563EB] shrink-0" />
                    <span className="flex-1 break-words">{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[#98A2B3]">暂无要点摘录。</p>
            )}
          </section>

          {/* Section 3: Source */}
          <section>
            <h3 className="text-[13px] font-semibold text-[#162B49] uppercase tracking-wider mb-3">
              数据来源
            </h3>
            <div className="space-y-2.5">
              <Field label="券商代码" value={record.brokerCode || "未提供"} />
              <Field label="采集时间" value={record.crawlTime || "未提供"} />
              <Field label="处理时间" value={record.processedAt || "未提供"} />
              {record.sourceUrl ? (
                <div className="flex items-start gap-3 text-[13px]">
                  <span className="text-[#667085] w-24 shrink-0">来源链接</span>
                  <a
                    href={record.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center gap-1 break-all text-[#2563EB] hover:underline"
                  >
                    {record.sourceUrl}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              ) : (
                <Field label="来源链接" value="未提供" />
              )}
            </div>
          </section>
        </div>
      </DrawerContent>}
    </Drawer>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 text-[13px]">
      <span className="text-[#667085] w-24 shrink-0">{label}</span>
      <span
        className={`flex-1 break-words text-[#172033] ${mono ? "font-mono text-[12px]" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
