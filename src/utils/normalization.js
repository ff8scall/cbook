/**
 * Normalizes book data into a common format.
 * @param {Object} data 
 * @returns {Object} Normalized data
 */
export function normalize(data) {
  const {
    id,
    platform,
    title,
    originalPrice,
    discountPrice,
    thumbnailUrl,
    itemUrl,
  } = data;

  const discountRate = originalPrice > 0 
    ? Math.round(((originalPrice - discountPrice) / originalPrice) * 100) 
    : 0;

  return {
    id: `${platform}_${id}`,
    platform,
    title: title.trim(),
    originalPrice,
    discountPrice,
    discountRate,
    thumbnailUrl,
    itemUrl,
    updatedAt: new Date().toISOString(),
  };
}
