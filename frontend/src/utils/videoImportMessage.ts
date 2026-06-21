export function formatVideoImportSuccessMessage(
  title: string,
  importMethod?: string | null
): string {
  const base = `「${title}」已导入并加入时间线`
  switch (importMethod) {
    case 'hardlink':
    case 'symlink':
      return `${base}（已链接原文件，未整盘复制）`
    case 'reference':
      return `${base}（已引用原路径，请勿移动或删除源文件）`
    case 'upload':
      return `${base}（已上传到工程）`
    default:
      return base
  }
}
