import { NextRequest } from "next/server";
import { processRecords, type ProcessedRecord } from "@/lib/announcement-data";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import Papa from "papaparse";
import type { Message } from "coze-coding-dev-sdk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RawCsvRow {
  broker_folder?: string;
  markdown_file?: string;
  document_sha1?: string;
  processed_at?: string;
  raw_json_path?: string;
  broker_name?: string;
  publish_date?: string;
  announcement_stage?: string;
  procurement_category?: string;
  project_subcategory?: string;
  project_name?: string;
  procurement_method?: string;
  winning_supplier?: string;
  winning_amount_yuan?: string;
}

const ANALYSIS_FILE = join(process.cwd(), "public", "data", "ai-analysis.json");
const ADMIN_USER = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD;

function loadCsvServerSide(): ProcessedRecord[] {
  const csvPath = join(process.cwd(), "public", "data", "announcement_table.csv");
  let csvText = readFileSync(csvPath, "utf-8");
  if (csvText.charCodeAt(0) === 0xfeff) {
    csvText = csvText.slice(1);
  }
  const result = Papa.parse<RawCsvRow>(csvText, {
    header: true,
    skipEmptyLines: true,
  });
  return processRecords(result.data);
}

function saveAnalysis(content: string) {
  const dir = join(process.cwd(), "public", "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(ANALYSIS_FILE, JSON.stringify({
    content,
    updatedAt: new Date().toISOString(),
  }), "utf-8");
}

