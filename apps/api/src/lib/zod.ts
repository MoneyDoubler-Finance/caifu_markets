import type { ZodIssue } from 'zod'

export type ValidationIssue = {
  path: string
  message: string
}

const formatIssuePath = (segments: readonly (string | number)[]): string => {
  if (!segments || segments.length === 0) return ''
  return segments.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') {
      return `${acc}[${segment}]`
    }
    return acc ? `${acc}.${segment}` : segment
  }, '')
}

export const formatZodIssues = (issues: readonly ZodIssue[]): ValidationIssue[] => {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
  }))
}
