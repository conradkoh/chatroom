/**
 * Performance Policy Guidelines for Code Review
 *
 * Generic performance guidelines that should be adapted to
 * the specific codebase and runtime environment.
 */

/**
 * Performance review guidelines
 */
export const PERFORMANCE_POLICY = `
## Performance Review Policy

These are general performance principles. Adapt to your codebase's specific requirements.

### Frontend Performance

**React/Component Performance:**
- [ ] \`useMemo\` used for expensive computations
- [ ] \`useCallback\` used for callback props passed to child components
- [ ] \`React.memo\` considered for components receiving stable props
- [ ] No unnecessary re-renders (check dependency arrays)
- [ ] Large lists use virtualization where appropriate

**Bundle Size:**
- [ ] No large dependencies added for simple functionality
- [ ] Dynamic imports (\`lazy\`) used for route-level code splitting
- [ ] Tree-shaking friendly imports (avoid \`import * as\`)
- [ ] Images/assets are appropriately sized and optimized

**Rendering:**
- [ ] No layout thrashing (reading and writing DOM in loops)
- [ ] CSS animations use \`transform\` and \`opacity\` where possible
- [ ] Avoid inline styles that change frequently
- [ ] Consider \`will-change\` for animated elements

### Backend Performance

**Database Queries:**
- [ ] Queries use appropriate indexes
- [ ] N+1 query patterns are avoided or justified
- [ ] Pagination used for large result sets
- [ ] Expensive queries are cached where appropriate

**API Design:**
- [ ] Responses don't include unnecessary data
- [ ] Batch endpoints available for bulk operations
- [ ] Expensive operations are async/background where possible
- [ ] Rate limiting considered for resource-intensive endpoints

**Memory & Resources:**
- [ ] No memory leaks (event listeners cleaned up, subscriptions closed)
- [ ] Large data structures are streamed, not loaded entirely
- [ ] Connection pooling used for database/external services
- [ ] Temporary files/resources are cleaned up

### Common Performance Issues to Catch

1. **Unnecessary Computation**
   - Computing values on every render
   - Recalculating derived data without memoization
   - Expensive operations in hot paths

2. **Over-fetching**
   - Requesting more data than needed
   - Missing pagination on large datasets
   - Not using projection/select for specific fields

3. **Under-caching**
   - Repeated identical API calls
   - Not caching expensive computations
   - Missing server-side caching for static data

4. **Blocking Operations**
   - Synchronous operations blocking the event loop
   - Not using async patterns for I/O
   - Long-running operations without progress feedback

5. **React-Specific Issues**
   - Missing dependency arrays causing infinite loops
   - Creating new objects/functions in render
   - Not using \`key\` prop properly in lists
   - State updates in useEffect without proper deps

### Platform-Specific Considerations

**Next.js:**
- Server Components for static content
- Client Components for interactive elements
- Image optimization with next/image
- Route segment config for caching

**Convex:**
- Query indexing for filtered/sorted data
- Pagination for large result sets
- Optimistic updates for better UX
- Reactive queries vs. one-time fetches

**General Web:**
- Core Web Vitals (LCP, FID, CLS)
- Time to Interactive (TTI)
- First Contentful Paint (FCP)

### Questions to Ask

1. "Will this scale with 10x/100x more data?"
2. "What happens with slow network conditions?"
3. "Are there any O(n²) or worse algorithms?"
4. "Could this operation be batched or debounced?"
5. "Is this computation necessary on every render?"

**Important:** These are general guidelines. Performance requirements vary by application.
Focus on user-facing performance impact rather than micro-optimizations.
`;

/**
 * Get the performance policy content
 */
export function getPerformancePolicy(): string {
  return PERFORMANCE_POLICY;
}
