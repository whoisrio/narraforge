UI Demo 关键设计 → Agent Server API 对照
# 1. Workflow 选择
UI 设计	API
启动时获取所有 workflow 列表	POST /assistants/search → [{name, graph_id, assistant_id}]
获取选中 workflow 的图结构（节点+边）	GET /assistants/{name}/graph → {nodes[], edges[]}
# 2. 执行 Workflow
UI 设计	API
useStream 初始化连接	内部创建 Client({apiUrl})
stream.submit(input) 提交 run	POST /threads 创建 thread → POST /threads/{id}/stream/events 发送 run.start 命令
接收实时事件（values/messages）	SSE 订阅 POST /threads/{id}/stream/events，channels: ["lifecycle","input","values","messages"]
stream.values 读取当前状态	GET /threads/{id}/state → {values: {...}}
# 3. 节点状态推断
UI 设计	数据来源
图结构（节点名、边）	GET /assistants/{name}/graph — 动态获取，不 hardcode
节点完成判断	stream.values 中对应 state key 出现 → 节点完成（NODE_STATE_KEYS 映射）
节点执行中判断	图拓扑推断：已完节点的下游未完成节点 = running
全部完成判断	stream.isLoading === false + values 非空
⚠️ stream.subgraphs 在当前 server 版本下不工作（protocol 层未透传 subgraphs:true），所以用 state-based 推断替代。

# 4. 中断恢复（Human-in-the-loop）
UI 设计	API
stream.interrupts 检测到中断	GET /threads/{id}/state → tasks[].interrupts
显示审核面板（payload 来自 interrupt.value）	interrupt payload 由 graph 的 interrupt() 函数定义
stream.respond({approved, ...}) 恢复执行	POST /threads/{id}/stream/events 发送 input.respond 命令
# 5. 历史查看
UI 设计	API
查看所有历史 run	POST /threads/search → thread 列表（含 status, metadata.graph_id）
查看某个 run 的最终结果	GET /threads/{id}/state → 完整 values
查看执行历史（每步快照）	POST /threads/{id}/history → checkpoint 数组
# 6. 关键 UI Contract（需手动维护）

// 每个 workflow 的：节点 → state key 映射
NODE_STATE_KEYS = {
  app:              { classifyIntent: "classification", draftResponse: "responseText", ... },
  optimizerWorkflow: { llmCallGenerator: "joke", llmCallEvaluator: "funnyOrNot" },
}

// 每个 workflow 的：输入字段定义
INPUT_FIELDS = {
  app:              { emailContent: "Email Content", senderEmail: "...", emailId: "..." },
  optimizerWorkflow: { topic: "Joke Topic" },
}
这两份映射是 graph 定义和 UI 之间的唯一契约，换 workflow 时只需改这里。


demo 参考文章，https://docs.langchain.com/oss/javascript/langgraph/frontend/graph-execution#building-the-pipeline-progress-bar
完整api参考，https://docs.langchain.com/langsmith/server-api-ref