function loadSavedAnalysis(): { content: string; updatedAt: string } | null {
  try {
    if (existsSync(ANALYSIS_FILE)) {
      return JSON.parse(readFileSync(ANALYSIS_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

// GET: 获取已保存的分析结果（无需认证）
export async function GET() {
  const saved = loadSavedAnalysis();
  if (saved) {
    return new Response(JSON.stringify(saved), {
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ content: null, updatedAt: null }), {
    headers: { "Content-Type": "application/json" },
  });
}

// POST: 触发新的 AI 分析（需要管理员认证）
export async function POST(request: NextRequest) {
  try {
    // 验证管理员身份
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return new Response(JSON.stringify({ error: "需要管理员认证" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const base64Credentials = authHeader.split(" ")[1];
    const credentials = Buffer.from(base64Credentials, "base64").toString("utf-8");
    const [username, password] = credentials.split(":");

    if (!ADMIN_PASS || username !== ADMIN_USER || password !== ADMIN_PASS) {
      return new Response(JSON.stringify({ error: "用户名或密码错误" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { LLMClient, Config, HeaderUtils } = await import("coze-coding-dev-sdk");
    const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    // Load and process data
    const records = loadCsvServerSide();

    // Find the max date as baseline
    const validDates = records
      .map((r: ProcessedRecord) => r.validPublishDate)
      .filter((d: Date | null): d is Date => d !== null);
    const maxDate = validDates.length > 0
      ? new Date(Math.max(...validDates.map((d: Date) => d.getTime())))
      : new Date();

    // Filter last 30 days
    const thirtyDaysAgo = new Date(maxDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentRecords = records.filter((r: ProcessedRecord) => {
      if (!r.validPublishDate) return false;
      return r.validPublishDate >= thirtyDaysAgo && r.validPublishDate <= maxDate;
    });

    // Aggregate data
    const domainCounts: Record<string, number> = {};
    const brokerCounts: Record<string, number> = {};
    const supplierCounts: Record<string, number> = {};
    const stageCounts: Record<string, number> = {};
    let priceCount = 0;
    let totalAmount = 0;
    const priceSamples: { broker: string; project: string; amount: number; supplier: string }[] = [];

    for (const r of recentRecords) {
      if (r.primaryDomain !== "非金融科技及其他") {
        domainCounts[r.primaryDomain] = (domainCounts[r.primaryDomain] || 0) + 1;
      }
      if (r.validBrokerName !== "主体待识别") {
        brokerCounts[r.validBrokerName] = (brokerCounts[r.validBrokerName] || 0) + 1;
      }
      if (r.announcement_stage === "结果公示" && r.normalizedSupplier) {
        supplierCounts[r.normalizedSupplier] = (supplierCounts[r.normalizedSupplier] || 0) + 1;
      }
      stageCounts[r.announcement_stage] = (stageCounts[r.announcement_stage] || 0) + 1;
      if (r.winning_amount_yuan && r.winning_amount_yuan > 0) {
        priceCount++;
        totalAmount += r.winning_amount_yuan;
        if (priceSamples.length < 10) {
          priceSamples.push({
            broker: r.validBrokerName,
            project: r.normalizedProjectName,
            amount: r.winning_amount_yuan,
            supplier: r.normalizedSupplier || "未披露",
          });
        }
      }
    }

    const topDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topBrokers = Object.entries(brokerCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const topSuppliers = Object.entries(supplierCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const totalFintech = topDomains.reduce((sum, [, count]) => sum + count, 0);

    const dataSummary = `统计区间：${thirtyDaysAgo.toISOString().split("T")[0]} 至 ${maxDate.toISOString().split("T")[0]}
公告记录总数：${recentRecords.length} 条
涉及券商主体：${Object.keys(brokerCounts).length} 家
采购招标：${stageCounts["采购招标"] || 0} 条
结果公示：${stageCounts["结果公示"] || 0} 条
流标废标：${stageCounts["流标废标"] || 0} 条
公开价格样本：${priceCount} 个，总金额约 ${(totalAmount / 10000).toFixed(0)} 万元

金融科技方向分布：
${topDomains.map(([name, count]) => `- ${name}：${count} 条（占金融科技 ${(count / totalFintech * 100).toFixed(1)}%）`).join("\n")}

活跃券商 Top 8：
${topBrokers.map(([name, count]) => `- ${name}：${count} 条`).join("\n")}

高频供应商 Top 8（仅结果公示）：
${topSuppliers.map(([name, count]) => `- ${name}：${count} 次`).join("\n")}

公开价格样本（最多10条）：
${priceSamples.map(s => `- ${s.broker} | ${s.project} | ${s.supplier} | ${(s.amount / 10000).toFixed(1)}万元`).join("\n")}`;

    const systemPrompt = `你是一位严谨的金融科技行业数据分析师，专门为证券公司管理层撰写招采情报分析。

严格规则：
1. 所有结论必须有上方数据直接支撑，禁止推测、臆断或编造任何不在数据中的信息
2. 禁止使用"行业领先""市场第一""规模最大"等无法从数据验证的表述
3. 禁止对券商的科技投入水平、竞争力或战略意图做主观评价
4. 所有排名和比较仅限于当前数据集，不得外推到行业整体
5. 如果某项数据不足以得出结论，明确标注"数据样本有限"
6. "活跃度"仅指公开招采活跃度，不得表述为真实科技投入规模
7. 供应商出现频次不代表市场份额或中标率

分析框架：
一、数据概况（2-3句话概述统计区间、记录总量、覆盖主体数）
二、金融科技建设方向分析（基于方向分布数据，指出前3-5个主要方向及其占比，分析可能的原因）
三、券商招采活跃度观察（基于券商分布数据，指出前3-5个活跃主体及其主要方向）
四、供应商市场观察（基于供应商数据，指出高频出现的供应商及其涉及领域，注意：仅反映公开招采中的出现频次）
五、价格披露情况（说明价格披露率和样本特征）
六、值得关注的信号（2-3条基于数据的客观观察，如某方向近期集中出现、某券商连续采购等）

格式要求：
- 使用 Markdown 格式
- 每个章节用 ## 标题
- 关键数据用 **加粗** 标注
- 总字数 500-800 字
- 语言专业、客观、简洁`;

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `请基于以下近30天券商金融科技公开招采数据，撰写情报分析报告：\n\n${dataSummary}` },
    ];

    // Stream the response and save the final content
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let fullContent = "";

        try {
          const llmStream = client.stream(messages, {
            model: "glm-4-7-251222",
            temperature: 0.3,
          });

          for await (const chunk of llmStream) {
            const content = chunk.content?.toString() || "";
            if (content) {
              fullContent += content;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\n`));
            }
          }

          // Save the complete analysis
          saveAnalysis(fullContent);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, updatedAt: new Date().toISOString() })}\n\n`));
          controller.close();
        } catch (error) {
          console.error("LLM streaming error:", error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "AI 分析生成失败，请重试" })}\n\n`));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("AI analysis error:", error);
    return new Response(JSON.stringify({ error: "AI 分析失败，请稍后重试" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
