/**
 * 封面指纹比对
 *
 * 专辑名相同不代表封面相同（不同发行、地区版、重制版都可能同名换图），
 * 因此用平均哈希（aHash）比较两张封面是否就是同一张图
 */

/** 指纹边长，8x8 共 64 位 */
const SAMPLE_SIZE = 8;
/** 汉明距离阈值：放宽到 18，容忍同一张图的裁剪与压缩差异 */
const SAME_COVER_THRESHOLD = 18;

/**
 * 把图片地址解码成 8x8 灰度指纹
 * @param url - 图片地址
 * @returns 64 位指纹，失败返回 null
 */
const fingerprintOf = async (url: string): Promise<number[] | null> => {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    bitmap.close();
    const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const gray: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    const mean = gray.reduce((sum, value) => sum + value, 0) / gray.length;
    return gray.map((value) => (value >= mean ? 1 : 0));
  } catch {
    return null;
  }
};

/**
 * 比较两张封面是否为同一张图
 * @param left - 曲目封面地址
 * @param right - 候选专辑封面地址
 * @returns 无法判断时返回 null，可判断时返回是否同一张
 */
export const isSameCoverArt = async (left: string, right: string): Promise<boolean | null> => {
  if (left === right) return true;
  const [a, b] = await Promise.all([fingerprintOf(left), fingerprintOf(right)]);
  // 任一取不到指纹就交给调用方按名称规则处理，避免误杀
  if (!a || !b) return null;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance <= SAME_COVER_THRESHOLD;
};
