/**
 * Policies module exports
 */

export { getSecurityPolicy, SECURITY_POLICY } from './security';
export { getDesignPolicy, DESIGN_POLICY } from './design';
export { getPerformancePolicy, PERFORMANCE_POLICY } from './performance';

/**
 * Get a formatted list of all available review policies
 */
export function getAvailablePolicies(): string {
  return `
## Available Review Policies

These policies should be applied when reviewing code to ensure high quality:

### 1. Security Policy
**Focus:** Authentication, authorization, input validation, data handling, and API security.

**Key Areas:**
- Authentication & authorization checks
- Input validation and sanitization (SQL injection, XSS, path traversal)
- Secrets management and PII handling
- API security (rate limiting, CORS, error messages)
- Common vulnerabilities (injection attacks, broken access control, cryptographic issues)

### 2. Design Policy
**Focus:** Design system compliance, UI/UX patterns, accessibility, and consistency.

**Key Areas:**
- Design system compliance (tokens, component patterns, reusability)
- Color usage (semantic colors, dark mode support)
- Component patterns (structure, TypeScript props, accessibility, responsive design)
- Typography and spacing following design system
- UX considerations (loading states, error states, interactive feedback)

### 3. Performance Policy
**Focus:** Frontend and backend optimization, efficient resource usage.

**Key Areas:**
- Frontend: React optimization (useMemo, useCallback, React.memo), bundle size, rendering
- Backend: Database queries (indexes, N+1 patterns), API design, memory management
- Platform-specific: Next.js (Server/Client Components), Convex (query indexing), Core Web Vitals
- Scalability considerations

**Note:** Apply these policies based on the type of changes being reviewed. Not all policies may be relevant for every review.
`;
}
