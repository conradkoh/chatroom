// fallow-ignore-file unused-export unused-type
/**
 * Public boundary for daemon-local observability aggregation.
 *
 * Callers should import observability capabilities from this module rather
 * than reaching into the service implementation.
 */
export {
  createOperationalObservabilityService,
  DEFAULT_OBSERVABILITY_ROLE_LIMIT,
  DEFAULT_OBSERVABILITY_SCOPE_LIMIT,
  OPERATIONAL_OBSERVABILITY_SCHEMA_VERSION,
  type OperationalObservabilityScopeSnapshot,
  type OperationalObservabilityService,
  type OperationalObservabilitySink,
  type OperationalObservabilitySnapshot,
} from './service/operational-observability-service.js';
