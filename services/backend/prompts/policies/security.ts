/**
 * Security Policy Guidelines for Code Review
 *
 * Generic security guidelines that should be adapted to
 * the specific codebase conventions and requirements.
 */

/**
 * Security review guidelines
 */
export const SECURITY_POLICY = `
## Security Review Policy

These are general security principles. Adapt to your codebase's specific security requirements.

### Authentication & Authorization

- [ ] Authentication checks are in place where required
- [ ] Authorization verifies user has permission for the action
- [ ] Session handling follows established patterns
- [ ] No hardcoded credentials or secrets

### Input Validation

- [ ] User input is validated before use
- [ ] Input sanitization for database queries (SQL injection prevention)
- [ ] Path traversal protection for file operations
- [ ] Proper escaping for output contexts (XSS prevention)

### Data Handling

- [ ] Sensitive data is not logged
- [ ] PII is handled according to privacy requirements
- [ ] Secrets use environment variables, not hardcoded values
- [ ] .env files are not committed

### API Security

- [ ] Rate limiting considerations for public endpoints
- [ ] CORS configuration is appropriate
- [ ] API responses don't leak sensitive information
- [ ] Error messages don't expose internal details

### Common Vulnerabilities to Check

1. **Injection Attacks**
   - SQL/NoSQL injection
   - Command injection
   - Template injection

2. **Broken Access Control**
   - Missing authorization checks
   - IDOR (Insecure Direct Object Reference)
   - Privilege escalation

3. **Security Misconfiguration**
   - Debug mode in production
   - Exposed admin interfaces
   - Default credentials

4. **Cryptographic Issues**
   - Weak hashing algorithms
   - Insecure random number generation
   - Improper key management

### Codebase-Specific Security

Check these locations for security-related guidelines:
- Security documentation in \`docs/security*.md\`
- Authentication patterns in existing auth code
- Existing security middleware/helpers
- Security comments in sensitive code areas

**Important:** These are general guidelines. Always verify against your project's specific security requirements and compliance needs.
`;

/**
 * Get the security policy content
 */
export function getSecurityPolicy(): string {
  return SECURITY_POLICY;
}
