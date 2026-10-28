/**
 * 按普通声部的出现顺序计算对唱方向，特殊声部不参与比较
 * @param agentTypes - 声部 ID 与类型的映射
 * @returns 按主行解析顺序调用的方向计算函数
 */
export const createDuetResolver = (
  agentTypes: ReadonlyMap<string, string>,
): ((agentId?: string) => boolean) => {
  let previousAgentId: string | undefined;
  let previousIsDuet: boolean | undefined;
  return (agentId?: string): boolean => {
    const agentType = agentId ? agentTypes.get(agentId) : undefined;
    if (agentType === "group") return false;
    if (agentType === "other") return true;
    if (previousIsDuet === undefined) {
      const isDuet = agentId === "v2";
      previousAgentId = agentId;
      previousIsDuet = isDuet;
      return isDuet;
    }
    const isDuet = agentId === previousAgentId ? previousIsDuet : !previousIsDuet;
    previousAgentId = agentId;
    previousIsDuet = isDuet;
    return isDuet;
  };
};
