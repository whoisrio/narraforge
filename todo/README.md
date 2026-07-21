# TODO — 待实施设计文档

这个目录存放**已经想清楚 / 部分想清楚，但还没开始实施**的设计文档。

## 与其他文档的区别

| 类型 | 位置 | 状态 |
|---|---|---|
| 正在实施的计划 | `docs/superpowers/plans/YYYY-MM-DD-*.md` | 已开工，逐 Task 执行中 |
| **待实施设计** | **`todo/YYYY-MM-DD-*.md`** | **想过，未开工，随时可捡起来** |
| 已完成特性 | `docs/*.md` | 已上线，作为参考文档 |

## 命名约定

`YYYY-MM-DD-{kebab-case-topic}.md`

日期是**设计定型日**，不是实施日。

## 每个文档的最小骨架

```markdown
# {Topic}

**Status**: TODO / DESIGNING / BLOCKED
**Depends on**: <前置依赖>
**Created**: YYYY-MM-DD

## 背景 / 现存问题

## 设计要点

## 分阶段 Rollout

## Open Questions
```

## 生命周期

1. 想清楚了 → 写到 `todo/`；
2. 决定开工 → 转成 `docs/superpowers/plans/` 下的正式 plan；
3. 实施完成 → 该文档删除或归档，正式文档更新 `docs/`。
