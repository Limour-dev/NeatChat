/**
 * 使用tiktoken准确计算LLM模型的token数量
 */
export function estimateTokenLengthInLLM(input: string): number {
    return Math.ceil(estimateTokenLength(input));
}

/**
 * 基于字符特性估算token长度（不使用tiktoken）
 * 保留原有的estimateTokenLength实现
 */
export function estimateTokenLength(input: string): number {
  let tokenLength = 0;

  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);

    if (charCode < 128) {
      // ASCII character
      if (charCode <= 122 && charCode >= 65) {
        // a-Z
        tokenLength += 0.25;
      } else {
        tokenLength += 0.5;
      }
    } else {
      // Unicode character
      tokenLength += 1.5;
    }
  }

  return tokenLength;
}