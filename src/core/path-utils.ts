/** LGU+ 웹하드 경로에서 불필요한 중간 폴더(GUEST 등)를 제거하는 공유 유틸 */
export const EXCLUDED_PATH_SEGMENTS = new Set(['GUEST', '게스트 폴더'])

/** 경로 문자열 정규화: EXCLUDED 세그먼트 제거, 항상 /로 시작·끝 */
export function cleanFolderPath(folderPath: string): string {
  const segments = folderPath
    .replace(/ > /g, '/')
    .split('/')
    .filter((seg) => seg !== '' && !EXCLUDED_PATH_SEGMENTS.has(seg))
  if (segments.length === 0) return '/'
  return `/${segments.join('/')}/`
}

/** 경로 세그먼트 배열에서 EXCLUDED 세그먼트 필터링 */
export function filterPathSegments(segments: string[]): string[] {
  return segments.filter((seg) => !EXCLUDED_PATH_SEGMENTS.has(seg))
}

/** DB 저장용 정규화: EXCLUDED 제거, leading /, no trailing /
 *  cleanFolderPath와 동일하지만 trailing slash 없음
 *  예: '/올리기전용/GUEST/업체A/' → '/올리기전용/업체A'
 */
export function normalizeFolderPath(rawPath: string): string {
  const cleaned = cleanFolderPath(rawPath)
  return cleaned === '/' ? '' : cleaned.slice(0, -1)
}
