/** 延时工具，返回 Promise */
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 从任意错误对象中提取可读 message */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
