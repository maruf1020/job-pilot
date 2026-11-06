import { env } from '@/lib/env'

/**
 * Where is this code running? On AWS Amplify the Next.js server is a Lambda function:
 * short request budget (about 30 s), no Chromium, outbound port 25 blocked. Long or
 * browser-driven work belongs in the worker; the web side degrades gracefully.
 */
export const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV || process.env.VERCEL)

/** Options for contact discovery when triggered from a web request. */
export function webContactOptions(): { browser: boolean; skipVerify: boolean; maxPages: number } {
  return {
    browser: !isServerless,
    skipVerify: isServerless && env.CONTACT_VERIFY_IN_WEB !== 'true',
    maxPages: isServerless ? 4 : 8,
  }
}
