/** 从任意错误对象中提取可读 message */
export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
