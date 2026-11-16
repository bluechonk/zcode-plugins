/**
 * 探索式意图识别。
 *
 * dev-flow 只服务一种场景：用户「不知道要做什么、看着看着就想改改」，
 * 或者明确要收口（整理提交、拆分支）。这两种意图的共同点是——
 * 改动是**草稿性质**的，落点该是 dev 分支而不是主干。
 *
 * 判据刻意保守：只认这些明确的词。泛化成「任何改动」会让规则变成噪音，
 * 而 dev-flow 的价值恰恰在于「只在探索式会话里坚持 dev 分支」。
 */

export const EXPLORATORY_TRIGGERS =
  /整理提交|拆分支|拆成|累计起来|攒多了|梳理这轮|梳理一下这轮|这轮改动|探索式|随便改改|先试着改|试改|草稿/;

export function looksExploratory(prompt: string): boolean {
  return EXPLORATORY_TRIGGERS.test(prompt);
}
